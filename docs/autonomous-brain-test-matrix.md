# AskGogo Autonomous Brain — Canonical Night-Build Test Matrix

This matrix is the production regression contract for the AskGogo autonomous brain. It keeps WhatsApp, dashboard, memory, planning, approvals, Background Gogo, Workspace, Secure Computer, Life Events and self-learning on one end-to-end test path.

## Sequence A — Same brain, every surface
1. WhatsApp and dashboard use the same user identity and memory.
2. A reminder/list/task created from either surface is visible to the same brain.
3. Legacy deterministic WhatsApp features win before Muse-style agent fallback.
4. Dashboard Agent requests and WhatsApp Agent requests route through the same policy/safety layer.
5. Approval state is shared without duplicating the run.

## Sequence B — Capture → remember → retrieve → act
1. Save a normal memory and retrieve it semantically later.
2. Save a sensitive identifier; mask it by default and require explicit field-bound reveal.
3. Never claim a sensitive value was stored if the value was never supplied.
4. Convert a memory into a reminder/action without losing source context.
5. Extract dates from documents/tickets/bills and turn them into proactive lifecycle work.
6. Self-learning only promotes evidence-backed preferences with provenance.

## Sequence C — Low-risk autonomous execution
1. One-time reminder executes under safe auto permission.
2. Recurring reminder cadence remains timezone-safe and deduplicated.
3. Voice reminder such as `9:30 a.m.` parses exactly.
4. Lists and tasks remain separate first-class capabilities.
5. Safe reversible actions auto-run only when permission allows it.
6. Cost Guard remains active.

## Sequence D — Plan → approve → execute
1. Calendar mutations create a plan and approval rather than silently writing.
2. Medium/high-risk actions cannot execute before approval.
3. Rejected approvals never execute.
4. Approved runs execute once only under retries/concurrency.
5. Payments/purchases remain high-risk and irreversible.
6. Execution appears in the activity/audit trail.

## Sequence E — Background Gogo: watch → detect → notify
1. Create a bounded background watcher from a user outcome.
2. Duplicate URLs/topics do not spam the user.
3. Relevance, cooldown and daily notification caps are enforced.
4. Meaningful change produces one high-signal notification with provenance.
5. Goals can create proactive ideas/background work while preserving approval boundaries.

## Sequence F — Google Workspace autonomous brain
1. OAuth scopes remain least-privilege and linked to the same AskGogo account.
2. Email/Drive context may be read only when permission allows it.
3. Consequential calendar/email mutations remain approval-gated.
4. Drive context is usable for reasoning without leaking unrelated content.
5. Workspace actions preserve provenance.

## Sequence G — Secure Computer + Sentinel
1. Browser permission `off/read` blocks autonomous external-state mutation.
2. Sentinel evaluates browser work before launch and again before approved execution.
3. Draft/preparation mode must not submit, purchase, or commit an irreversible action.
4. Password/OTP/CAPTCHA/passkey/passport/payment-auth gates stop autonomous execution.
5. No new charge without separate approval.
6. Browser exceptions fail closed.

## Sequence H — Travel intelligence → calendar → lifecycle
1. Travel research does not fabricate availability.
2. Selected travel may prepare itinerary/calendar work behind approval.
3. Parsed flight ticket is promoted into a durable Life Event.
4. Flight lifecycle includes check-in prep, approval, execution and post-check-in watching.
5. Only verified airline check-in URLs are used.
6. Booking reference/PNR is transient inside Secure Computer.

## Sequence I — Autonomous flight check-in
1. Due flight wakes Background Gogo.
2. Worker prepares check-in in draft mode only.
3. Browser policy + Sentinel are checked before preparation.
4. User receives explicit high-risk check-in approval.
5. WhatsApp `APPROVE` and dashboard `Approve & run` dispatch the same executor.
6. Execution claims the approved run atomically.
7. Only free seat allocation is allowed unless separately approved.
8. Any new charge or authentication challenge stops execution.
9. Success requires terminal check-in confirmation evidence tied to the final submission; generic page text is not enough.
10. After verified success, the life event moves to `watching`.
11. Uncertain execution never auto-retries an irreversible submit.

## Sequence J — Proactive daily brain
1. Daily brief combines weather, calendar, reminders/tasks and priorities.
2. Today/dashboard source the same data.
3. Greeting and scheduling are local-time aware.
4. Background learning/watchers stay quiet unless useful.

## Sequence K — India launch / production readiness
1. Mobile/dashboard flows remain usable after agent changes.
2. Permissions are explicit for reminders, lists, tasks, email, calendar, browser, contacts and travel.
3. Consequential actions always ask regardless of optimistic model output.
4. Cron endpoints are protected by `CRON_SECRET`.
5. Production build runs the entire regression suite before `next build`.
6. Product-readiness and launch regressions stay green.

## Sequence L — Documents / identity / expiry lifecycle
1. Documents are classified and indexed by meaning, not only filename.
2. Lease/policy/licence/passport/warranty dates become evidence-backed reminders.
3. Sensitive values remain masked and explicitly revealed only when requested.
4. Missing values are never fabricated or falsely confirmed.

## Sequence M — Purchase / delivery / warranty lifecycle
1. Purchase/order confirmation becomes a Life Event.
2. Delivery tracking watches meaningful status/ETA changes only.
3. Return/refund deadline becomes a proactive reminder when evidence exists.
4. Warranty end becomes a proactive reminder when evidence exists.
5. Purchase/refund mutation remains explicit-approval only.

## Sequence N — Bills / subscriptions lifecycle
1. Due/renewal dates are extracted from evidence.
2. Proactive notice is sent before due/renewal.
3. Silent autopay is forbidden; payment remains explicit-approval only.
4. Cancellation deadlines are surfaced when known.
5. Dedupe prevents repeated bill/renewal reminders.

## Sequence O — Friend / family / circle
1. Friend-to-friend reminders require recipient consent before activation.
2. Outbound shared reminders honor per-sender STOP/opt-out.
3. Family mode supports shared reminders, household tasks, bills and lists.
4. Contacts permission applies before resolving recipients.
5. Private memory is not leaked into shared flows.

## Sequence P — Voice / multilingual India flows
1. Voice notes are transcribed and routed into actions, not just stored.
2. Hindi/Hinglish and supported regional-language commands reach the same capabilities.
3. Time expressions remain timezone-safe.
4. Replies remain concise enough for WhatsApp/lock-screen use.

## Sequence Q — Expenses / receipts / split
1. Receipt images are parsed with provenance.
2. Expenses are stored and categorised.
3. Group splits preserve equal/unequal/%/shares rules.
4. Payment execution stays separate from bookkeeping.

## Sequence R — Meetings / founder mode
1. Meeting audio/text produces summary, decisions and action items.
2. Action items may become tasks/reminders.
3. Follow-up email/calendar actions are drafted and approval-gated.
4. Gmail/Drive/Calendar use least privilege and same identity.

## Sequence S — Health/wellness document reminders
1. Health records/prescriptions can be stored as documents.
2. Medicine/refill/renewal reminders require user-provided evidence.
3. No autonomous diagnosis, prescription or treatment change.
4. Sensitive health content follows privacy/reveal rules.

## Sequence T — Monetisation / metering / integrations
1. Razorpay flows retain explicit confirmation and idempotency.
2. Usage/metering rules remain enforced.
3. Cost Guard protects expensive autonomous loops.
4. CreditIQ integration stays permission-scoped.

## Explicit next milestones — test stubs must remain visible until implemented
- Boarding-pass Gmail executor and attachment lifecycle.
- Generic event/reservation calendar executor from Life Events.
- DigiYatra / country capability packs.
- Secure human takeover UI for browser authentication and uncertain external state.
- Purchase/delivery lifecycle executors.
- Bills/subscriptions lifecycle executor.

These are not allowed to disappear from the test plan merely because their executors are not yet shipped.
