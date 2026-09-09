# AskGogo Agent Roadmap

## Product promise

**AskGogo remembers, understands, anticipates and acts — with the user in control.**

The mobile app is not a second web dashboard. It is the native command surface for the same Gogo and same memory already used across WhatsApp and `app.askgogo.in`.

## Principles

1. **Same Gogo everywhere** — one identity, memory, reminders, lists, calendar context and preferences across WhatsApp, web and mobile.
2. **Proactive, not noisy** — Gogo should surface only useful changes, deadlines, opportunities and blockers.
3. **Visible work** — every background job has status, source, next step and a human-readable activity trail.
4. **Approval before consequence** — sending, submitting, deleting, booking, paying or publishing requires an explicit deterministic approval unless the user has granted a narrowly-scoped permission.
5. **Least privilege** — separate read, draft and execute permissions for email, calendar, browser, files, contacts and payments.
6. **India depth** — WhatsApp-first flows, Indian languages, local travel/commerce/services and CreditIQ payment/reward intelligence.
7. **Artifacts over chat walls** — itineraries, trackers, briefs, comparisons and plans become durable interactive objects.

---

## Phase 1 — Agent surface in the native app

### 1. Gogo Activity
Native activity centre showing:
- Running now
- Waiting for approval
- Watching in background
- Completed
- Failed/retryable
- Why Gogo did this
- Source/context used

Home gets a compact **Gogo is working** card.

### 2. Goals
Goals are higher-level than tasks. Each goal contains:
- outcome
- deadline
- progress
- plan/checkpoints
- blockers
- active background watches
- related people/files/memories
- suggested next action

Example: `Launch CreditIQ UAE` can contain accelerator applications, investor follow-ups, deck updates and deadlines.

### 3. Ideas for You
A proactive inbox generated from memory + calendar + reminders + goals + travel + saved items.

Each idea must have:
- reason
- expected value
- source context
- dismiss / snooze / act buttons

### 4. Approval Cards
One common native pattern for irreversible actions:
- Send email/message
- Submit form
- Create/update/delete calendar event
- Book travel
- Purchase/pay
- Publish/share

States: `draft → review → approved/rejected → executing → completed/failed`.

### 5. Gogo Permissions / Safe Mode
Per-capability permissions:
- Read
- Draft
- Execute with approval
- Execute automatically (only where safe and explicitly enabled)

Initial policy:
- Memory/files: read allowed when connected
- Email: read/draft; send always ask
- Calendar: read/create with confirmation; destructive edits always ask
- Browser: browse/research; form submission always ask
- Purchases/payments: always ask

### 6. Artifacts
Durable mobile objects:
- Trip itinerary
- Accelerator/application tracker
- Meeting brief
- Shopping comparison
- Goal plan
- Expense/reward summary
- Research brief

---

## Phase 2 — Persistent agent backend

Add authenticated API + storage for:

### `agent_goals`
- id, user_id, title, outcome, status, deadline, progress, plan_json, context_json, created_at, updated_at

### `agent_runs`
- id, user_id, goal_id, type, status, summary, source, started_at, completed_at, error, metadata_json

### `agent_activity`
- id, user_id, run_id, event_type, message, metadata_json, created_at

### `agent_permissions`
- user_id, capability, read_level, draft_level, execute_level, updated_at

### `agent_approvals`
- id, user_id, run_id, action_type, payload_preview, risk_level, status, requested_at, resolved_at

### `agent_ideas`
- id, user_id, title, reason, value_score, source_refs, status, created_at, snoozed_until

### `agent_artifacts`
- id, user_id, type, title, schema_version, content_json, source_refs, created_at, updated_at

### `agent_watchers`
- id, user_id, goal_id, type, condition_json, cadence, active, last_checked_at, last_state_json

All routes reuse the existing authenticated AskGogo identity/session; no separate mobile-only memory silo.

---

## Phase 3 — Background Gogo

Build a scheduler/worker on top of the existing reminder/cron foundation.

Supported watcher types first:
1. price/fare threshold
2. deadline approaching
3. calendar conflict/change
4. email/reply awaited
5. web-page availability/change
6. application status/deadline
7. travel disruption/check-in window

Rules:
- do not notify when nothing meaningful changed
- dedupe repeated findings
- record every check in agent run/activity logs
- user can pause/delete any watcher

---

## Phase 4 — Gogo Browser / action executor

Use an isolated browser environment.

### Read-only first
- search
- navigate
- extract structured information
- compare options
- download documents
- prepare form answers

### Draft actions next
- fill forms without submitting
- prepare emails/messages
- prepare bookings/checkouts

### Execution only through approval gate
- form submit
- email send
- destructive calendar changes
- booking
- purchase/payment

Credentials must never be exposed to the model or written into activity logs.

---

## Phase 5 — Native advantages

- Push notifications for approvals/background changes
- Share sheet: **Send to Gogo**
- Camera/document scan
- Background voice capture
- Home-screen widgets
- Biometric lock
- Deep links into goal/run/artifact/approval
- Android notification actions
- iOS Siri/App Intents where useful

---

## Phase 6 — India + CreditIQ differentiation

### Indian language action layer
Priority:
- Hindi
- Kannada
- Tamil
- Telugu

Speech/text can be mixed-language; action confirmation can be shown in the user's preferred language.

### CreditIQ intelligence inside actions
Before travel/commerce payment:
- best card
- effective reward value
- points vs cash recommendation
- transfer irreversibility warnings
- lounge/benefit relevance

### India execution targets
Integrate only through legitimate APIs/approved browser flows:
- airlines/travel
- utilities
- food/local services
- government/public-service workflows where permitted
- UPI/payment handoff without exposing credentials

---

## Delivery sequence

### Sprint A — Native agent UX (now)
- [x] Roadmap
- [ ] Shared agent TypeScript models
- [ ] Agent API client scaffold
- [ ] Agent Hub screen
- [ ] Activity cards
- [ ] Goals cards
- [ ] Ideas cards
- [ ] Permission controls
- [ ] Approval card component
- [ ] Home `Gogo is working` entry point
- [ ] Android preview build

### Sprint B — persistence
- [ ] database migration
- [ ] authenticated agent API
- [ ] live Goals CRUD
- [ ] live Activity/Approvals/Ideas
- [ ] mobile authentication/session handoff

### Sprint C — background intelligence
- [ ] watcher worker
- [ ] meaningful-change detector
- [ ] native push delivery
- [ ] calendar/email/travel watchers

### Sprint D — browser executor
- [ ] isolated read-only browser runs
- [ ] form-draft mode
- [ ] approval-gated submit mode
- [ ] action audit trail

### Sprint E — artifacts + CreditIQ
- [ ] artifact renderer
- [ ] trip/application/research artifact templates
- [ ] CreditIQ payment/reward recommendations in action flows

### Sprint F — store readiness
- [ ] Android release AAB
- [ ] Play internal testing
- [ ] iOS archive
- [ ] TestFlight
- [ ] privacy disclosures
- [ ] store screenshots/metadata
- [ ] production rollout

## Definition of done for an agent feature

A feature is not considered complete until:
1. authenticated end-to-end
2. same user/memory as WhatsApp/web
3. permission check enforced server-side
4. irreversible action approval enforced server-side
5. activity/audit event recorded
6. failure and retry path exists
7. Android + iOS UI state handled
8. automated regression coverage added
