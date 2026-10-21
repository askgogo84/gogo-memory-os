# AskGogo always-on implementation ledger

User goal: implement and test all ten areas from `docs/always-on-architecture-audit-20261021.md`, reconcile Claude's ongoing work, and improve complete user journeys. Comparative superiority over Grok/Instinct is a goal, not an established result.

## Coordination and continuation

Canonical bus: GitHub issue #274. Read latest comments, main, open PRs and AGENTS.md before every cycle. Initial audited main: `b563a57b6eeaa39aa48d0fdf6bbd1659ae3e3a40` (#734). Work PR #735 head `f12bdeb31a2872e5bf0205eb24520f09cc2fd584`; full328 local, build/types and CI39647299515 SUCCESS. It remains draft/unmerged; do not assume production includes it.

The user requested overnight continuation. Seven hourly scheduled cycles start 21 Oct 18:54UTC / 22 Oct 00:24IST, ending 22 Oct 00:54UTC / 06:24IST. They must reconstruct from GitHub, not transient sandbox paths. Read issue lease/heartbeat first to avoid overlapping work. Current cycle owns metering/metrics and runtime instrumentation only; reserve new files via #274 before the next slice. No merge or production deploy authority inferred from the request. No real sends, calls, bookings, payments, credentials or production-data mutations without specific approval. Local inert tests and migration preparation are allowed.

## Ten acceptance gates

| Gate | Concrete outcome and verification | Current state |
| --- | --- | --- |
| 1. Server/computer lifecycle | Destroy/recreate an isolated computer, retain server objective/checkpoints, restore owner/site context and resume a safe read. No server control state may exist solely on the VM. | Existing architecture separates them; ended-session adapter recovery tested. Full VM rebuild and real authenticated resume pending. |
| 2. Durable tasks | Crashes/timeouts never repeat uncertain mutations. Reads recover within attempts, obsolete workers cannot overwrite successors, cancelled/unknown runs cannot execute. Test duplicate scheduler events and interrupted approval. | #735 implements/tests eleven groups. Additional stale-snapshot claim fencing and durable child-driver coverage still need review. |
| 3. Cross-channel state | Same owner/run/typed object on WhatsApp↔dashboard, exact approval target retained; second owner cannot access or continue it. | Shared owner stores and synthetic checkpoint/refusal tests exist. Real phone journey pending. Review unchecked thread attachment writes. |
| 4. SendToUser | All background producers use existing receipt ledger through one policy gateway; quiet hours defer, opt-outs suppress, callbacks dedupe, unknown never blindly retries. | #735 closes notifier replay; direct producers remain. Next major implementation slice: run outcomes, browser notices, pulse and voice results. Reuse delivery ledger, do not create another one. |
| 5. Helpers | Durable parent/child lineage, isolated bounded source context, budgets, cancellation propagation, safe restart; no permission expansion. | Registry and parallel tool steps are not complete helper agents. Implementation outstanding. |
| 6. Vault/memory | Keep secrets separate, preserve claim provenance and corrections through compaction, remove stale temporary claims before rendering. Test repeated compaction/correction and owner isolation. | Existing context/source/date/secret gates; prose summary lacks claim-level provenance. Claude's memory-scope plan is a plan, not an implementation. |
| 7. Browser ownership | Sleep/wake/session loss and human takeover retain original objective; one automation/human owner; interrupted takeover safely resumes or explains block. | Persisted managed contexts, flock, handoff and orphan sweep exist; injected managed outage/restoration tests pass. Live authenticated and full VM loss acceptance pending. |
| 8. Security/evidence | Exact fresh action approval and provider proof at every consequential adapter; hostile source text cannot authorize. Include newly added voice calls in this gate. | Existing typed/hash/TTL guards; NEW confirmed voice-call intent gap noted below. Do not assume #735 covers it. |
| 9. Traceability | Link owner→run→step→attempt→decision/approval→provider evidence; record failed attempts and report coverage gaps when telemetry is missing. | Current slice adds async-local run/step/attempt propagation for persistent tools, trusted writer attribution and failed fetch observations. All execution entry points are not yet instrumented. |
| 10. Cost/latency | Report observed p50/p95, raw cache read/write, model calls and per-completed-task estimated cost with missing/truncated/unattributed coverage; no invented free calls or total coverage. | Current slice also rejects noncanonical/trailing admin cookie signatures (deterministic RED/GREEN) and adds owner-only bounded aggregate endpoint and observed metrics. Operator UI still needs unknown-price coverage labels; full specialist coverage and live measurements pending. |

## Claude change reconciliation

There are 68 main commits from the prior 19 Oct production handoff `07e8aa95` through #734. A complete commit/file inventory is in `always-on-claude-change-inventory.md`. Critical code review is ongoing; inventory is not a claim that every changed line or real journey is accepted.

Reviewed changes relevant to continuing safely:

- Understand-first and pending-question registry now precede many keyword handlers; retain them. Typed short replies resume only a fresh owner-bound question. Do not add a rival router.
- Freshness/numbered approval snapshots and completion-claim guards were added. Preserve their one-shot exact-object semantics.
- Calendar collapse/date handling, saved ticket/QR retrieval, source-first reservation slots, concise status and public search/provider fallback have changed. Reuse their current tests; older audit findings must be re-reproduced.
- Admin console and global fetch metering now exist; extend these rather than create a second ledger. Existing zero-default numeric cost columns require explicit unavailable-pricing metadata; they cannot be treated as proof of free calls.
- Dashboard shell, Gogo character states, root redirect and friendly task titles are Claude's functional/UI work. Work has not edited those files.

### Newly confirmed voice-call durability defects — prioritize next

`lib/agent/voice-call.ts` currently calls `placeCall` BEFORE persisting its `agent_runs` record. Two concurrent approvals can call twice; provider timeout or failed post-call persistence leaves no durable intent and replies "Nothing was called or booked" even when the provider may already have called. Current plain plan freshness also accepts negative ages and compares only presence of `CALL PLAN`, not the exact plan. These are concrete code-path findings, not live calls performed by Work.

Next isolated fix should create a deterministic owner/plan/attempt run claim BEFORE provider calls, fail closed on persistence failure, retain unknown outcomes/no blind redial, bind approval to exact displayed plan/time bounds, and fence concurrent result reporting. Use inert provider and storage tests with before/after RED controls. Verify provider ID read-back, exactly one booking/reminder record and once-only result notification. Never place a real test call in this engineering cycle. Coordinate ownership of voice-call.ts in #274 first.

## User-journey matrix

| Journey | Existing/required evidence | Live status |
| --- | --- | --- |
| Instagram auth → Vault/Take Control → same task | auth gate, vault resume, original objective and post-auth page proof | Pending human/provider authentication |
| Trip-context monitoring and expiry | contextual travel fixtures; exact owner/source/time bounds | Pending eligible live trip |
| Urgent Gmail → open loop → later resolution | mail attention/consent/completion evidence fixtures | Pending harmless owner-controlled mail |
| Watch create/list/stop and notification | watcher and delivery fixtures; stop must revoke exact queued alert | Real signed receipt pending |
| Recurring reminder, briefing, follow-up | PGlite delivery fixture; duplicate invocation and unknown-outcome controls | Real delivery pending |
| Calendar/Gmail approval and readback | exact-binding, TTL, typed mutation and provider-readback fixtures | Specifically approved real-object tests pending |
| Web↔WhatsApp continuation | canonical owner wiring and actual-runtime owner checkpoint test | Phone acceptance pending |
| Dining research, exact slot, name, approval, CAPTCHA handoff | Claude first-party/ReserveGo/booking/approval tests | No real booking performed |
| Phone-call booking fallback | Claude voice fixtures plus new pre-call intent/concurrency/timeout regressions required | No real call authorized or performed |
| Multi-person planning | mission consent, minimal availability, designated approver, verified delivery | T13 implementation remains open |
| Saved links/tickets/recall, calendar agenda, shopping, expenses | current registered functional suite | Passing fixtures do not establish all live flows |

## Current slice verification

Eight actual-module observability groups pass: parallel owner/task trace isolation; raw provider cache semantics; unpriced versus explicit-zero cost; trusted writer attribution; latency/cost coverage with missing/foreign rows; bounded owner-only storage reads; authenticated API/503 failure; unchanged fetch response/error with transport-failure capture. Existing reliability fixture additionally checks actual tool execution carries its trace. Full regression/build/typecheck results must be recorded in #274 and the PR at exact uploaded head before declaring the slice verified.

## Next cycles

1. Finish/review current observability slice and exact-head gates; keep scope honest about partial coverage.
2. Reproduce/fix voice-call intent, approval and reporting defects before any real call acceptance.
3. Consolidate background delivery with policy/quiet-mode/receipt evidence using existing notification ledger.
4. Implement bounded durable helpers and cancellation/recovery on existing runs/steps.
5. Add source-preserving memory compaction/correction/stale-claim tests without implementing unapproved enterprise scope changes.
6. Complete computer lifecycle/cross-channel/security fault matrix; reconcile remaining Claude use-case failures.
7. Re-run registered suite/types/build on final branches; post ready human tests and unresolved requirements. Never claim all ten gates or superiority from CI alone.

An initial full329 passed, but a later rerun exposed the preexisting noncanonical admin-cookie signature fixture failure. Deterministic equivalent-byte signature RED retained; parser fix rejects noncanonical base64url and trailing segments without changing HMAC/owner/expiry requirements. New registered inventory is330 commands. Re-run exact final gates before reporting green.
