# Core V2 receipt-backed run outcome notices — 22 October 2026 IST

Stacked on #735. Reuses notification_deliveries and existing callbacks; no second ledger or scheduler. Existing completionNotice rendering and conservative legacy ambiguity handling remain. New background terminal checkpoints request notices explicitly; live notifyOutcome:false creates no outbox intent. A marker-only stale-close trigger atomically merges the same request into existing run JSON.

## Recovery and safety

- Stable occurrence: run_outcome/<run ID>/whatsapp with completed_at as due time.
- Service-only claim atomically locks run then ledger, bridges the old JSON CAS, and marks bridge-origin rows. Old and new workers cannot independently win. Legacy uncertain claims are never enrolled on age alone.
- Unstarted expired claims can recover. Started jobs remain outcome_unknown until receipt reconciliation. Definite rejection alone permits bounded retry/backoff through the existing RPC.
- Dedicated begin validates current owner, exact recipient, rendered status/title/summary/error/uncertainty snapshot, explicit request, STOP and quiet hours. Generic begin refuses run_outcome and preserves existing follow-up checks.
- Quiet deferral is unstarted/token-fenced, consumes no retry attempts, and is excluded before queue LIMIT.
- Callback HTTPS/token configuration is checked before begin. Provider SID/token/chunks feed existing signed receipt reconciliation. Accepted, delivered and read stay distinct; no SID means unknown.
- Compatibility notified flags are repairable projections of ledger acceptance. Flag write failure never permits another send. Existing cron repairs projections and consumes a bounded outbox pass; errors are reported in outcomeNotices counters.

## Inert verification

27 actual local PostgreSQL-compatible/producer groups PASS: new source, both legacy/new claim orders, legacy ambiguity, explicit request/live exclusion, owner/type guard, abandoned claim recovery, old-token fencing, unknown no-retry, definite rejection/backoff, quiet defer and due scan, changed recipient/outcome snapshot, STOP, receipt states, atomic stale marker, service-only privileges, actual notifier SID/token binding, timeout after effect, missing callback preflight, compatibility repair, generic-begin denial, started-job defer denial, read-before-finish and missing SID.

Original24 notifier groups, original11 fault cases, runtime22 review groups and existing delivery reliability suite retain their assertions. Independent review cleared focused source and independently ran27 groups. These use PGlite/inert transports, not real concurrent Postgres workers, Twilio delivery, approval cards or complete channel consolidation.

## Rollout and approval boundary

Do not deploy this slice before approved migration20261021190338_run_outcome_gateway.sql. Production catalogue confirms the claim RPC is absent at this checkpoint. The migration creates no provider calls, but it is still a production database change requiring specific user approval. Apply migration before app promotion; verify signatures/grants and queue behavior in a controlled environment. The bridge protects rolling old/new deployments. Code rollback can leave new outbox notices awaiting a future driver; preserve their ledger and never clear started/unknown intents to retry.

No production migration, send/call, credential use, booking, payment or account change occurred. All-channel SendToUser consolidation remains PARTIAL: migrate other producers incrementally while preserving their exact-source and notification preference semantics.
