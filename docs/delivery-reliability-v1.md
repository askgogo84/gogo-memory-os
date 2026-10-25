# Delivery Reliability v1

## Reminder occurrence boundary

The existing reminder row ID is the durable occurrence identity. A conditional
database update gives one worker a 90-second lease. At most 50 candidates are read
per invocation; no new send starts after the 45-second processing deadline.
Expired claims can recover only while `send_started_at` is null. Legacy changes to
the due time, content, recipient or cadence invalidate an unstarted claim, and a
legacy cancellation (`sent=true`) blocks the final begin transaction.

Before a network send, the begin transaction creates the successor and records
`outcome_unknown`. A failed successor insert rolls back both writes, leaving the
current occurrence retryable. A unique parent ID prevents two successors. Intervals
coalesce an outage into one notification and the first future due instant, retaining
the original cadence anchor; follow-up recurrence still stops at 20 nudges/7 days.
No extra stop notification is sent outside the occurrence protocol.

Consent is checked after content preparation, immediately before the begin RPC.
The existing friend-recipient feature gate and owner-only buttons remain. A consent
lookup error sends nothing. Cancellation after the durable send boundary cannot
recall a provider request that may already be in flight.

## Delivery semantics

`pending` → `claimed` → `outcome_unknown` → `provider_accepted` → `delivered` → `read`.
Other outcomes are `failed`, `suppressed`, and `cancelled`. `outcome_unknown` is
deliberately written before contacting the provider: crash-after-send, lost response,
5xx, timeout, and failed acceptance persistence must not lead to blind resends.
A definite 4xx rejection (except timeout), with no earlier accepted chunk, permits
bounded retry with backoff. Pre-send infrastructure failures back off, then become visible failed/dead-letter
items after three failures. Exhausted preflight preparation needs operator review
because no successor is invented when preparation never completes. Only delivered/read are recipient-delivery proof.

Legacy `sent` means consumed, not delivered. It stays false during a claim and may
stay false for unknown outcomes; queue readers must also filter delivery_state.
The response's legacy `sent_count` aliases `accepted_count`, not verified success.
Historical sent rows without provider evidence migrate to outcome_unknown.

## Rollout and verification

Apply `20260925110046_reminder_delivery_leases.sql` before deploying its worker.
The migration is additive and grants worker RPC execution only to service_role.
It changes neither cron definitions nor their frequency. Do not roll back to a
worker that ignores delivery_state while ambiguous rows exist: it would re-send
those rows. Old in-flight invocations during deployment do not participate in the
new claim protocol; inspect their completion before considering rollout validated.

The PostgreSQL fixture suite executes the actual SQL functions and actual HTTP
handler with provider calls mocked. It covers competing claims, stale fencing,
expired leases, crash-after-intent, cancellation/content changes, successor rollback,
catch-up, opt-out, overlapping HTTP workers, and failed persistence after acceptance.
PGlite serializes SQL execution; the conditional update is exercised, but this is
not a multi-connection PostgreSQL stress test.

Production tests require a human-approved recipient and exact message: one one-off,
one recurring reminder, and a receipt check by SID. Never invoke a production cron
manually as a test. Provider acceptance alone does not pass acceptance.

## Signed callback inbox and reconciliation

Apply `20260925111441_delivery_callback_inbox.sql` before deploying the callback
receiver. The Twilio SDK validates the configured public URL, complete form body,
and optional attempt/chunk query parameters. Missing/invalid signatures write nothing.
Valid events are deduplicated and committed to a private inbox before HTTP 200;
persistence failure returns 503. Processing failure after persistence is safe to
acknowledge because the existing reminder cron reconciles at most 100 events per
run. Unmatched legacy SIDs are retained and retried every 15 minutes; newer signed
callbacks carry the attempt token so even a lost SID-write response can be matched.

Every correlated chunk's SID and acceptance are persisted. All expected chunks
need signed delivered/read evidence before the occurrence qualifies as delivered;
all must be read before read is recorded. Late queued/sent/failed events cannot
regress delivered/read. A partial send or post-acceptance storage error stays
ambiguous and cannot trigger a blind resend. Reconciliation never queues or sends.
The receipts table contains no message bodies or recipient addresses. Both new
tables enable RLS and revoke anonymous/authenticated access.

## Briefings

`notification_deliveries` holds a unique `(source/owner/local-date/channel)` key.
Claims, lease recovery, pre-send intent, bounded known-rejection backoff and unknown
no-retry mirror reminders. Legacy markers/logs protect the transition day. An error
reading those markers fails closed. Legacy-log failures after acceptance do not
report successful sends and do not permit duplicate retry.

Briefings retain the existing Asia/Kolkata interpretation and 15-minute schedule.
They catch up any time after the requested time on the same day; yesterday's brief
is never replayed. Keyset pages of 50 users and a saved scan cursor (including
negative legacy owner IDs) continue beyond the old 150-user cap, bounded by 500
users and a 45-second deadline. The final destination and channel preference are
re-read immediately before beginning the send.

WhatsApp uses correlated chunk receipts. Email saves the Resend ID and keeps the
stable owner/day idempotency key. Up to 10 oldest-checked accepted emails are read
back from Resend within an eight-second reconciliation budget on each existing
briefing run. Only matching provider IDs with delivered/opened/clicked evidence
qualify as delivered. Sent/queued/HTTP 200 are not delivery evidence. API failures
stay visible and never trigger resend. A sending-only Resend key needs read access
before receipt reconciliation can succeed; do not assume key presence proves it.

## Follow-ups

Creation stores the authenticated owner's ID as well as their bound WhatsApp
destination. Legacy rows without an owner are not guessed from phone numbers and
cannot send. The production table was empty before this migration.

The existing daily endpoint selects at most 50 due, retry-eligible jobs and stops
starting work at 45 seconds. Each item independently uses the notification claim
protocol. It rechecks source status/content/due time, current owner's destination,
and consent immediately before send. An approved plain reminder template is
required; owner-reminder action buttons do not apply to this separate table.
The message asks the owner to follow up without asserting that no reply exists.

`fired` and `accepted` count only provider acceptance with successful source-table
persistence, never recipient delivery. A failed update returns an item failure;
the durable job prevents a repeat. Signed callbacks synchronize delivery_status.
Backoff makes a job eligible later, but dispatch still follows the unchanged daily
follow-up schedule. No second scheduler was added.

## Monitoring and learning evidence

Overnight boundary audit: workers now check their deadline again after the final
asynchronous eligibility lookup. Both preflight errors and definite provider
rejections exhaust after three attempts into explicit failed records, removing
permanently broken work from the hot queue. Ambiguous sends remain non-retriable.
An exhausted preflight recurrence is visible as failed and needs an operator's
review; no successor or delivery is fabricated when preparation cannot complete.
The follow-up send-intent transaction locks and rechecks the source row's owner,
pending status and due time so cancellation during the claim cannot send.

Every authorized existing scheduler invocation writes its own start/completion
heartbeat. Crashes leave an unfinished run; DB failures return 503. No monitoring
scheduler or outbound alert sender is added. Runs retain 30 days with bounded
cleanup. `/api/admin/delivery` requires the existing admin session and returns
no-store aggregate JSON without recipients, messages or provider IDs. It reports
queue depth/oldest overdue age, scheduler success age, accepted-without-receipt
age, failures, new ambiguous outcomes, historical unconfirmed rows, unmatched
callbacks and duplicate attempt/chunk provider-ID groups. Missing heartbeats are
`not_observed`; stale thresholds are 3 minutes, 30 minutes and 25 hours for
reminders, briefings and follow-ups respectively. These are diagnostic thresholds,
not new schedules. Unstarted briefings from older IST days expire rather than
accumulate or replay; accepted/unknown attempts are never changed by cleanup.

Same Brain delivery learning requires an explicit occurrence/job reference,
owner-bound lookup and durable delivered/read state. A caller's verified boolean,
HTTP 200 or SID alone produces `unknown`, including DB lookup failures. Canonical
CRUD/read-back learning remains distinct from recipient-delivery evidence. These
cron workers do not fabricate learning events for provider acceptance.

## Controlled production acceptance (human authorization required)

Specify one authenticated owner, their verified WhatsApp destination, an exact
test message, and the approved execution window. Create a one-off reminder and
one recurring reminder through the normal owner UI. Let the existing minute cron
dispatch them; inspect the attempt, SID, signed inbox events, and delivered/read
state. Confirm only one send per occurrence and exactly one future successor.

For a follow-up, create a uniquely labelled record through authenticated POST
`/api/followups` (contact and context only; never a supplied destination). Confirm
the saved owner/destination. Schedule its check_at for the next existing daily
run, or separately authorize an exact row's test-time adjustment. Let the scheduler
run, then verify fired/accepted persistence and the SID-backed delivered/read
receipt. No bulk cron invocation is part of this test.

For briefings, authorize an enabled owner and their chosen time/channel. Let the
15-minute schedule run, then verify one owner/day/channel job and every WhatsApp
chunk's receipt or the exact Resend ID's delivery read-back. Opt-out, failures,
timeouts, competing workers and outage simulations remain isolated fixture tests;
do not inject these into production without separate approval.


## Aggregate delivery health details

The existing administrator-only delivery endpoint now reports per-source state
counts, active and expired unstarted leases, and failed jobs exhausted after three
attempts (dead letters). State totals include historical rows and must not be read
as a new-release conversion rate. Unknown sends remain excluded from retries.

Observed acceptance-to-delivery latency covers WhatsApp occurrences with persisted
acceptance in the last seven days and signed delivered/read arrivals for every
expected chunk. It measures acceptance persistence to the last first-confirmed
chunk arrival, not a handset timestamp. Later read callbacks cannot inflate the
original delivery observation. Early callbacks preceding acceptance persistence
are counted separately and excluded from latency percentiles. Missing or partial
receipts produce no sample; empty samples have null percentiles. Email delivery
read-back remains supported but is excluded from this callback-based latency metric.

All fields are aggregates. No owner IDs, phone numbers, message bodies, provider
IDs or credentials are returned. Both health RPCs remain security-invoker functions
with execution restricted to service_role; the HTTP endpoint retains admin auth.
