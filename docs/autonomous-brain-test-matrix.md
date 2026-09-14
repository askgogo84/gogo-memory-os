# AskGogo Autonomous Brain — Canonical A–T Test Matrix

This is the production regression contract for the full AskGogo product. A feature is not considered complete because a screen exists: it needs a real backend path, safety/approval semantics, a user-visible state, and a regression gate.

## Sequence A — Same brain, every surface
1. WhatsApp, web and native mobile resolve to the same AskGogo identity and memory.
2. Reminders, lists, tasks, runs, approvals and Activity are shared across surfaces.
3. Legacy deterministic features win before open-ended agent fallback.
4. Approval state is shared and cannot duplicate a run.

Gates: `verify-agent-same-brain.mts`, `verify-agent-whatsapp-bridge.mts`, `verify-dashboard-day-chat.mts`.

## Sequence B — Capture → remember → retrieve → act
1. Text, voice, photos and documents can enter the same Memory.
2. Sensitive identifiers are masked by default and revealed only through explicit field-bound requests.
3. Never claim a sensitive value was stored if the value was never supplied.
4. Dates/tickets/bills/documents can create lifecycle work without losing provenance.
5. Learned preferences require evidence and provenance.

Gates: `verify-memory-redaction.mts`, `verify-agent-compound.mts`, `verify-agent-learning.mts`, `verify-life-event-engine.mts`.

## Sequence C — Low-risk autonomous execution
1. One-time and recurring reminders execute under safe permissions.
2. Timezone and voice meridiem parsing remain exact.
3. Lists and tasks stay distinct from reminders.
4. Safe reversible writes may auto-run; `off/read` blocks writes.
5. Cost Guard applies to model/tool work.

Gates: `verify-agent-policy.mts`, `verify-agent-phase2.mts`, `verify-reminder-dedup.mts`, `verify-interval-cadence.mts`, `verify-voice-reminder-meridiem.mts`, `verify-list-routing.mjs`, `verify-cost-guard.mts`.

## Sequence D — Plan → approve → execute
1. Calendar/email/browser/travel/payment mutations respect capability policy.
2. Medium/high-risk actions cannot execute before approval.
3. Rejected approvals never execute.
4. Approved runs claim execution atomically and run once.
5. Every consequential execution leaves Activity provenance.

Gates: `verify-agent-travel-calendar.mts`, `verify-workspace-meeting-approval.mts`, `verify-agent-sentinel.mts`, `verify-agent-general-plan.mts`.

## Sequence E — Background Gogo: watch → detect → notify
1. User outcomes can create bounded background watchers.
2. Duplicate URLs/topics do not spam the user.
3. Cooldowns and per-day notification caps apply.
4. Meaningful changes create one high-signal notification and provenance.
5. Goals can create proactive work without bypassing approvals.

Gates: `verify-agent-watchers.mts`, `verify-agent-web-watch.mts`, `verify-agent-goals.mts`.

## Sequence F — Google Workspace autonomous brain
1. OAuth remains least-privilege and tied to the same AskGogo account.
2. Gmail, Contacts and Drive reads require permission and never leak unrelated context.
3. Meeting preparation may read context, while calendar/email mutations remain approval-gated.
4. Workspace actions preserve source provenance.

Gates: `verify-google-workspace-oauth.mts`, `verify-workspace-meeting-approval.mts`, `verify-workspace-drive-context.mts`.

## Sequence G — Secure Computer + Sentinel
1. Browser `off/read` blocks autonomous external mutation.
2. Sentinel evaluates work before launch and before approved execution.
3. Draft/preparation mode must not submit, purchase, or commit an irreversible action.
4. Password/OTP/CAPTCHA/passkey/passport/payment-auth gates stop for human takeover.
5. Any new charge or authentication challenge stops execution.
6. Browser failures fail closed and never produce false success.

Gates: `verify-agent-secure-browser.mts`, `verify-browser-auth-gate.mts`, `verify-agent-sentinel.mts`.

## Sequence H — Travel intelligence → calendar → lifecycle
1. Travel research never fabricates live availability.
2. Selected travel can prepare itinerary/calendar work behind approval.
3. Parsed tickets become durable Life Events.
4. Verified airline check-in URLs are used; unknown carriers fail closed.
5. Booking references stay transient and out of generic logs.

Gates: `verify-agent-travel-research.mts`, `verify-agent-travel-calendar.mts`, `verify-life-event-engine.mts`, `verify-life-event-worker.mts`.

## Sequence I — Autonomous flight check-in
1. Due flights wake Background Gogo.
2. Preparation is draft-only.
3. Check-in submit requires explicit high-risk approval.
4. WhatsApp and app approvals dispatch the same executor.
5. Free seat allocation only unless a separate paid-seat approval exists.
6. Success requires terminal check-in confirmation evidence tied to the final submission.
7. Uncertain execution never auto-retries an irreversible submit.
8. Post-check-in state watches Gmail for boarding pass/check-in confirmation.

Gates: `verify-life-event-worker.mts`, `verify-life-event-email-worker.mts`, `verify-checkin-terminal-evidence.mts`.

## Sequence J — Proactive daily brain
1. Daily brief combines calendar/priorities at user-local time.
2. Today and dashboard source the same underlying state.
3. Background learning/watchers stay high-signal.

Gates: `verify-dashboard-tasks-source.mts`, `verify-dashboard-day-chat.mts`, `verify-agent-learning.mts`.

## Sequence K — India launch / production readiness
1. Mobile/dashboard/WhatsApp remain usable after agent changes.
2. Permissions are explicit for all consequential capabilities.
3. Cron endpoints are protected by `CRON_SECRET`.
4. Production build runs the full regression suite before `next build`.
5. Product-readiness and cost gates remain green.

Gates: `verify-india-agent-launch.mts`, `verify-product-readiness.mjs`, full `npm test` via `prebuild`.

## Sequence L — Documents, identity and expiry
1. Native capture accepts photos/documents/voice and stores provenance.
2. Passport/visa/license/insurance-style expiry dates can become reminder Life Events.
3. Sensitive document fields are never copied into generic Activity text.
4. Expiry reminders deduplicate and remain timezone-safe.
5. Secure document reveal follows the same field-bound policy as Memory.

Current state: document capture + expiry planning are shipped; broadened document-type coverage and native document detail UX remain acceptance work.

Gates: `verify-agent-compound.mts`, `verify-memory-redaction.mts`, `verify-life-event-engine.mts`.

## Sequence M — Purchase, delivery and warranty
1. Purchases/deliveries can become Life Events with provider/source provenance.
2. A known provider status URL is monitored read-only through Secure Computer.
3. First monitor check establishes a baseline; unchanged state remains quiet.
4. Meaningful delivery/order changes notify once and update Activity.
5. Delivered/refunded/cancelled terminal states close the monitor.
6. Return/cancel/reorder/purchase actions are never performed by the monitor.
7. Warranty/return-window reminders must be derived from known dates rather than invented.

Current state: lifecycle planner + read-only status monitor are being integrated. Provider-specific authenticated adapters and warranty-source parsing remain expansion work.

Gate: `verify-life-event-integrations.mts` plus Secure Browser gates.

## Sequence N — Bills and subscriptions
1. Bills/subscriptions become Life Events with due/renewal date provenance.
2. Background Gogo prepares a review before the due/renewal date.
3. Review explicitly states that no payment, renewal, cancellation or provider change occurred.
4. Payment/cancellation requires a separate user command + approval path.
5. Duplicate renewal alerts are suppressed.

Current state: renewal/bill review executor is being integrated. Provider-specific payment/cancellation execution remains approval-gated future work.

Gate: `verify-life-event-integrations.mts` plus policy/Sentinel gates.

## Sequence O — People, family and circles
1. Contact resolution may use connected Contacts only within permission scope.
2. Relationship context must not leak from one person/circle to another.
3. Birthday/follow-up/reminder workflows are normal reminder Life Events, not silent outreach.
4. Sending a message/email on behalf of the user always follows send permission/approval rules.

Current state: Contacts read + reminder/message safety exist; dedicated Circles UX/data model still needs implementation.

Gates: Workspace read tests + same-brain/policy tests. Dedicated Circle regression gate required before launch.

## Sequence P — Voice and multilingual India
1. Native voice capture reaches the same brain as typed input.
2. Reminder time parsing remains exact for spoken meridiem.
3. Kannada/Hindi/other supported-language inputs preserve intent rather than translating away dates/names.
4. Voice output never reads masked secrets aloud unless explicitly revealed.

Current state: voice capture/transcription path exists; multilingual acceptance matrix and native conversational voice output remain expansion work.

Gates: `verify-voice-reminder-meridiem.mts`, input-resilience tests. Dedicated multilingual regression gate required.

## Sequence Q — Expenses, receipts and splits
1. Receipt/document capture preserves source image/document provenance.
2. Merchant/date/amount extraction must identify uncertainty rather than inventing totals.
3. Expense categorisation may learn preferences but cannot silently create payments.
4. Splits require explicit participants/amounts and no money movement without separate payment approval.

Current state: generic document capture exists; structured expense ledger/split executor is not yet shipped.

Required before completion: expense schema, receipt parser tests, split-plan test, payment boundary test.

## Sequence R — Meetings and founder mode
1. Gmail/Contacts/Calendar/Drive context can prepare a meeting brief.
2. Ambiguous attendees/files/slots stop for clarification rather than guessing.
3. Calendar creation remains approval-gated.
4. Workspaces keep a meeting/project focused while sharing global Memory/permissions.
5. Artifacts preserve provenance.

Current state: Workspace meeting prep, approval and Drive context are shipped.

Gates: `verify-workspace-meeting-approval.mts`, `verify-workspace-drive-context.mts`.

## Sequence S — Health/wellness document reminders
1. Health-related documents may be captured as private documents/reminders.
2. AskGogo may remind about appointments, reports, prescriptions or expiry dates from user-provided data.
3. The autonomous brain must not silently diagnose, change medication or schedule medical treatment.
4. Sensitive health data must never leak into unrelated Memory/search/activity surfaces.

Current state: generic document/reminder infrastructure exists; dedicated health document classification and privacy regression suite remain to be built.

Required before completion: health document isolation tests + reminder-only executor tests.

## Sequence T — Monetisation, metering and integrations
1. Cost Guard meters model/search/background usage before expensive work.
2. Plan limits cannot silently disable safety gates.
3. Push/WhatsApp delivery costs remain attributable to a source run/watcher where possible.
4. Mobile device registration supports revocation.
5. External integrations fail closed when configuration is missing.
6. Production push configuration must be verified on a real Android device.

Current state: Cost Guard, mobile sessions/device registration and push backend exist; final Expo production push configuration and plan-specific product UX remain.

Gates: `verify-cost-guard.mts`, `verify-product-readiness.mjs`, mobile APK runtime smoke.

## Safety promises that must never regress
- Legacy deterministic WhatsApp features win before Muse-style agent fallback.
- Never claim a sensitive value was stored if the value was never supplied.
- Rejected approvals never execute.
- Duplicate URLs/topics do not spam the user.
- Draft/preparation mode must not submit, purchase, or commit an irreversible action.
- Any new charge or authentication challenge stops execution.
- Success requires terminal check-in confirmation evidence tied to the final submission.
- Uncertain execution never auto-retries an irreversible submit.
- Cron endpoints are protected by `CRON_SECRET`.

## Remaining P0 integration gaps
- Secure human takeover UI for browser authentication and uncertain external state.
- Persist/download the actual Gmail boarding-pass attachment bytes, not only strong message/attachment metadata.
- Provider-specific authenticated delivery/order adapters after the generic read-only monitor.
- Provider-specific bill/subscription payment or cancellation executors behind explicit approval.
- DigiYatra / country capability packs.
- Dedicated Circles, Expenses/Splits and Health-document schemas + regression gates.
- Multilingual native acceptance matrix and conversational voice-output acceptance tests.
- Production Expo push project configuration + physical-device delivery test.

These gaps stay visible until both executor and regression gate exist.
