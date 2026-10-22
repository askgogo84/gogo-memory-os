# Core V2 live gap and risk matrix — 22 October 2026 IST

Supersedes the earlier19-group/RUNNING checkpoint. Current candidate source:2cd4b568; main/deployed:b563a57. IMPLEMENTED means source exists; VERIFIED always names scope. PARTIAL/MISSING/BLOCKED never imply acceptance. No production effects performed.

| Priority / requirement | State | Evidence / risk | Next action or concrete dependency |
|---|---|---|---|
| P0 mutation timeout/crash/unknown replay | IMPLEMENTED / VERIFIED inert |735 original11 + review22: unknown quarantined, terminal dispatch blocked, finite recovery | Provider-specific read-back/reconciliation; never auto-retry unknown |
| P0 stale worker/replan/approval bypass | IMPLEMENTED / VERIFIED inert | attempt/lease/token/input fences, owner/run/action/hash/TTL binding; independent review | Cross-row atomicity and already in-flight external cancellation remain limited |
| P0 browser destination authority | IMPLEMENTED / VERIFIED41 groups | mapped/short/integerIP,localhost aliases,internal/single-label,userinfo blocked; exact observed full query required | Audit DNS/redirect/subresource enforcement; not a global SSRF certificate |
| P0 arbitrary-owner initializer access | IMPLEMENTED / VERIFIED12 SQL groups; BLOCKED rollout |740 revokes anon/auth/PUBLIC on4 helpers; service/trigger/opt-out preserved | Specific approval to apply20261021192533_memory_rpc_permissions.sql; catalog proof after apply |
| P0 admin cookie canonical encoding | IMPLEMENTED / VERIFIED integrated |736 rejects alternative encodings; preserves signature test |738 independent CI failed this baseline issue; do not call it green; integration includes fix |
| P0 voice ambiguous execution | IMPLEMENTED / VERIFIED15 groups |737 durable approved pre-intent and no blind redial | No real calls authorized or made; callback/provider lifecycle pending |
| P0 sensitive summary exposure | IMPLEMENTED guards / PARTIAL live | Existing privacy tests plus739 previous/final-summary redaction and failed-read controls | Passport/UI/provider review with synthetic or user-controlled documents; no field exposure claim |
| P1 durable outcomes/notification ambiguity | IMPLEMENTED / VERIFIED27 SQL/producer groups |741 stable run/channel ledger, legacy bridge, owner/snapshot/STOP/quiet, SID receipts, unknown no resend | Specific approval to apply20261021190338_run_outcome_gateway.sql and deploy; PostgreSQL/Twilio proof pending |
| P1 worker loss/resume/timers/approval | IMPLEMENTED / VERIFIED inert / PARTIAL | durable checkpoints, dependencies/backoff, bounded reads, exact suspension/resumption | Controlled worker/browser loss and real authenticated same-objective recovery |
| P1 memory ordering/cleanup | IMPLEMENTED / VERIFIED16 groups |739 microsecond cursors, owner cleanup, saturation/error failure, late-worker correction preservation | No claim-level provenance, contiguous source coverage or semantic expiration;40-message backlog gap |
| P1 helper task protocol | PARTIAL / MISSING uniform contract | specialist routing and existing run infrastructure only | Separate durable child-task IDs, least privilege contexts, budgets, cancellation and evidence implementation |
| P1 all-channel SendToUser | PARTIAL | WhatsApp run outcome adapter and voice pre-intent hardened | Email/dashboard/voice/helper paths need inventory/consolidation without weakening approvals |
| P1 C1–C4/T1–T14/addenda | NOT TESTED fresh / BLOCKED provider actions |35 manual scorecard rows, historical evidence separate | Owner sign-in and exact scoped sends/record changes approval; no production acceptance invented |
| P1 remaining governance | PARTIAL |13 mutable search-path warnings, proposed fix3; vector extension public; RLS INFO default-deny | Review remaining10 functions individually; emergency-stop/resource scopes and webhook/egress inventory |
| P2 task observability/cost | IMPLEMENTED prospective / PARTIAL measured |7368 groups; production174 historical records,0 attribution/latency metadata | Deploy approved instrumented source, measure representative cohort and coverage |
| P2 Jev accuracy/latency | PARTIAL / NOT MEASURED | existing calibration/guarded-live retained | Representative labelled intent evaluation; no unmeasured model swap |
| P2 browser costs/profile lifecycle | PARTIAL / BLOCKED observed proof |12 stored Browserbase session charges in aggregate | Isolated human/provider access; actual compute minutes/startup/profile persistence unknown |
| Release/production readiness | NOT ESTABLISHED | No main merge/deploy/migration; exact source gates recorded separately | Reviewed integration PR + required authorization, migrations and observed canary |

The review package preserves earlier RED runs and exact file inventory. Legacy source/fixture green is not production acceptance. No assumption of unpublished Claude work; issue274 is the coordination authority.
