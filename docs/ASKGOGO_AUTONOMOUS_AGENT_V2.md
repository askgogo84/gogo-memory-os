# AskGogo Autonomous Agent V2 Architecture

Status: proposed architecture baseline for production hardening

## 1. Objective

Build AskGogo as a persistent, resumable, multi-domain personal agent whose behavior is consistent across WhatsApp, web dashboard and app. The system must preserve context across turns, use specialist agents for domain work, perform browser tasks in a persistent session, pause safely for human-only steps, require approval for consequential actions, and verify side effects before declaring success.

This document intentionally separates routing, planning, execution, approval, browser control, persistence and verification so one layer cannot silently override another.

## 2. Non-negotiable invariants

1. Safety/consent/auth commands always run first.
2. High-confidence specialist routing runs before generic legacy handlers.
3. Loose substring matching must never override a specialist domain intent.
4. Every state-changing operation must be idempotent.
5. Every external side effect must be independently verified.
6. Consequential actions require explicit user approval.
7. Browser human takeover must resume the same session/run, not restart context.
8. Credentials, OTPs and 2FA secrets are never exposed to the reasoning model.
9. Cross-domain state must be isolated by run, life event and domain.
10. No production patch may alter unrelated working domains without explicit reason and regression coverage.
11. Every reproduced bug receives a regression test before merge.
12. A run may pause, recover and resume without losing its plan, dependencies or verified outputs.

## 3. Top-level flow

```text
USER / WHATSAPP / APP / DASHBOARD
        |
        v
[0] SAFETY + CONSENT + AUTH BOUNDARY
        |
        v
[1] INPUT NORMALIZATION
        |
        v
[2] HIGH-CONFIDENCE DOMAIN CLASSIFIER
        |
        +--> Reminder/List/Calendar exact utilities
        +--> Travel specialist
        |      +--> Flight
        |      +--> Train
        |      +--> Hotel
        |      +--> Bus
        +--> Appointment specialist
        +--> Workspace specialist
        +--> Shopping/Purchase specialist
        +--> Memory/Files specialist
        +--> General multi-step planner
        |
        v
[3] ORCHESTRATOR / PLAN GRAPH
        |
        v
[4] PERSISTENT AUTONOMOUS RUNTIME
        |
        +--> agent_runs
        +--> agent_steps
        +--> agent_activity
        +--> agent_approvals
        +--> artifacts
        +--> life_events
        +--> watchers
        |
        v
[5] TOOL / EXECUTION LAYER
        |
        +--> deterministic internal tools
        +--> APIs/connectors
        +--> secure persistent browser
        |
        v
[6] HUMAN HANDOFF WHEN REQUIRED
        |
        v
[7] APPROVAL GATE FOR CONSEQUENTIAL ACTIONS
        |
        v
[8] EXECUTION
        |
        v
[9] INDEPENDENT VERIFICATION
        |
        v
[10] LIFE EVENT / CALENDAR / REMINDER / WATCHER UPDATE
        |
        v
[11] USER RESPONSE + AUDIT TRAIL
```

## 4. Routing hierarchy

### 4.1 Layer 0: safety and consent

Only exact/high-confidence rules belong here:
- STOP / unsubscribe
- auth callbacks
- explicit approval/rejection
- credential handoff status
- account linking
- emergency/system stop conditions

These rules may preempt all other routing.

### 4.2 Layer 1: input normalization

Normalize spelling, punctuation, channel artifacts and voice transcription quirks. Do not change semantic intent.

### 4.3 Layer 2: specialist domain classifier

The classifier must choose a domain using word boundaries, anchored patterns and semantic evidence. It should produce:

```ts
{
  domain: 'train' | 'flight' | 'hotel' | 'appointment' | 'reminder' | ...,
  confidence: number,
  mode: 'read' | 'prepare' | 'execute',
  entities: {...},
  reasons: [...]
}
```

Specialist routing must occur before generic legacy intent handling.

Example invariant:

```text
"Find me direct trains from Bangalore to Mysuru"
MUST route to train specialist.
It MUST NOT route to weather because "train" contains "rain".
```

Weather matching must use lexical boundaries or explicit weather shapes, never raw substring matching such as `includes('rain')`.

### 4.4 Layer 3: narrow deterministic utilities

Utilities such as exact reminder/list/calendar commands may execute deterministically when the command is unambiguous. They must decline rather than guess when confidence is insufficient.

### 4.5 Layer 4: general planner

Only multi-domain or genuinely multi-step outcomes should invoke the general planner. The planner creates executable steps, not prose.

## 5. Orchestrator and planning model

The orchestrator converts a user outcome into a dependency graph.

Example:

```text
Find me a dentist appointment next week, book only after I approve, then add it to calendar and remind me one day before.
```

Plan:

```text
1. appointment.research        [safe read]
2. appointment.select          [user choice if needed]
3. appointment.prepare_booking [safe preparation]
4. approval.request            [required]
5. appointment.execute         [consequential]
6. appointment.verify          [independent read-back]
7. life_event.upsert           [internal mutation]
8. calendar.prepare            [safe preparation]
9. approval.request            [if calendar write not covered]
10. calendar.execute
11. calendar.verify
12. reminder.create
13. watcher.create
```

Each step contains:
- step key
- tool name
- domain
- instruction
- dependencies
- mutation flag
- approval requirement
- verification requirement
- retry policy
- timeout policy
- idempotency key
- input snapshot
- output snapshot

## 6. Persistent autonomous runtime

`agent_runs` is the canonical mission state.

Required run states:
- queued
- running
- paused
- waiting_input
- waiting_human
- waiting_approval
- completed
- failed
- cancelled

`agent_steps` must support:
- queued
- running
- completed
- failed
- paused
- waiting_input
- waiting_human
- waiting_approval

Runtime rules:
- persist after every step transition
- deterministic idempotency key per mutation step
- bounded parallelism for independent safe reads
- dependency-aware execution
- stale worker recovery
- retry with backoff
- resume from persisted state
- no replay of completed verified side effects
- terminal-state immutability unless explicitly reopened

## 7. Specialist agents

### 7.1 Travel coordinator

Owns shared trip context and delegates to:
- Flight agent
- Train agent
- Hotel agent
- Bus agent

Travel context must include:
- origin
- destination
- dates
- passengers
- class/preferences
- selected option IDs
- provider evidence
- run/life-event IDs

A train follow-up must not consume flight state unless explicitly linked within the same trip life event.

### 7.2 Train agent

Responsibilities:
- parse route/date/direct preference
- open IRCTC or approved provider in persistent browser
- work through safe search controls
- extract browser-visible train rows
- preserve provider evidence
- pause for login/CAPTCHA/OTP when required
- resume same browser session after human handoff
- never book without approval

### 7.3 Appointment agent

Responsibilities:
- provider and location resolution
- slot research
- human auth handoff
- option selection
- approval staging
- exactly-once booking
- booking verification
- creation of life event and downstream actions

### 7.4 Workspace agent

Separate read, draft and execute modes for Gmail/Calendar/Contacts/Drive. Sending or mutation must be approval-gated unless an explicit permission policy allows otherwise.

### 7.5 Memory/files agent

Reads user-owned context and artifacts, but never exposes secret vault plaintext to general freeform reasoning.

## 8. Persistent browser architecture

The browser is a first-class runtime resource, not a stateless helper.

### 8.1 Browser session object

Persist:
- session ID
- run ID
- provider
- current URL
- cookies/session reference
- local storage/session storage reference where allowed
- browser state checkpoint
- last safe action
- pending human action
- takeover URL/token
- returned-control timestamp

### 8.2 Safe browser operations

Allowed without approval:
- navigate
- search
- filter
- inspect results
- open details
- collect evidence
- compare options

Consequential operations require approval:
- submit booking
- confirm reservation
- buy/pay
- cancel reservation
- send external message
- modify account data

### 8.3 Human takeover

When login/CAPTCHA/OTP/anti-bot blocks automation:

```text
agent run -> waiting_human
browser session remains alive
user opens takeover URL
user completes human-only step
user returns control
same run + same browser session resumes
```

Never start a fresh session unless recovery proves the original session is irrecoverable.

## 9. Approval gate

Every consequential step creates an immutable approval record containing:
- run ID
- step ID
- action type
- human-readable title
- exact target
- exact price/amount if any
- risk level
- provider
- prepared payload hash
- expiration

Approval must be consumed atomically. Repeated `APPROVE` must not execute twice.

## 10. Idempotency

Use domain-specific logical keys.

Examples:

Reminder:
```text
user + normalized message + scheduled instant + recurrence
```

List item:
```text
user + canonical list name + normalized item text + active state
```

Calendar event:
```text
user + external calendar + normalized title + start + end + provider/life-event link
```

Booking:
```text
user + provider + selected offer/slot + date/time + life-event/run
```

Watcher:
```text
user + watch type + target + life-event
```

Mutation tools must perform read-before-write or atomic upsert/compare-and-set and return the existing logical object when duplicated.

## 11. Independent verification

The agent must not trust the tool call response alone for consequential actions.

Examples:
- booking -> read confirmation page/email/provider record
- calendar write -> read event back from calendar
- reminder -> read stored reminder row
- list -> read list and verify requested items
- payment -> provider/payment processor confirmation

A run cannot be marked completed until required verification steps pass.

## 12. Life Events

A Life Event is the durable object that joins related actions across channels and time.

Examples:
- flight trip
- train journey
- hotel stay
- doctor appointment
- concert
- purchase
- visa/passport renewal

Life Event fields:
- type
- title
- start/end
- location
- provider
- status
- source run
- confirmation evidence
- linked calendar IDs
- linked reminder IDs
- linked watcher IDs
- linked browser session
- artifacts

## 13. Watchers

Watchers monitor future state changes:
- flight time/gate/status
- train status where supported
- appointment changes
- price drops
- delivery status
- booking cancellations

Only one logical watcher should own one target/life-event combination.

## 14. Cross-channel same-brain rule

WhatsApp, dashboard and app must call the same orchestration/runtime APIs.

They may render differently, but must not maintain separate hidden brains or conflicting state machines.

## 15. LLM responsibilities

Use an LLM for:
- ambiguous natural-language understanding
- multi-step planning
- structured extraction from complex pages
- summarization
- dynamic replanning
- ranking options from verified data

Do not use an LLM for:
- hard safety boundaries
- exact approval consumption
- idempotency
- authorization
- secret handling
- final verification of side effects when an authoritative API/read-back exists
- basic lexical routing that can be deterministic

## 16. Legacy handler policy

Legacy handlers stay temporarily for stable utility behavior but become fallbacks.

Rules:
1. Specialist claim first.
2. Exact deterministic utility second.
3. Legacy handler third.
4. General LLM fallback last.
5. Any legacy handler using loose substring matching must be replaced or constrained.

## 17. Regression strategy

Every production bug adds a regression test to a permanent suite.

Core suite must include:
- `train` is not `rain`
- reminder read query never creates reminder
- compound list+reminder executes both operations
- duplicate compound command creates no duplicate side effect
- stale flight context cannot hijack reminder command
- stale train context cannot hijack hotel command
- explicit list name extraction
- approval consumed exactly once
- human browser takeover resumes same session
- browser timeout pauses rather than silently failing
- confirmed booking creates exactly one Life Event
- calendar/reminder/watch downstream actions are exactly once

## 18. Release gates

No autonomous/browser PR merges until:
- targeted unit tests pass
- regression suite passes
- Vercel preview is green
- diff contains no unrelated domain changes
- preview smoke test succeeds
- production deployment is green
- one production acceptance scenario succeeds

## 19. Implementation order

### Phase A: routing control plane
- specialist classifier before legacy routing
- word-boundary/exact-match discipline
- route audit logs
- regression suite for routing collisions

### Phase B: unified orchestrator
- one entry point across channels
- normalized domain result
- explicit plan graph

### Phase C: persistent runtime
- durable steps/dependencies
- resume/recovery
- idempotency
- structured run summaries

### Phase D: persistent browser
- session registry
- provider-scoped browser sessions
- checkpointing
- human takeover/resume

### Phase E: approval + verification
- atomic approval consumption
- verify-after-write contract

### Phase F: Life Events + watchers
- single event graph linking booking/calendar/reminder/watchers

### Phase G: domain expansion
- appointments
- trains
- flights
- hotels
- buses
- events
- shopping/purchases
- workspace

## 20. Definition of success

AskGogo is considered production-ready for autonomous operation only when a user can complete this sequence reliably:

```text
Research real options
-> preserve context across turns
-> pause for human-only auth when needed
-> resume the same browser/session
-> present prepared action
-> obtain explicit approval
-> execute exactly once
-> verify independently
-> create/update Life Event
-> create calendar/reminder/watcher exactly once
-> continue tracking the outcome
```

A successful one-off response is not enough. The system must remain correct across retries, duplicate messages, stale contexts, browser timeouts, auth handoffs and cross-channel continuation.
