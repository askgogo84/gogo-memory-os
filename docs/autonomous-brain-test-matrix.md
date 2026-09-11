# AskGogo Autonomous Brain — Canonical Night-Build Test Matrix

This matrix is the production regression contract for the AskGogo autonomous brain. It keeps WhatsApp, dashboard, memory, planning, approvals, Background Gogo, Workspace, Secure Computer, Life Events and self-learning on one end-to-end test path.

## Sequence A — Same brain, every surface

1. WhatsApp and dashboard use the same user identity and memory.
2. A reminder/list/task created from either surface is visible to the same brain.
3. Legacy deterministic WhatsApp features win before Muse-style agent fallback.
4. Dashboard Agent requests and WhatsApp Agent requests route through the same policy/safety layer.
5. Approval state is shared: an approval created on one surface can be accepted/rejected from the supported approval surface without duplicating the run.

Regression gates:
- `verify-agent-same-brain.mts`
- `verify-agent-whatsapp-bridge.mts`
- `verify-dashboard-day-chat.mts`

## Sequence B — Capture → remember → retrieve → act

1. Save a normal memory and retrieve it semantically later.
2. Save a sensitive identifier; mask it by default and require explicit field-bound reveal.
3. Never claim a sensitive value was stored if the value was never supplied.
4. Convert a memory into a reminder/action without losing source context.
5. Extract dates from documents/tickets/bills and turn them into proactive lifecycle work.
6. Self-learning only promotes evidence-backed preferences with provenance; noise must not become memory.

Regression gates:
- `verify-memory-redaction.mts`
- `verify-agent-compound.mts`
- `verify-agent-learning.mts`
- `verify-life-event-engine.mts`

## Sequence C — Low-risk autonomous execution

1. One-time reminder executes under safe auto permission.
2. Recurring reminder cadence remains timezone-safe and deduplicated.
3. Voice reminder such as `9:30 a.m.` parses exactly and does not trigger false ambiguity.
4. Lists and tasks are first-class capabilities and remain separate from reminders.
5. Safe reversible actions can auto-run; permission `off/read` must block writes.
6. Cost Guard remains active for model/tool work.

Regression gates:
- `verify-agent-policy.mts`
- `verify-agent-phase2.mts`
- `verify-reminder-dedup.mts`
- `verify-interval-cadence.mts`
- `verify-voice-reminder-meridiem.mts`
- `verify-list-routing.mjs`
- `verify-cost-guard.mts`

## Sequence D — Plan → approve → execute

1. Calendar mutations create a plan and approval rather than silently writing.
2. Medium/high-risk actions cannot execute before approval.
3. Rejected approvals never execute.
4. Approved runs execute once only; retries/concurrency must not duplicate consequential work.
5. Payments/purchases remain high-risk and irreversible; no automatic purchase.
6. Every execution is visible in the activity/audit trail.

Regression gates:
- `verify-agent-travel-calendar.mts`
- `verify-workspace-meeting-approval.mts`
- `verify-agent-sentinel.mts`
- `verify-agent-general-plan.mts`

## Sequence E — Background Gogo: watch → detect → notify

1. Create a background watcher from a user outcome.
2. Watchers remain bounded, deduplicated and relevant to the original intent.
3. Duplicate URLs/topics do not spam the user.
4. Cooldown and per-day notification caps are enforced.
5. A meaningful change produces one high-signal notification and activity provenance.
6. Goals can create proactive ideas/background work while preserving approval boundaries.

Regression gates:
- `verify-agent-watchers.mts`
- `verify-agent-web-watch.mts`
- `verify-agent-goals.mts`

## Sequence F — Google Workspace autonomous brain

1. OAuth scopes remain least-privilege and linked to the same AskGogo account.
2. Email/Drive context may be read only when permission allows it.
3. Meeting/email context can prepare an action, but consequential calendar/email mutations remain approval-gated.
4. Drive context is usable for reasoning without leaking unrelated content.
5. Workspace actions preserve provenance in the run/activity record.

Regression gates:
- `verify-google-workspace-oauth.mts`
- `verify-workspace-meeting-approval.mts`
- `verify-workspace-drive-context.mts`

## Sequence G — Secure Computer + Sentinel

1. Browser permission `off/read` blocks autonomous write/navigation work that would mutate external state.
2. Sentinel evaluates browser work before launch and again before approved execution.
3. Draft/preparation mode must not submit, purchase, or commit an irreversible action.
4. Password/OTP/CAPTCHA/passkey/passport/payment-auth gates stop autonomous execution for human takeover.
5. No paid seat, baggage, meal, upgrade, insurance or other new charge without a separate approval.
6. Browser exceptions fail closed and do not produce false success.

Regression gates:
- `verify-agent-secure-browser.mts`
- `verify-browser-auth-gate.mts`
- `verify-agent-sentinel.mts`

## Sequence H — Travel intelligence → calendar → lifecycle

1. Travel request can research options without creating fabricated availability.
2. Chosen travel may prepare an itinerary/calendar action behind approval.
3. Forwarded/parsed flight ticket is promoted into a durable Life Event.
4. Flight lifecycle contains check-in preparation, approval, execution and post-check-in watching.
5. Exact verified airline check-in URLs are used; unknown carriers fail closed.
6. Booking reference/PNR is transient inside Secure Computer and is not copied into generic run metadata.

Regression gates:
- `verify-agent-travel-research.mts`
- `verify-agent-travel-calendar.mts`
- `verify-life-event-engine.mts`
- `verify-life-event-worker.mts`

## Sequence I — Autonomous flight check-in

1. Due flight wakes Background Gogo.
2. Worker prepares check-in in draft mode only.
3. Browser policy + Sentinel are checked before preparation.
4. User receives explicit high-risk check-in approval.
5. WhatsApp `APPROVE` and dashboard `Approve & run` dispatch the same `life_event_checkin` executor.
6. Execution claims the approved run atomically so it cannot run twice.
7. Only free seat allocation is allowed unless a separate paid-seat approval exists.
8. Any new charge or authentication challenge stops execution.
9. Success requires terminal check-in confirmation evidence tied to the final submission; generic page text is not enough.
10. After verified success, the life event moves to `watching` for boarding-pass/email lifecycle.
11. Uncertain execution never auto-retries an irreversible submit.

Regression gate:
- `verify-life-event-worker.mts`

## Sequence J — Proactive daily brain

1. Daily brief combines calendar/priorities and speaks first at the configured local time.
2. Today view and dashboard source the same reminders/tasks/calendar data.
3. Time-of-day greeting follows user-local time.
4. Background learning and watchers do not overwhelm the daily experience.

Regression gates:
- `verify-dashboard-tasks-source.mts`
- `verify-dashboard-day-chat.mts`
- `verify-agent-learning.mts`

## Sequence K — India launch / production readiness

1. Mobile/dashboard flows remain usable after agent changes.
2. Permissions are explicit for reminders, lists, tasks, email, calendar, browser, contacts and travel.
3. Consequential actions always ask regardless of optimistic model output.
4. Cron endpoints are protected by `CRON_SECRET`.
5. Production build runs the entire regression suite before `next build`.
6. Product-readiness and launch regressions remain green.

Regression gates:
- `verify-india-agent-launch.mts`
- `verify-product-readiness.mjs`
- full `npm test` via `prebuild`

## Explicit next milestones — test stubs must remain visible until implemented

- Boarding-pass Gmail executor and attachment lifecycle.
- Generic event/reservation calendar executor from Life Events.
- DigiYatra / country capability packs.
- Secure human takeover UI for browser authentication and uncertain external state.
- Purchase/delivery lifecycle executors.
- Bills/subscriptions lifecycle executor.

These are not allowed to disappear from the test plan merely because their executors are not yet shipped.
