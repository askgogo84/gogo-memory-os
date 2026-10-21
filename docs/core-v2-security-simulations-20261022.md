# Core V2 security and failure simulation report

Scope: inert execution of actual exported TypeScript modules and actual additive SQL in embedded PostgreSQL (PGlite), not live exploitation. Production was queried only for aggregate/catalogue/advisor metadata. No secrets, raw private conversations/documents, live sends or database writes.

## Verified boundaries

- Runtime22 review groups plus original11 fault groups: cancellation before dispatch; terminal completed/failed/unknown plans; stale attempt/lease/backoff ABA; immutable cached input replacement; exact owned approval suspension/resumption; changed same-run action/payload; expired/future grant; superseded checkpoint. Unknown provider effect is held; normal approved/read/retry controls still work.
- Browser41 groups: Sentinel/executor/network grants all reject mapped IPv6 loopback/metadata IPs, short/integer IPv4, localhost variants, internal/single-label names and userinfo; unobserved or query-mutated read destinations are denied. Exact observed query, relative links, current-page refresh and ordinary public search remain allowed. No live private-network probe.
- Run outcome27 groups: actual SQL claim/begin/finish and actual notifier preserve rolling old/new sender exclusion, owner/recipient/snapshot/STOP/quiet gates, bounded definitive retry, unstarted recovery and old token fencing. Timeout after synthetic effect/no SID stays unknown without resend; accepted is not delivered; verified read arriving before finish remains read.
- ACL12 groups: original ensure_memory_twin_user initializer reproduces anonymous/authenticated arbitrary-owner initialization before patch; migration denies both and preserves service execution, trigger initialization, false opt-out, byte-identical bodies, fixed qualified paths and idempotence. Trigger-only functions are reviewed as permission hygiene, not claimed as ordinary callable exfiltration endpoints.
- Voice15 groups: durable exact approved intent before provider call; ambiguous timeout is not blindly redialed. No actual telephone call.
- Memory16 groups: late workers cannot discard newer corrections by arrival order, microsecond cursor precision preserved, foreign-owner cleanup denied, read errors and saturated list fail closed, previous/final summary sensitive-text redaction.
- Existing registered adversarial approval, auth, owner isolation, webhook, browser authority and privacy assertions retained; fixture dependencies now explicitly bind the shared Sentinel/outbox.

## Scope still open

No comprehensive forged developer instruction, hidden document/email injection, malicious helper laundering or end-to-end destination-changing corpus certification. Deterministic owner/action checks resist the tested bypasses but cannot certify every tool path. DNS rebinding/redirect/subresource enforcement and full secret/log review need further work. PGlite row-lock syntax/sequential state tests do not demonstrate production multi-process PostgreSQL contention. No production provider effect or booking/payment reconciliation confirmation.

Security advisors:4 anon +4 auth warnings map to4 helpers; proposed ACL migration addresses them.13 mutable search paths, of which3 fixed;1 public vector extension.82 RLS-without-policy INFO entries are default-deny observations, not instruction to grant access. No global security PASS or production readiness claim.
