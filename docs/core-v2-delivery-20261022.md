# Core V2 engineering delivery checkpoint — 22 October 2026 IST

## Review candidate and scope

Integrated branch: feat/core-v2-integrated-hardening-oct22, base main b563a57. Production source checkpoint2cd4b568 (subsequent report-only commits do not change application logic). This combines overlapping drafts735–741 for one exact main-base CI run; do not merge each overlapping draft blindly. No production merge, deployment request or migration has occurred.

| Draft | Exact published source | Scope / independent evidence |
|---|---|---|
|735|582e35e7e0aa228eb280f6f2cefad6017ef09470|11 original fault groups,22 runtime review groups,329 local commands/types/build; CI39660465551 SUCCESS|
|736|dffcf9dcd7049a7f5e295859d4dd52cac8361f0e|task metering8 groups and canonical admin-cookie fix; stacked base has no separate main-base CI|
|737|848b480d9d3be45660c019120afc8b1b75d4bdb4|voice durable intent15 groups; CI39652367500 SUCCESS|
|738|ac03fcfa640e112d9801288fad652f074f1e3da2|browser41 groups and retained provider/search/auth controls; CI39659682622 FAILED preexisting admin-console signature assertion, whose parser fix is retained from736 in integrated source|
|739|2f3ca5cf17e531e69e2ef99658565a377c3fcfb3|summary16 groups,328 local commands/types/build; CI39659613505 SUCCESS; independent source review|
|740|576261284d7cb978cc38d8aa31c954c67f3e1fa4|helper ACL12 actual SQL groups; CI39661768325 SUCCESS; independent SQL review|
|741|1ee0bbf8539d9e4ea5181a87cc3630c3f7f5f3dd|run outcome27 SQL/producer groups; legacy24, fault11/runtime22 retained; stacked CI covered by integration|

Independent reviewers examined runtime immutable inputs/approval recovery, browser authority, memory cursor races, notification rolling-worker/receipt races and SQL permission scope. Final runtime cleanup independent22+backoff/canonical-order controls pass; reviewed SHA2562AA5FBEBD3D1C7247CC978A0D3BE39F7F9AAB38650056945A2521BC4AAF68885. No blocking finding in these scopes. These are engineering reviews, not a GitHub maintainer approval or production security certificate.

## Gates and archived failures

The integrated pre-cleanup336-command run, normal build and types exited0. Final source narrows introduced loose types and replaces unused digest destructuring with equivalent clone/delete lists; no increase in per-file/rule lint findings. Exact final-source suite/build/type and Linux main-base CI results are recorded in the integration PR/checks and issue274. Do not reuse another SHA's CI.

Preserved failures: baseline runtime race/approval/input REDs, browser alias REDs, actual initializer anonymous/auth denial RED, gateway missing-policy RED; strict fixture missing shared Sentinel/outbox declarations fixed explicitly without weakening assertions. Browser standalone CI currently fails canonical-signature assertion; integrated source includes the existing736 fix. All raw local logs remain under work/core-v2-*; delivery packet hashes them. No failure is silently treated as success.

## Acceptance and production

Canonical acceptance extraction:25 original report rows plus10 further/addendum rows, including T1–T14 and C1–C4. Original document's recorded SHA256 CE5B185A2E78A1F6D802B26F31A9D9C8CCFE50C012070B8ED4F07D6B7E080683; original DOCX bytes unavailable in this checkout, so not rehashed. Tiny image attachments cannot establish exact prompt transcription.

Fresh manual scorecard:35 NOT TESTED, zero invented provider confirmations. Local outputs/ contains JSON with exact available prompts/procedure, expected/actual/status/evidence/source/deployment/defect fields and standalone HTML with copy controls. Historical UI/provider observations stay historical. Signed-in chat tests write conversation state and may trigger effects; they were not sent without specific scope approval.

Canonical app.askgogo.in resolves to READY dpl_FWEZ3TvN6RsHAxvfX2wvdGfpH6Ta, SHA b563a57. New ledger RPC absent in production catalogue. Source passing does not establish deployed behavior. Read-only aggregate baseline is in core-v2-performance-baseline-20261022.md.

## Required release decisions and remaining work

1. Obtain repository-required independent approval/checks for the combined candidate; choose integrated PR instead of duplicate overlapping merges.
2. Specific production authorization must name20261021190338_run_outcome_gateway.sql and20261021192533_memory_rpc_permissions.sql, then approved merge/deploy. Review backup/rollback and schema/code ordering through the existing process. Do not roll back safety ACLs by reopening PUBLIC execute.
3. After authorized apply, verify function signatures, service-only grants, trigger/source registration and constraints. After deployment verify exact SHA/health; perform safe canary before expanding.
4. Separately authorize exact owner-controlled provider tests: Instagram/browser human auth, harmless Gmail/Calendar objects, reminders/briefings/outcomes, approved voice-call target. No blanket booking/payment/send approval inferred. Human handles OTP/CAPTCHA/passkeys/payment authentication.
5. Continue P1 helper durable contract, claim provenance/temporal expiry/backlog coverage and full-channel gateway inventory. Continue deterministic egress/injection/stop governance. These are remaining engineering scope, not passed production gates.
6. Measure attributed task cost/latency/cache/verified outcomes after instrumented rollout. No evidence justifies replatforming or swapping Jev.

Recommendation: production readiness NOT ESTABLISHED. This is a reviewed hardening candidate with explicit blocked rollout/acceptance and residual implementation gaps.

## Exact file inventory

The following list is the cumulative application/test/report change versus main at publication. Local outputs/core-v2-source-inventory.json contains source hashes; the Git PR Files view is authoritative for later doc-only commits.

- app/api/cron/autonomous-runs/route.ts
- app/api/dashboard/agent/metrics/route.ts
- docs/always-on-architecture-audit-20261021.md
- docs/always-on-claude-change-inventory.md
- docs/always-on-implementation-ledger.md
- docs/always-on-memory-compaction-20261022.md
- docs/core-v2-browser-security-20261022.md
- docs/core-v2-gap-matrix-20261021.md
- docs/core-v2-memory-rpc-security-20261022.md
- docs/core-v2-run-outcome-gateway-20261022.md
- docs/voice-call-durability-20261021.md
- lib/admin/console-auth.ts
- lib/agent/autonomous-runtime.ts
- lib/agent/browser-page-network.ts
- lib/agent/conversation-summary.ts
- lib/agent/run-notify.ts
- lib/agent/run-outcome-delivery.ts
- lib/agent/secure-computer.ts
- lib/agent/sentinel.ts
- lib/agent/voice-call-execution.ts
- lib/agent/voice-call.ts
- lib/metering/core.ts
- lib/metering/fetch-meter.ts
- lib/metering/record.ts
- lib/metering/task-measurements.ts
- lib/services/notification-delivery.ts
- package.json
- scripts/verify-admin-cookie-canonical.mts
- scripts/verify-always-on-faults.mts
- scripts/verify-appointment-autonomy.mts
- scripts/verify-auth-context-regressions.mts
- scripts/verify-browser-authority-bounds.mts
- scripts/verify-browser-search-controls.mts
- scripts/verify-browser-url-boundary.mts
- scripts/verify-browser-widgets.mts
- scripts/verify-commerce-browser-lifetime.mts
- scripts/verify-device-auth-handoff.mts
- scripts/verify-memory-rpc-permissions.cjs
- scripts/verify-oct18-review-regressions.mts
- scripts/verify-provider-booking.mts
- scripts/verify-reservation-research-recording.mts
- scripts/verify-run-cancel.mts
- scripts/verify-run-outcome-gateway.cjs
- scripts/verify-run-outcome-notice.mts
- scripts/verify-runtime-fencing-review.mts
- scripts/verify-summary-durability.mts
- scripts/verify-task-observability.mts
- scripts/verify-voice-call-durability.mts
- supabase/migrations/20261021190338_run_outcome_gateway.sql
- supabase/migrations/20261021192533_memory_rpc_permissions.sql
