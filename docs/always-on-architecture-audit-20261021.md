# Always-on agent architecture and fault audit — 21 October 2026

## Scope and acceptance ledger

Baseline: `b563a57b6eeaa39aa48d0fdf6bbd1659ae3e3a40` (main). Read AGENTS.md, CLAUDE.md, issue #274 and all returned coordination comments before editing. Open PR inventory includes #669 gold title, #663 FX, #564 scrolling, #325 reasoning gateway and older work. Latest main includes #730 functional fixes and #731–734 dashboard work. Isolated Work branch: `fix/work-durable-unknown-outcomes-20261021`. File ownership declared in #274 before implementation. No active Claude files were edited in a shared checkout; this is a separate clone. Unpublished Claude work cannot be observed, so the ownership declaration remains the coordination mechanism.

Production: NOT independently SHA-verified. Latest historical #274 handoff reports `07e8aa95` on 19 October; main has advanced substantially. GitHub connector does not permit the attempted deployments endpoint. Repository implementation, fixture verification, deployed state and human acceptance are separate. No credential use, real sends, bookings, payments or production database changes in this audit.

Sources: [Lee Robinson CS146S video](https://www.youtube.com/watch?v=L1OBRtfPS34), [transcript](https://www.peterp.me/transcripts/how-grok-bot-works/). YouTube returned only its page shell; the transcript supplies the technical content. This comparison is architectural, not a claim to inspect Grok's private implementation. Lecture anchors: server/computer separation 13:15–15:06; durable recovery 16:17; messaging gateway 18:21; helpers 23:30; safety 26:30; cache/compaction 27:47–33:50. Preserve the existing components; no evidence supports replacing them wholesale with Temporal or another framework.

Acceptance criteria: map all ten requested areas to exact code, evidence, gaps, risk and smallest next change; reproduce confirmed P0/P1 defects before changing production code; exercise all six requested fault classes with inert dependencies; run targeted, registered full suite, typecheck and build; open reviewable PR; coordinate in #274; never infer live acceptance from CI.

## Findings by requirement

### 1. Server agent loop versus persistent computer — PARTIAL, preserve

- Implementation: `lib/agent/autonomous-runtime.ts` stores run/step state server-side; `app/api/cron/autonomous-runs/route.ts` resumes work. `lib/agent/secure-computer.ts` obtains an owner-named sandbox using `Sandbox.getOrCreate`; `lib/agent/secure-browser-bootstrap.ts` installs the browser runtime. `lib/agent/managed-browser.ts` separately owns cloud browser contexts and bounded sessions.
- Evidence: actual runtime fault fixture resumes a read after worker loss while preserving completed steps and idempotency key; actual managed-session fixture replaces an ended session using the same persisted context. Agent control does not live solely inside the sandbox.
- Gap/risk: a full VM destruction/rebuild with real authenticated profile and original objective has not been exercised here. Persisted identifiers alone do not prove every profile is reconstructible. P2 acceptance gap.
- Minimal next change/test: kill an isolated disposable sandbox between two read-only steps; reconstruct from server state, verify same owner/objective and provider page identity. No architecture replacement needed.

### 2. Durable execution, crashes, retries and unknown outcomes — CONFIRMED P1, patched

- Implementation: `lib/agent/autonomous-runtime.ts` provides persistent dependency steps, status claims, attempt counts, backoff, approval waits, completion and stale recovery. `lib/agent/persistent-general-plan.ts` connects it to real lists/reminders/tasks and Same Brain. `lib/agent/stale-runs.ts` also closes old runs.
- Before-patch evidence: actual exported runtime repeated a synthetic mutation after timeout (two effects); mutation verification failure remained retryable; crashed mutations requeued; terminal unknown runs still started queued steps; crash recovery ignored max attempts. Five RED cases are retained in the audit history.
- Fix: mutation exceptions, stale claims and unverified completion become failed steps carrying `outcome_state:unknown` / `reconciliation_required:true`, reconciled to terminal run `outcome_unknown`. Existing step schema does not permit unknown, so no schema change is necessary. Reads retain bounded retries and completed checkpoints. Terminal unknown runs cannot dispatch tools. Completion/failure/approval-wait writes are fenced by attempt number.
- Regression: `scripts/verify-always-on-faults.mts`: timeout-after-effect, missing read-back, mutation crash, read recovery, duplicate waves, terminal unknown, crash attempt exhaustion, late-worker overwrite prevention.
- Residual P1/P2: provider-specific reconciliation is still required; a stable local key is not downstream exactly-once. No automatic resolution of unknown is introduced. Lane selection does not itself provide a distributed resource lock for multiple queued helpers. Approval release and replanning need separate exact-binding review before expanding generic runtime capabilities.

### 3. Unified owner-bound task state across channels — PARTIAL

- Implementation: `lib/agent/actor.ts`, `lib/agent/thread-context.ts`, `lib/agent/typed-object-context.ts`, `lib/agent/persistent-general-plan.ts`; `app/api/dashboard/chat/route.ts` and `app/api/webhooks/whatsapp/route.ts` share owner/conversation/run stores. Typed selections have a 30-minute freshness limit.
- Evidence: new actual-runtime fixture continues a WhatsApp-sourced checkpoint with a web actor of the same owner; foreign owner run lookup and approval release fail. Existing `scripts/verify-cross-surface-continuity.mts` checks wiring, primarily by source assertions.
- Gap/risk: synthetic owner continuity is not a signed-in phone-to-dashboard end-to-end pass; surface routing and identity linking still need real acceptance. P1 acceptance dependency, not a reproduced leak.
- Minimal next change/test: one harmless read-only objective initiated on WhatsApp, continued on dashboard with the same run/object ID, then back; verify a second account sees neither object nor state. Retain canonical owner IDs.

### 4. One SendToUser policy/delivery gateway — MISSING UNIFICATION; confirmed P1 replay patched

- Implementation: `lib/services/notification-delivery.ts`, `lib/services/reminder-delivery.ts`, `lib/services/delivery-callback.ts`, `lib/services/delivery-state.ts` and delivery migrations provide durable claims, receipts, dedupe and unknown states. But `lib/agent/run-notify.ts`, `lib/agent/approved-browser-worker.ts` and `lib/agent/autonomy-pulse.ts` also call `sendWhatsApp` directly.
- Evidence: run-notify released its claim after every exception and allowed stale takeover. Synthetic provider timeout after effect could therefore resend. Patched notifier retains ambiguous send intents indefinitely pending reconciliation; only definite provider rejection releases them. Existing/new notification fixtures cover concurrent claim, definite rejection, timeout, legacy stale claim and owner binding.
- Gap/risk: no single authoritative policy/quiet-mode/receipt gateway for all user-visible sends. Notifier `sent` means transport returned, not delivered. Ambiguous notices can remain undelivered under this conservative patch. P1 architectural gap.
- Minimal next change/test: adapt existing delivery ledger into the shared gateway, then migrate one producer at a time. Persist provider IDs/chunks, apply owner quiet policy before begin, reconcile signed receipts, distinguish suppressed/deferred/accepted/delivered/unknown. Test quiet→wake, callback races, partial chunks and crash after acceptance. Do not create a parallel notification stack.

### 5. Main agent/helpers, isolated context, budgets, cancellation — PARTIAL

- Implementation: `lib/agent/specialist-registry.ts` describes routing/memory/surfaces; `lib/agent/autonomous-runtime.ts` has lanes/dependencies/maxParallel; `lib/agent/persistent-general-plan.ts` builds bounded tool work; `lib/agent/run-cancel.ts` cancels persisted work.
- Evidence: actual runtime duplicate-wave and late-worker tests; existing `scripts/verify-run-cancel.mts`, `scripts/verify-persistent-general-plan.mts`. A specialist registry is not evidence of independent durable helper agents.
- Gap/risk: generic step handlers are not a complete durable parent/child workflow protocol with separate context, aggregate token/tool budgets, cancellation propagation and restartable child lineage. Same-lane queued steps can be returned together by readyAutonomousSteps; browser locking must remain the actual resource boundary. P1/P2 capability gap.
- Minimal next change/test: add child IDs/parent IDs and bounded result references to existing run metadata, propagate cancellation and budgets, verify crash/restart of one synthetic helper while its sibling completes. Keep consequential authority in deterministic adapters.

### 6. Vault/memory hierarchy, compaction, provenance, staleness — PARTIAL

- Implementation: `lib/vault/credential-store.ts`, `lib/vault/session-store.ts`, `lib/security/vault-crypto.ts`; `lib/agent/context-brain.ts` compiles typed/source-referenced context; `lib/agent/conversation-summary.ts` retains 20 verbatim turns and folds older turns; `lib/agent/specialist-registry.ts` lists memory classes. `lib/bot/memory-redaction.ts` filters secrets.
- Evidence: source inspection confirms owner predicates, encrypted credential fields, dated context and sourceRefs. Existing `scripts/verify-planning-memory-authority.mts`, `scripts/verify-chat-summary.mts`, `scripts/verify-recall-evidence-budget.mts`, `scripts/verify-r4-memory-oct20.mts` cover authority/budgets. Summary is labelled data and recent records outrank it.
- Gap/risk: running prose summary has a time cursor rather than per-claim source/expiry. Repeated summarization can lose provenance or retain stale relative plans; compaction quality under many cycles is unmeasured. Vault secrets must stay separate from semantic memory. P1/P2 reliability gap; no new leakage demonstrated.
- Minimal next change/test: retain bounded source-message IDs and absolute dates for actionable summary claims; discard expired temporary facts before prompt rendering; repeat compaction over a synthetic 1,000-turn sequence with corrections, deletions, secrets and stale trips. Compare factual recall and authority, not summary word similarity.

### 7. Browser sleep/wake, persistence, concurrency, Take Control — PARTIAL, substantial foundation

- Implementation: `lib/agent/managed-browser.ts`, `lib/agent/browser-owner-lock.ts`, `lib/agent/browser-handoff.ts`, `lib/agent/browser-session-sweeper.ts`, `lib/agent/secure-computer.ts`, `lib/agent/browser-command.ts`. Flock and transfer reservations protect human takeover; persisted owner/site contexts outlive bounded sessions; orphan sweep skips referenced handoffs.
- Evidence: actual managed-provider fixture loses connectivity, refuses replacement while unknown, then restores the saved context after confirmed end. Existing `scripts/verify-managed-browser.mts`, `scripts/verify-vault-handoff-resume.mts`, `scripts/verify-browserbase-session-release.mts` exercise adapters. Some background-resume tests are source-only.
- Gap/risk: live sleep/wake/login/Take Control resume under worker death remains unverified. A missing remote session record is not automatically permission to create another active browser. Human transfer reservations may fail closed and require cleanup. P1 acceptance gap.
- Minimal next change/test: controlled context-preserving session expiry; concurrent human and automated ownership attempts; rebuild sandbox while task paused, then same-run resume after owner action. Never make OTP/CAPTCHA automatic.

### 8. Security, approvals, credentials, injection, verification — PARTIAL, preserve boundaries

- Implementation: `lib/agent/policy.ts`, `lib/agent/trust.ts`, `lib/agent/approval-binding.ts`, `lib/agent/approval-fingerprint.ts`, `lib/agent/approval-ttl.ts`, `lib/agent/execution-evidence.ts`, `lib/agent/gmail-verification.ts`, Vault stores and browser network/auth gates.
- Evidence: actual interrupted approval test makes no tool call, and an approved row owned by someone else cannot release it. Existing exact-binding, trust-class, human-auth and provider-readback fixtures cover typed boundaries. Inspected generic runtime approval release checks owner/status, while exact-action enforcement depends on concrete adapters.
- Gap/risk: do not treat `requiresApproval` metadata or a model's `verified:true` as self-enforcing authorization/evidence. Audit every newly exposed handler's exact binding and TTL; no claim of universal command auto-review or penetration-test completeness. P1 before expanding executor authority.
- Minimal next change/test: forged external-web instructions, expired/changed payload approval, cross-owner Vault reference, provider acceptance without readback, wrong provider object ID. Keep credentials outside model context. No production credentials used in tests.

### 9. Objective→decision→tool→approval→verified-outcome traces — PARTIAL

- Implementation: `agent_runs`, `agent_steps`, `agent_activity`; `lib/agent/decision-evidence.ts`, `lib/agent/decision-learning.ts`, `lib/agent/execution-evidence.ts`, `lib/agent/model-usage.ts`. Same Brain sample threshold stays 20 and guardrails stay intact.
- Evidence: inspected run/step activity includes step IDs, attempts and approval IDs; new uncertainty activity explicitly reports reconciliation required. Provider evidence contract requires exact source/object/provider refs.
- Gap/risk: best-effort activity writes can fail without blocking execution; direct sends and specialist model calls are not all linked to one complete trace. Absence of an event is not proof an action did not happen. P1/P2 operations gap.
- Minimal next change/test: carry run/step/decision/attempt/approval IDs through adapters and delivery records; mark trace coverage unknown if writes fail; inject activity-storage failure and reconstruct effect status from durable intent/receipt records.

### 10. Latency, cache, model usage and cost per completed task — PARTIAL, no measured production percentiles

- Implementation: `lib/agent/model-usage.ts` records general-plan SDK usage/latency and calculates means; `lib/metering/core.ts`, `lib/metering/record.ts`, `lib/metering/fetch-meter.ts` attribute vendor usage by owner; `lib/services/cost-guard.ts` and `lib/agent/watch-cost-policy.ts` bound selected work.
- Evidence: summarizeTaskMeasurements explicitly states specialist calls are not covered. Cached usage currently makes planner price unknown rather than recording cache counters. MeterContext carries owner/surface but no run ID. The separate metering rate card estimates unknown rates as zero, which must not be shown as verified free usage.
- Gap/risk: p50/p95, cache read/write counts, full per-task cost and coverage denominator are not available from this audit. No invented latency or 1/10-cost claim. P2 measurement gap.
- Minimal next change/test: extend existing meter context with run/step IDs and explicit cache tokens/rate versions, retain unknown prices as unknown, aggregate completed-task p50/p95 including/excluding approval wait and failed-attempt costs. Synthetic known distributions and missing-rate/partial-coverage tests, then read-only production aggregate verification.

## Fault-injection coverage and limitations

`verify-always-on-faults.mts` executes actual exports with inert stores/transports: worker mutation crash; read worker recovery/checkpoint; actual lost managed session; duplicate scheduler waves; provider timeout after synthetic effect; interrupted approval and cross-owner refusal; cross-channel owner-bound continuation; terminal unknown; exhausted crash budget; late worker fencing. Notification fixture additionally simulates timeout after accepted effect and preexisting stale send intent. Browser session fixture proves adapter state behavior, not authenticated site success. Cross-channel fixture proves shared runtime ownership, not phone delivery.

## Priorities and verification

P1 patched: uncertain mutation replay, terminal unknown dispatch, crash retry exhaustion, uncertain notification replay. No confirmed P0 exploit established in this scoped audit. Next coordinated P1 work: migrate outcome notices through existing delivery/policy gateway and provider reconciliation; prove exact executor approval coverage; complete live T1/T10/T11 acceptance. P2: helper lineage/budgets, provenance-preserving compaction, complete tracing and honest cache/task-cost metrics.

Verification results are recorded in the PR and issue #274 after the exact-head checks finish. Earlier runner/bootstrap failures are not passes: tsx 4.21 loader export interop failed; corrected runner uses installed tsx 4.23.15 loader because CLI IPC is restricted here. First build lacked fixture Supabase values; first full-suite retry lacked fixture OpenAI key. Corrected checks use CI placeholder credentials only. No production secrets are loaded.
