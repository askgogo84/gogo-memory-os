# AskGogo Brain + Vault Migration Plan v1

## Principle

Do not replace production executors until the new architecture proves parity in shadow mode.

## Current risks to eliminate

- first-match-wins routing
- context re-resolution in multiple handlers
- feature-specific mission ownership
- stale run stealing active focus
- plain-LLM fallthrough after agent failure
- inconsistent evidence semantics
- duplicate mutation risk across surfaces
- hidden coupling between WhatsApp phrasing and executor parsers
- Vault availability not represented in shared context
- background events living outside interactive mission continuity

## Phase 0 — Freeze, schema reconciliation and baseline

Before brain work:
- make repository migrations reproduce production agent/runtime schema
- resolve documented D1/D4 silent constraint failures
- ensure clean-clone test setup works
- add per-user processing lock primitive
- add inbound event idempotency storage
- define privacy disconnect/revoke/delete behavior for connected accounts



Deliverables:
- architecture spec
- contracts
- migration map
- E2E journey matrix
- Claude review
- current production baseline snapshot

No production behavior changes.

Exit gate:
- architecture review accepted
- critical objections resolved
- owner approves migration order

## Phase 1 — Shadow Context Brain

Implementation:
- normalize every inbound turn into UserEvent
- compute focus/context in shadow
- write shadow result to agent_activity only
- current production routing remains unchanged

Metrics:
- contextual referent agreement
- false-context rate
- clarification rate
- stale-focus rate
- secret-leak rate = 0

Exit gate:
- >99% deterministic journey cases pass
- no consequential downgrade
- no Vault plaintext in traces

## Phase 2 — Context Authority

Implementation:
- context resolver becomes sole reference authority
- specialists receive resolved, self-contained requests
- remove pronoun-specific parsing from specialist entry points over time

Exit gate:
- Same Brain E2E green across WhatsApp/Dashboard
- all legacy deterministic tests green

## Phase 3 — Mission Envelope

Implementation:
- every multi-step outcome gets Mission + MissionStep
- wrap current compound/general/autonomous runs under one mission contract
- persist dependencies and state transitions

Exit gate:
- pause/resume survives auth, approval and process restart
- duplicate turn resumes mission instead of creating another

## Phase 4 — Capability Adapters

Wrap current modules behind CapabilityRequest/CapabilityResult:
1. reminders
2. lists/tasks
3. calendar
4. Workspace reads/writes
5. watchers
6. travel/train/appointments
7. Secure Computer
8. Life Events
9. booking/check-in

Exit gate per adapter:
- deterministic unit tests
- evidence contract
- idempotency contract
- policy contract

## Phase 5 — Evidence Normalization

Implementation:
- evidence table or equivalent typed persistence
- executor completion gated on required evidence
- response composer consumes evidence summary

Exit gate:
- no booking/check-in/send/calendar mutation can claim success without evidence

## Phase 6 — Vault Capability Integration

Implementation:
- safe VaultMetadata exposed to brain
- credentialRef passed through mission step
- broker resolves plaintext only at execution boundary
- automatic resume after secure save/reauth
- multiple-account selection flow

Exit gate:
- secret isolation tests
- auth challenge tests
- needs_reauth tests
- resume tests

## Phase 7 — Prospective Brain

Implementation:
- post-event evaluation for reminder/watcher/deadline/check-in/renewal
- recommendations linked to world objects
- user permission policy enforced

Exit gate:
- no noisy duplicate suggestions
- no auto-consequential actions

## Phase 8 — Background Unification

Implementation:
- watcher/Life Event/goal events re-enter UserEvent
- same mission/world APIs
- meaningful-notification policy

Exit gate:
- background changes visible on all surfaces

## Phase 9 — Cross-Surface Same Brain

Implementation:
- canonical identity APIs
- dashboard/mobile/WhatsApp same focus/mission state
- selected UI object updates focus explicitly

Exit gate:
- continue on another surface tests green

## Phase 10 — Legacy Router Retirement

Remove feature-first routing only when:
- shadow disagreement is negligible
- journey matrix is green
- current production capabilities have adapters
- rollback path exists

## Rollout controls

- feature flag per user/surface
- shadow-only flag
- brain-v1 context authority flag
- mission-runtime flag
- capability-adapter flags
- emergency fallback to current deterministic router, but never to unverified plain-LLM completion for an agent task

## Rollback

Rollback must preserve:
- mission state
- approvals
- Vault references
- evidence
- world objects

Only routing authority rolls back; stored state must remain forward-compatible.


## Deferred complexity

Do not implement before scale requires it:
- full event replay/event-sourced reconstruction
- per-object optimistic versioning everywhere
- durable versioned focus graph
- global entity merge engine

Use a per-user serial processing lock, short-lived focus, explicit selection priority and clarification-on-ambiguity in the first production architecture.

## Parallel stabilization track

Run alongside architecture work:
- D1/D4 DB/schema failures
- mail hijack
- false browser-unavailable copy
- Gmail disconnect/revoke/delete
- askgogo.in waitlist/fundraising proof

These are not prerequisites to writing the architecture, but schema/privacy items are prerequisites to Shadow Brain activation.
