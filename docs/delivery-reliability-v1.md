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
bounded retry with backoff. Pre-send infrastructure failures back off without
silently terminating the series. Only delivered/read are recipient-delivery proof.

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
