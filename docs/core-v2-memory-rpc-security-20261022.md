# Core V2 memory helper RPC permissions — 22 October 2026 IST

Read-only live catalogue inspection on AskGogo's existing backend qenhjcooyecmatwducpu found public.ensure_memory_twin_user(bigint) SECURITY DEFINER executable by anon/authenticated. Its body inserts missing consent/profile defaults for a supplied owner ID. It returns void, does not return private records and does not reset existing opt-outs (ON CONFLICT DO NOTHING). No production invocation or mutation was performed.

The three associated trigger-only helpers also had public/client EXECUTE grants. PostgreSQL trigger functions are not ordinary direct-RPC functions; this report does not claim they were directly exploitable. The repository has no application/lib RPC caller of the initializer; existing database triggers are its concrete consumers.

## Narrow change

Migration20261021192533_memory_rpc_permissions.sql revokes EXECUTE from PUBLIC, anon and authenticated on four exact signatures and grants service_role. Existing owners, bodies, SECURITY modes, consent defaults and behavior-event payloads are preserved. Three fully qualified memory helpers receive fixed empty search_path. The enrichment trigger retains its existing public search path because it uses unqualified references; no unverified mode change is introduced. Optional absent legacy helpers are skipped so fresh installations remain viable. The migration is idempotent and lock-bounded.

Behavior-event raw text/message is used by owner-facing semantic memory search (memory-control.ts); it is not simply operational telemetry. Sensitive-content minimization and retention need a separate tested change. This patch does not delete historical data or disable recall.

## Local attack simulation and controls

scripts/verify-memory-rpc-permissions.cjs uses PGlite, the actual existing initializer SQL and synthetic owner IDs. Before the patch, eight of twelve groups fail: anonymous/signed-in invocation initializes missing owner records despite table RLS, public/client ACL checks remain open, and search paths are mutable. After the patch12/12 PASS:

- Anonymous and authenticated calls are denied before any row is created.
- Four exact function signatures are service-only.
- Normal service initialization works and explicit opt-out stays false.
- Existing trigger privilege behavior still works (a minimal trigger fixture, not every production trigger body).
- Function bodies remain byte-identical.
- Three fully qualified helpers have fixed search paths.
- Reapplication and absent optional legacy trigger helpers remain safe.

Independent source review confirms the scope. The three trigger fixtures isolate ACL behavior and do not certify their full business logic. Production catalogue additionally confirms anon/authenticated cannot CREATE in public. No live attack request was sent.

## Deployment and remaining risk

Requires specific approval before production migration. Verify exact grants, normal service-trigger behavior in a controlled environment and rerun security advisors after an approved rollout. No production readiness claim. Remaining existing advisor items include other mutable-search-path helpers, vector extension placement and82 INFO findings for RLS-without-client-policies; server-only tables must not receive broad policies merely to silence the advisor. No assertion that an INFO item is a data exposure.
