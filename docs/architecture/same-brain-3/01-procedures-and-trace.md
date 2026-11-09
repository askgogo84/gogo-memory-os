# Same Brain 3.0 — Phases 3 and 4 (procedures, decision trace)

Status: implemented behind flags, nothing enabled in production. Companion to `00-current-state.md`.

## Phase 3: procedural graph engine (`lib/procedures/`)

| File | Role |
| --- | --- |
| `schema.ts` | Node/edge types; `validateProcedure` — one START, COMPLETE and FAIL present, every node reachable and able to terminate, READ/EXECUTE/VERIFY carry a capability, every EXECUTE is followed by a VERIFY, every path to a consequential EXECUTE passes an APPROVAL (dominance check), cycles only on edges with `loop.maxIterations`. |
| `engine.ts` | Pure interpreter: `createRun`, `advance(run, event)`, `evaluateCondition`, `executeGuard`, `approvalFingerprint`. No I/O. |
| `templates.ts` | `travel.day`, `email.follow_up`, `meetings.prepare` (consumer), `enterprise.cancellation_incident` (enterprise, read-only remediation: creates a task, no merchant call). CONDITION predicates live here in code. |
| `registry.ts` | Versioned registry; registration throws on validation issues or a CONDITION without a predicate. Flag `GOGO_PROCEDURES=1` or `GOGO_PROCEDURES_OWNERS=<ids>` (off). |
| `compile.ts` | Durable adapter: a procedure becomes an `AutonomousPlan` for the existing runtime (`createAutonomousRun`). No second orchestrator. |

Mapping onto the existing runtime: READ / PARALLEL_READ / REASON / DECIDE / CONDITION / WAIT_EVENT / ESCALATE → one `agent_steps` row each (`procedure.<type>`), with the node's retry budget as `maxAttempts`; APPROVAL + EXECUTE + VERIFY fold into one mutation step with `requiresApproval`, `approvalAction` and `verificationRequired`, `maxAttempts: 1` — which is already how the runtime binds an approval to a step, refuses completion without evidence and never retries a mutation (`retryable && !meta.mutation`). COMPLETE/FAIL are the run's own terminal statuses; `outcome_unknown` is the runtime's existing state for a write the engine marks uncertain.

Invariants the tests pin (`scripts/verify-procedures-nov9.mts`, 6 groups):

- The model fills only the keys a REASON/DECIDE node declares in `produces`; a branch label or "approved: true" in its output is dropped. CONDITION branches come from the predicate table.
- `executeGuard` refuses: no approval, pending/rejected/expired approval, approval past `expiresAt`, fingerprint from another procedure/version, and any EXECUTE whose outcome is unknown (`outcome_unknown_never_replay`).
- `approval_created` with a different `actionType` or fingerprint than the node's → run fails closed. `approval_decided` with a tampered fingerprint → fails closed.
- VERIFY passes only when `hasExecutionEvidence` accepts the evidence for the EXECUTE's object (source, kind, objectRef, providerRef). A returned id or null evidence is a retry, then `unverified` → ESCALATE. Merchant evidence must still be provider read-back with matching objectRef.
- Only READ / PARALLEL_READ / VERIFY retry; `retryDelayMinutes` follows the node's backoff.
- Stale events for another node are ignored; wrong WAIT_EVENT names are ignored.

## Phase 4: decision trace (`lib/agent/decision-trace.ts`)

Additive. Rows go to `agent_activity` with `event_type = 'decision_trace'` and `metadata_json.schema = 'same-brain-v3'`: `decision_id`, `procedure_id/version/run_id`, `context_pack_ref`, `objective_kind`, `evidence_class` (weakest decisive step: verified | reported | inferred), `outcome`, per-step classes. `learningSignalFrom(trace)` is the only bridge to the v2 learner: verified completion → `verified_success` (caller must still pass provider evidence to `recordDecisionLearning`, which re-checks it); reported/inferred completion → `success` (unverified; `rankEvidence` does not count it toward calibrated confidence); escalated → `unknown`; waiting → nothing.

Untouched and pinned by `scripts/verify-decision-trace-nov9.mts`: `schema:'same-brain-v2'`, `MIN_CALIBRATION_SAMPLES = 20`, `p.confidence<0.82`, `SAFE_LEARNED_HANDLERS`, `actionRequiresApproval` block, `canLearningOverrideSafety(){return false}`, and `decisionHints` filtering to v2 rows (so v3 trace rows cannot feed routing).

## Phase 1 wiring added in this PR

`syncSemanticForEnabledOwners()` runs at the end of `/api/cron/agent-learning` only when `GOGO_SEMANTIC=1` or `GOGO_SEMANTIC_OWNERS` is set; failures are logged, never fail the pass. The migration `20261109160000_semantic_graph.sql` is still prepared, not run.

## Live path (PR after #1391)

- `lib/procedures/runtime.ts`: step handlers `procedure.read|parallel_read|reason|decide|condition|wait_event|escalate|execute|verify` drive the interpreter over the existing runtime's steps; interpreter state lives in `agent_runs.metadata_json.procedure.state` with a sequence fence. `startProcedureRun`, `resumeProcedureRun` (called by `/api/cron/autonomous-runs` for runs with `plan_kind = procedure-plan-v1`).
- Approval: the EXECUTE step stages the `agent_approvals` row itself, bound with `buildApprovalBinding(autonomousStepApprovalInput(...))` (policy `runtime-step-v1`, 30 min TTL in `execution_payload.expires_at`), returns `waiting_approval`; it performs the write only when the runtime re-dispatches with `approvalGrantedId` equal to that approval and `executeGuard` agrees.
- `lib/procedures/io.ts`: production reads for `meetings.prepare` (calendar via `executeReadOnlyCalendarStep`, guests' mail via `searchWorkspaceEmailsByQuery`, notes via `guestNotes`, open loops), `travel.day` (saved leg from `life_events`, live status via `lookupLiveFlight`, landing poll), `enterprise.cancellation_incident` (internal `merchant_orders` only; task record in `todos`). **No write is wired yet**: `execute` throws `execute_not_wired` with `outcomeKnown = true`, so a run with an EXECUTE ends `failed`, never claims success. Each write (cab booking, email send) gets wired to its existing verified executor in its own PR.
- Chat entry: `tryMeetingPrep` runs `meetings.prepare` as a procedure for owners in `GOGO_PROCEDURES_OWNERS`, falling back to the direct path on any failure. Log line `MEETING_PREP_PROCEDURE`.
- Phase 4 join: with `GOGO_CONTEXT_GRAPH=on`, `loadBrainContext` writes a `decision_trace` row (`status: waiting`, teaches nothing) carrying the pack id, so a turn's decision can be joined to the context it was made from.

Tests: `verify-procedures-runtime-nov9.mts` (3 groups: approval staged → released → unwired write fails closed; uncertain write escalates and is never replayed; rejected approval skips, read-only prep completes with missing disclosed).

## Email follow-up, end to end (PR after #1393)

- Chat: "follow up with Nithin on the Harbor deck" → `email.follow_up` (dashboard chat, `GOGO_PROCEDURES_OWNERS` only).
- `read_thread`: `resolveThread` from the chat reply path (Gmail consent + access checks unchanged); ambiguous or
  missing threads fail the read rather than guess.
- `replied`: if you wrote last, the run completes with nothing sent.
- `draft`: a short, deterministic follow-up ("Just following up on …") — no model-written claims in your name.
- `approve`: card shows To, Subject, the full message and "one reply in this thread, nothing else". The approval binds
  `thread` + `draft` (`approval.bind`); a changed draft or recipient after the yes is refused (`approval_binding_mismatch`).
  Consequential procedures without `bind` no longer validate.
- A yes on the dashboard releases that approval onto its step (`releaseApprovedAutonomousStep`, which re-checks the
  binding — this release was not called anywhere before) and resumes the run.
- `send`: `gmailAccess(requireSend)` + `sendGmailReply`. A 400/401/403/404/422 or missing scope is "not sent"; any other
  failure is outcome-unknown → escalate, never retried.
- `verify`: `verifyGmailSentMessage` (SENT label + same thread) → `provider_readback` evidence; otherwise retry, then
  escalate. Only then does the run complete.

## Still not done

- `travel.day` cab booking: no verified booking executor with provider read-back exists, so the EXECUTE fails closed
  (`execute_not_wired`, outcome known, nothing attempted). Wiring it needs a real provider integration first.
- WhatsApp entry for procedures (dashboard only for now).

## Enable order (owner)

1. Supabase SQL editor (project qenhjcooyecmatwducpu): run `supabase/migrations/20261109160000_semantic_graph.sql`. Expected: three tables, RLS enabled, no rows.
2. Vercel → `GOGO_SEMANTIC_OWNERS=-884501501`, redeploy. Next agent-learning cron logs `SEMANTIC_SYNC` and the tables fill for that owner only.
3. Vercel → `GOGO_CONTEXT_GRAPH=shadow`, `GOGO_CONTEXT_GRAPH_OWNERS=-884501501`. Logs show `CONTEXT_GRAPH_SHADOW` per turn; replies unchanged.
4. Only after reviewing shadow packs: `GOGO_CONTEXT_GRAPH=on`.
5. `GOGO_PROCEDURES_OWNERS=-884501501` → "prepare for my next meeting" runs as a traced procedure (read-only). Expected log `MEETING_PREP_PROCEDURE` and a `decision_trace` activity row.
