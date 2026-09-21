# AskGogo Brain + Vault Architecture v1

Status: Architecture v1.1 hardening review
Date: 2026-09-21
Scope: Unified internal brain, world state, missions, Vault, Secure Computer, approvals, evidence, watchers, cross-surface continuity
Non-goal: Replace all current executors in one release

## 1. Product principle

AskGogo must behave like one persistent personal operating system, not a collection of independent feature routers.

Every user or system event should flow through the same logical sequence:

```
Event -> Normalize -> Resolve context -> Update world model -> Form/continue mission
      -> Plan -> Policy/Sentinel -> Execute capabilities -> Collect evidence
      -> Update world model -> Prospective follow-up -> Respond
```

The execution substrate may include deterministic handlers, APIs, specialists, Secure Computer, Vault, watchers, and human Take Control. These are capabilities under the brain, not competing conversational entry points.

## 2. Architectural invariants

### v1.1 launch invariants

1. Per-user work is processed one-at-a-time through a Postgres-backed user lock; duplicate inbound events are idempotently ignored.
2. Every approval is bound to the exact action approved by an immutable hash of target, action, payload, amount/value, object reference, and policy version; execution re-checks the hash.
3. Trust classes are enforced in code. Only USER_INSTRUCTION and SYSTEM_POLICY may grant authority. External content may provide facts but never execution authority.
4. Execution distinguishes failed from outcome_unknown. Unknown outcomes must be reconciled with the provider before any retry.
5. Vault has three trust layers: metadata, encrypted secret store, and authenticated session/browser-profile material. Cookies, session storage and refresh tokens are secrets.
6. Repository migrations are the schema source of truth. Shadow Brain does not start until repo migrations match the production schema and constraint expectations.
7. Privacy lifecycle is a launch gate for connected-account features: disconnect, remote token revocation where supported, local token deletion, and user data deletion must be defined and tested.
8. WhatsApp is treated as a structured services surface for missions, reminders, dues, bookings and other bounded workflows rather than as an unrestricted execution surface.

### End-state invariants

1. There is exactly one context-resolution authority.
2. There is exactly one active mission graph per user outcome, even across surfaces.
3. LLMs may propose intent/context/plans but may never grant themselves execution authority.
4. Consequential actions are always enforced by deterministic policy.
5. No action is considered complete without terminal evidence appropriate to that capability.
6. Vault plaintext never enters model prompts, conversation memory, agent activity, or general world state.
7. OTP, CAPTCHA, passkey, biometric and payment-auth boundaries are always human-only.
8. Background work updates the same world model used by interactive sessions.
9. Cross-surface continuity is keyed by canonical user identity, never surface-specific identity.
10. Existing mature executors are wrapped before they are replaced.

## 3. System layers

### 3.0 Near-term concurrency model

For the current scale, AskGogo does not require full event-sourced replay or per-object optimistic versioning.

Instead:
- acquire a per-user Postgres advisory/application lock before mutating brain/mission state
- process one user event at a time
- require an inbound event idempotency key
- keep an append-only audit log of important transitions
- use provider/object-specific idempotency keys for external mutations
- introduce full replay/versioned world state only if scale/concurrency requires it later

This is intentionally simpler than a distributed event-sourcing system while preserving deterministic user-level behavior.



### 3.1 Universal Event Ingress

Inputs:
- WhatsApp text
- WhatsApp PDF/image/audio/link
- Dashboard command
- Mobile app command/share sheet
- Google Workspace event/read
- watcher trigger
- scheduled task
- Life Event trigger
- browser handoff completion
- approval decision
- Vault credential saved/reauthenticated

Normalized contract:

```ts
type UserEvent = {
  id: string
  userId: string
  surface: 'whatsapp'|'web'|'ios'|'android'|'system'
  kind: 'message'|'document'|'image'|'audio'|'link'|'approval'|'watcher'|'schedule'|'handoff'|'vault'
  text?: string
  attachmentRefs?: string[]
  timestamp: string
  parentEventId?: string
  metadata: Record<string, unknown>
}
```

Ingress does not decide the final feature.

### 3.2 Context Resolver

Responsibilities:
- resolve pronouns and ellipsis: it, this, that one, same hotel, the flight, continue
- identify current focus
- connect current event to a world object or mission
- decide whether context is ambiguous
- produce a self-contained mission statement for downstream executors

Inputs:
- latest UserEvent
- focus state
- recent structured objects
- recent missions
- recent conversation
- safe Vault metadata
- explicit selected object from UI

Output:

```ts
type ContextResolution = {
  originalText: string
  resolvedText: string
  focusObjectIds: string[]
  missionId?: string
  actionFamily: 'ask'|'save'|'remind'|'calendar'|'monitor'|'research'|'book'|'buy'|'send'|'other'
  confidence: number
  ambiguous: boolean
  explanationCode: string
}
```

If ambiguous, execution stops and AskGogo asks a narrow clarification.

### 3.3 World Model

The world model stores structured entities, state, relationships, provenance and evidence.

Core object kinds:
- Person
- Organization
- Trip
- Flight
- Train
- Hotel
- Booking
- Restaurant
- Product
- Order
- Document
- Meeting
- CalendarEvent
- Reminder
- Task
- List
- Watch
- Subscription
- Purchase
- PaymentIntent
- LifeEvent
- ProviderAccount
- Mission
- Evidence

Every object uses a shared envelope:

```ts
type WorldObject<T> = {
  id: string
  userId: string
  kind: string
  state: T
  status: string
  confidence: number
  sourceEventIds: string[]
  evidenceIds: string[]
  relatedObjectIds: string[]
  createdAt: string
  updatedAt: string
  lastFocusedAt?: string
}
```

### 3.4 Focus / Salience Engine

Focus is not simply "latest run".

Priority inputs:
1. explicit user selection
2. just-shared structured object
3. pending approval tied to current conversation
4. active mission in foreground
5. recently mentioned object
6. recent watcher/system event relevant to current turn
7. background paused mission
8. generic conversation fallback

Rules:
- stale paused browser runs cannot steal focus from a newly shared ticket/document
- explicit nouns override pronouns
- consequential action references require high confidence
- if two candidates remain close, ask rather than guess

### 3.5 Mission Engine

A Mission is the persistent outcome container.

```ts
type Mission = {
  id: string
  userId: string
  objective: string
  status:
    | 'planning'
    | 'running'
    | 'waiting_input'
    | 'waiting_approval'
    | 'waiting_human_auth'
    | 'monitoring'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'cancelled'
  focusObjectIds: string[]
  sourceEventIds: string[]
  steps: MissionStep[]
  evidenceIds: string[]
  createdAt: string
  updatedAt: string
}
```

```ts
type MissionStep = {
  id: string
  tool: string
  objective: string
  dependsOn: string[]
  mutation: boolean
  risk: 'low'|'medium'|'high'
  approvalRequired: boolean
  verificationRequired: boolean
  status:
    | 'queued'
    | 'running'
    | 'waiting_input'
    | 'waiting_approval'
    | 'waiting_human_auth'
    | 'completed'
    | 'failed'
  evidenceIds: string[]
}
```

### 3.6 Planner

The planner converts an outcome into steps.

Planner rules:
- prefer safe reads first
- preserve user objective literally
- never invent identifiers, dates, accounts or private values
- place consequential actions after safe preparation
- make dependencies explicit
- never encode credentials in steps
- each step must name one capability
- each mutation must declare approval/evidence requirements

The planner may use Claude primary and OpenAI fallback. Provider failure must not become user-visible architectural failure.

### 3.7 Capability Registry

Capabilities are typed executors.

Initial registry maps current production systems:
- memory
- files/documents
- reminders
- lists
- tasks
- calendar
- Google Workspace
- public web research
- travel research
- train research
- appointment research
- watchers
- Secure Computer
- Vault broker
- Life Events
- booking preparation
- flight check-in
- artifacts
- payments/payment handoff

Executor contract:

```ts
type CapabilityRequest = {
  missionId: string
  stepId: string
  actor: AgentActor
  input: Record<string, unknown>
  mode: 'read'|'draft'|'execute'
  approvalId?: string
}

type CapabilityResult = {
  status: 'completed'|'prepared'|'blocked'|'failed'
  summary: string
  output: Record<string, unknown>
  evidence: Evidence[]
  blockReason?: string
}
```

Executors do not decide global conversational routing.

### 3.8 Specialist Agents

Specialists are advisory domain modules:
- travel
- shopping
- food
- grocery
- appointments
- documents
- communications
- calendar
- subscriptions
- payments
- local services

Specialist output:
- extracted facts
- candidate objects
- missing inputs
- recommended capability sequence
- risk hints
- validation rules

Specialists never bypass policy or evidence requirements.

### 3.9 Vault

Vault is a trust-separated credential system.

The brain may see only:
- provider
- domain
- account label
- status: active / needs_reauth / revoked
- credential reference ID
- last-used timestamp

The brain may never see:
- username plaintext
- password
- refresh/access token
- session cookie
- OTP
- card secret
- passkey material

Flow:

```
Brain -> provider/domain needed
      -> Vault metadata says credential may exist
      -> Secure Browser asks Vault Broker for opaque credential ref
      -> Vault Broker decrypts server-side
      -> secret injected directly into sandbox process environment
      -> browser uses it
      -> result recorded
      -> plaintext discarded
```

If multiple credentials match:
- mission pauses
- user selects account label
- browser resumes with selected opaque credential ID

If provider rejects credential:
- mark needs_reauth
- ask user to update via secure Vault UI
- resume same mission afterwards

### 3.10 Secure Computer

Secure Computer is isolated execution infrastructure.

Rules:
- per-user sandbox identity
- Mumbai region by default
- network allowlist per target family
- persistent browser profile
- secret injection only from Vault broker
- no secret-shaped data in logs/model/activity
- signed URL query/fragment redaction
- draft/read modes physically prevent consequential submits
- execute mode still requires deterministic approval
- human auth triggers Take Control
- no false success if provider access is blocked

### 3.11 Policy + Sentinel

Deterministic enforcement lives outside the LLM.

Checks:
- capability permission
- mode
- risk
- irreversible flag
- approval status
- payment boundary
- external mutation boundary
- credential boundary
- human-auth boundary
- scope/domain allowlist
- rate/cost guard
- terminal-evidence requirement

Examples:
- calendar.create -> approval
- email.send -> approval
- booking.submit -> approval
- purchase -> approval + payment handoff
- OTP/passkey/CAPTCHA -> human takeover
- check-in -> terminal evidence mandatory

### 3.12 Approval Engine

Approval objects are first-class and tied to a mission step.

```ts
type Approval = {
  id: string
  missionId: string
  stepId: string
  actionType: string
  preview: Array<{label:string;value:string}>
  risk: 'medium'|'high'
  status: 'pending'|'approved'|'rejected'|'executed'|'expired'
  requestedAt: string
  resolvedAt?: string
}
```

Approval must be revalidated at execution time.

### 3.13 Evidence Engine

Every mutation and critical read returns evidence.

```ts
type Evidence = {
  id: string
  missionId: string
  stepId: string
  type:
    | 'db_row'
    | 'provider_id'
    | 'calendar_event_id'
    | 'email_message_id'
    | 'booking_confirmation'
    | 'boarding_pass'
    | 'terminal_page'
    | 'watcher_id'
    | 'document_hash'
  source: string
  value: Record<string, unknown>
  verifiedAt: string
}
```

Rules:
- no evidence => no completed mutation claim
- terminal evidence required for bookings/check-in/payment completion
- evidence is attached back to world objects

### 3.14 Prospective Brain

After a meaningful event or mission update, AskGogo evaluates possible future work:
- reminder
- watcher
- expiry
- deadline
- check-in
- renewal
- follow-up
- preparation task

The prospective brain proposes or creates only within user permissions.

### 3.15 Background Runtime

All watchers/goals/Life Events use the same mission/world model.

A watcher event becomes a UserEvent with surface='system', then:
- updates relevant object
- attaches evidence
- resumes/creates mission if needed
- decides whether user notification is meaningful

### 3.16 Response Composer

The response is generated after state/evidence updates.

It should answer:
- what AskGogo understood
- what it did
- what evidence proves completion
- what still needs user input
- what needs approval
- what is being monitored

It must not expose:
- raw DB rows
- raw ISO timestamps unless relevant
- secret material
- stack traces
- internal tool names

## 4. Trust classes

Every input/value passed into the brain or planner carries a trust class:

- SYSTEM_POLICY
- USER_INSTRUCTION
- CONNECTED_ACCOUNT_DATA
- EXTERNAL_WEB_DATA
- DOCUMENT_CONTENT
- MODEL_INFERENCE
- EXECUTION_EVIDENCE

Only SYSTEM_POLICY and USER_INSTRUCTION can authorize an action or modify approval state.

CONNECTED_ACCOUNT_DATA, EXTERNAL_WEB_DATA and DOCUMENT_CONTENT may contribute facts only. Prompt-injection text embedded in emails, webpages or PDFs is data, never authority.

MODEL_INFERENCE may propose context or a plan but cannot grant authority.

EXECUTION_EVIDENCE may prove what occurred but does not itself authorize a new action.

## 5. Exact approval binding

Before a consequential action is presented for approval, compute an immutable action fingerprint over the exact material being approved, including:
- capability/action type
- target provider/object
- normalized payload
- amount/value where relevant
- object reference/version if available
- policy version
- mission id + step id

At execution time, recompute and compare the fingerprint. Any material drift invalidates the approval and requires a fresh preview/approval.

## 6. Outcome reconciliation

Execution status includes:
- completed
- failed
- outcome_unknown

outcome_unknown means the provider may have completed the action but AskGogo did not receive reliable terminal confirmation.

Retry rule:
1. query/reconcile provider state using idempotency/reference data
2. if completion is verified, attach evidence and mark completed
3. if absence is verified, retry using the same idempotency key
4. if still uncertain, remain outcome_unknown and ask/alert rather than duplicate the mutation

## 7. Vault trust layers

Vault is split into:

1. Vault Metadata — safe for Brain: provider, allowed domains, account label, status, opaque credential reference.
2. Vault Secret Store — encrypted usernames/passwords/API/refresh/access tokens. Only trusted broker code can decrypt.
3. Session Vault — browser profiles, cookies, local/session storage and authenticated provider sessions. These are secret-class material and never enter model/world-state prompts.

The Brain receives only metadata and coarse outcomes such as authenticated / needs_reauth / human_auth_required.

## 8. Cross-surface continuity

All surfaces resolve to canonical AgentActor/user identity.

WhatsApp, Dashboard, mobile and background jobs must read/write:
- same world objects
- same missions
- same approvals
- same evidence
- same Vault metadata references
- same focus history

Surface-specific UI is presentation only.

## 9. Failure model

### Provider LLM unavailable
- fail over planner provider
- keep deterministic executors usable

### Provider website blocks automation
- pause mission
- preserve state
- offer Take Control
- no false completion

### Vault credential invalid
- mark needs_reauth
- pause mission
- secure update flow
- resume same mission

### Ambiguous context
- ask narrow clarification
- do not execute

### Approval missing
- waiting_approval
- no mutation

### Executor timeout
- step paused/failed with bounded reason
- no fallthrough to plain LLM completion

### Evidence missing
- step status cannot become completed for consequential action

### Duplicate event
- idempotency key prevents duplicate mutations

## 10. Existing production mapping

Current modules should be wrapped, not rewritten immediately.

| Current module | New role |
|---|---|
| whatsapp-bridge.ts | temporary ingress adapter |
| orchestrator.ts | mission execution facade |
| same-brain.ts | capability dispatcher during migration |
| general-planner.ts | planner implementation |
| persistent-general-plan.ts | early mission runtime |
| autonomous-runtime.ts | mission-step executor foundation |
| watch-command.ts | watcher capability |
| travel-calendar-plan.ts | compound capability adapter |
| travel-research.ts | travel specialist/capability |
| train-research.ts | train specialist/capability |
| appointment-* | appointment specialist/capability |
| browser-command.ts | Secure Computer capability adapter |
| secure-computer.ts | isolated browser executor |
| vault/credential-store.ts | trusted Vault broker/store |
| life-event-* | prospective/background brain foundation |
| agent-policy.ts | deterministic permission policy |
| sentinel.ts | deterministic execution safety |
| agent_activity | audit/activity stream |
| agent_runs/steps | initial mission persistence |
| agent_approvals | approval persistence |
| travel_tickets/documents | existing domain objects during migration |

## 11. Migration strategy

### Phase 0 - Architecture freeze
- no new brain-routing quick fixes
- document contracts
- build architecture verification
- independent Claude review

### Phase 1 - Shadow brain
- every turn is normalized and context-resolved in shadow mode
- current production router still executes
- compare proposed focus/mission against actual handler
- collect disagreements

### Phase 2 - Context authority
- new context resolver becomes sole pronoun/focus authority
- existing executors receive self-contained requests

### Phase 3 - Mission envelope
- every multi-step user outcome gets a persistent mission
- existing executors run as capability adapters

### Phase 4 - Evidence normalization
- standard CapabilityResult/Evidence contracts
- no consequential completion without evidence

### Phase 5 - Vault integration
- brain receives metadata only
- secure browser receives opaque credential reference
- broker injects plaintext directly

### Phase 6 - Prospective brain
- reminders/watchers/Life Events become recommendations/continuations from world state

### Phase 7 - Cross-surface convergence
- WhatsApp, Dashboard, mobile use same mission/world APIs

### Phase 8 - Router retirement
- remove first-match feature routing only after journey parity is green

## 12. Release gates

A brain release may merge only if:
- legacy regression matrix green
- new journey matrix green
- no secret-leak regressions
- all consequential actions remain approval-gated
- terminal-evidence tests pass
- Vault plaintext-isolation tests pass
- duplicate/idempotency tests pass
- Vercel preview READY
- production post-deploy smoke checks pass

## 13. Non-negotiable E2E journeys

1. Share flight PDF -> ask details -> save calendar -> approve -> event evidence
2. Share flight PDF -> monitor -> watcher created -> change event -> notify
3. Research hotel -> choose one -> book -> approval -> auth -> terminal booking evidence
4. Share order screenshot -> ask status -> monitor -> delivery update
5. Share document -> ask expiry -> create reminder -> verify reminder evidence
6. Ask to send email using prior context -> draft -> approval -> provider message ID
7. Provider requires login -> Vault available -> browser login -> continue
8. Provider rejects credential -> needs_reauth -> secure update -> resume
9. Provider asks OTP -> Take Control -> resume same mission
10. Ask cross-surface follow-up on Dashboard after WhatsApp share -> same object and mission
11. Duplicate user message -> no duplicate booking/reminder/calendar event
12. LLM provider outage -> deterministic flows continue; planner fallback works
13. Old paused mission exists -> newly shared object still becomes focus
14. Ambiguous "book it" with two candidate hotels -> clarification, no mutation
15. Check-in request -> no "checked in" until boarding-pass/terminal evidence exists

## 14. Deferred until scale

The following are intentionally deferred until usage justifies their complexity:
- full event sourcing with deterministic replay
- durable versioned focus state across every object
- global entity-resolution/merge engine across PDF/email/screenshot duplicates
- fine-grained optimistic versioning for every world object

Near-term focus uses the last explicit/recent structured object with a short expiry and asks when unsure.

## 15. Architectural decision

AskGogo is not a chatbot with features.

AskGogo is a persistent event-driven personal operating system with:
- one world model
- one context authority
- persistent missions
- typed capabilities
- deterministic safety
- isolated credential handling
- evidence-backed completion
- prospective background intelligence


## 16. Schema source of truth gate

Before Shadow Brain begins:
- inventory production tables, columns, enums and constraints used by agent_runs, agent_steps, agent_threads, approvals, watchers, Vault and related runtime paths
- add/reconcile repository migrations until a clean clone can create the production-compatible schema
- convert silent constraint failures into explicit surfaced errors
- restore a clean-clone test path
- track any intentional production-only divergence explicitly

This is a release blocker for Brain migration because mission/runtime correctness cannot depend on undocumented production schema.

## 17. Privacy lifecycle gate

Connected-account launch requirements:
- disconnect flow
- remote token revocation where provider supports it
- local encrypted token deletion
- deletion propagation for connected-account derived data where required
- user-requested account/data deletion path
- tests proving revoked/disconnected credentials cannot be used by background jobs or Secure Computer

## 18. Parallel production stabilization

Architecture work must not block high-value production stabilization. These tracks run in parallel:
- schema D1/D4 silent database failures and migration reconciliation
- mail-intent hijack / routing regressions
- false “cannot browse” behavior
- Gmail disconnect/revoke/delete lifecycle
- waitlist/fundraising proof on askgogo.in

These fixes must preserve current safety boundaries and should not introduce new architecture shortcuts.
