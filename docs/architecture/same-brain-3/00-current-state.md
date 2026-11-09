# Same Brain 3.0 — Phase 0: current state and integration blueprint

Inspected 9 Nov 2026, `main` @ `2bd909a4` (production dpl for #1390 READY). Owner directive: "Same Brain 3.0 —
Semantic Intelligence, Context Graphs, Procedural Execution and Continuous Learning" (14:52 IST). Lease posted in
#274 (comment 6736583570). Every claim below cites a file; "missing" means no implementation was found by reading
the source, not that it is impossible.

## 1. What already works (reuse, do not rebuild)

| Capability | Where | Notes |
|---|---|---|
| Context-first brain | `lib/agent/brain.ts` `runBrain → loadBrainContext → decide` | One model call over the last 20 turns + context sections; `BrainDecision` = reply / ask / handle / flight / later / skip. Canary by phone (`brainEnabledFor`), fast Haiku pass (`GOGO_BRAIN_FAST`), shadow models (`shadowModels`, `recordShadow`). |
| Ranked context pack | `lib/agent/context-brain.ts` `buildContextPack` | `ContextFact{source,score,confidence,startAt,endAt,inferred,sourceRefs}` from life_events, travel tickets, open loops, goals, watchers, typed context, inbox attention, semantic memories (pgvector), insights, profile; `renderContextBlock` bounded to 3,200 chars; `prioritizeRecallEvidence`; `dropYearShiftedDuplicates`. This is most of Phase 2's retrieval already. |
| Understanding context | `lib/agent/understanding-context.ts` | Per-source loaders with timeouts (`SOURCE_TIMEOUT_MS`), `CONTEXT_PACK_OPTIONS = {includeSemantic, maxFacts:16}`. |
| Connected memory (trips) | `lib/memory/life-graph.ts` | `linkTrips` groups flights/trains/stays/cabs by city + dates; `tripContextLines` feed the brain. A relationship graph for one domain. |
| Typed object context | `lib/agent/typed-object-context.ts` + `typed_object_context` table | Last list shown per domain; ordinal resolution; mutation owner. |
| Identity | `lib/agent/actor.ts` `resolveAgentActor` | Exact BIGINT round-trip, session owner must equal stored owner, no caller-supplied owner. |
| Authorization outside the model | `lib/agent/policy.ts`, `agent_permissions` (`auto/ask/draft/read/off`), `lib/agent/approval-binding.ts`, `approval-guard.ts`, `approval-ttl.ts` | Approvals bound to action fingerprints; TTL 24 h; kill switch per capability. |
| Durable runs | `lib/agent/autonomous-runtime.ts` (`gogo-autonomous-v1`) + `agent_runs`, `agent_run_steps`, `agent_activity` | Statuses `queued/running/watching/waiting_approval/completed/failed/paused/outcome_unknown` (migration 20260921051000); leases (10 min), retries [2,10,30,120] min, `waiting_user` state (#1369). |
| Execution evidence | `lib/agent/execution-evidence.ts` | `ExecutionEvidence{source,kind:'provider_readback'|'provider_receipt',objectRef,providerRef,verified}`; `hasExecutionEvidence` refuses HTTP-200/model prose. |
| Same Brain v2 learning | `lib/agent/decision-learning.ts`, `decision-evidence.ts`, `delivery-learning.ts` | `recordDecisionLearning` → `agent_activity.event_type='decision_learning'` (schema `same-brain-v2`); `verified_success` only with evidence; `calibrateGuardedRouting`: `MIN_CALIBRATION_SAMPLES=20`, live threshold `0.82`, `SAFE_LEARNED_HANDLERS` allow-list, consequential handlers never learned; `canLearningOverrideSafety()=false`. |
| Completion-claim guard | `lib/bot/completion-claim-guard.ts` | Model claims of bookings/sends are checked against records (#1383 added ticket reminders). |
| Watchers / open loops / reminders | `lib/agent/watchers.ts`, `open-loops.ts`, `reminders` | Sources for ingestion; already owner-scoped by `telegram_id`. |
| Memory controls | `lib/bot/handlers/memory-control.ts` | `forget everything` deletes `memories`, soft-deletes insights, resets profile; export (#1374). |
| Enterprise | `lib/workspaces/*`, `lib/enterprise/tipplr/*`, Spaces team pages | Workspaces + roles (`view … rename/admin`), audit, Tipplr pilot adapter (seed tables, not live Tipplr API). |

## 2. What is missing (source-level)

| Directive component | Gap | Evidence |
|---|---|---|
| A. Semantic knowledge graph | No entity/assertion/source tables; facts live per-table (memories, life_events, user_insights). No supersession: a correction appends a duplicate or hard-deletes (`memory-control.ts`); GATES.md "G7 fact-correction provenance" is DEFERRED for exactly this. No `valid_from/valid_until` on general facts (life_events has start/end only). | `supabase/migrations/*` has no semantic tables; `grep supersed` → none outside Spaces versions. |
| B. Decision context pack | `ContextPack` has facts + provenance but no decision id, authorized scope, deadlines, conflicts, missing-information list, capability/approval boundaries, expiry, freshness or cost; no shadow comparison of packs. | `context-brain.ts:92-113`. |
| C. Procedural graph | No procedure definitions/versions/nodes; plans are per-handler code (`general-planner.ts`, `trip-plan.ts`) and `autonomous-runtime` steps are specialist routes, not a declared graph with preconditions, approval checkpoints and verification nodes. | `grep -rn "ProcedureDefinition\|procedure_runs"` → none. |
| D. Lifecycle mapping | Runs have 8 statuses; no explicit `context_built / planned / policy_checked / verifying` phases recorded per step; `outcome_unknown` exists. | migration 20260921051000. |
| E. Learning evidence classes | `verified` vs not; no `reported` vs `inferred` distinction, no procedure run id or context pack reference in the trace. | `decision-learning.ts` metadata. |

## 3. Integration blueprint (safest points)

1. **Semantic spine** (new `lib/semantic/`): tables `semantic_entities`, `semantic_sources`, `semantic_assertions`
   (migration prepared, owner runs). Repository functions take an `AgentActor` or a verified workspace id, never a raw
   owner string from a caller. Ingest adapters read existing tables only (memories, life_events, reminders, open loops,
   calendar reads) behind `GOGO_SEMANTIC`. Supersession closes G7.
2. **Decision context** (new `lib/agent/context-graph/`): `buildDecisionContext(actor, objective, taskState, policy)`
   wraps `buildContextPack` + semantic assertions + typed state into a `DecisionContextPack`; bounded by node/edge/read/
   token/time caps; emits conflicts and missing-info. Hook: one optional section in `loadBrainContext` behind
   `GOGO_CONTEXT_GRAPH=shadow|on`; shadow logs `CONTEXT_GRAPH_SHADOW` and changes nothing.
3. **Procedures** (new `lib/procedures/`): declarative versioned graphs validated at load; a durable adapter maps
   nodes onto `agent_runs`/`agent_run_steps` (no second orchestrator); APPROVAL nodes call the existing approval
   path; EXECUTE/VERIFY nodes require `ExecutionEvidence`. Templates: travel, email follow-up, meeting prep (consumer)
   and Tipplr/Flipkart cancellation incident (enterprise, read-only remediation = create a task).
4. **Trace** (additive in `decision-learning.ts`): `schema:'same-brain-v3'` fields `decision_id, procedure_run_id,
   context_pack_ref, evidence_class:'verified'|'reported'|'inferred'`; only `verified` strengthens success stats.

## 4. Files: reuse / extend / add

- Reuse unchanged: `actor.ts`, `policy.ts`, `approval-*.ts`, `execution-evidence.ts`, `context-brain.ts`,
  `understanding-context.ts`, `life-graph.ts`, `autonomous-runtime.ts`.
- Extend (additive, flag-gated): `brain.ts` (`loadBrainContext` one section), `decision-learning.ts` (trace fields),
  `memory-control.ts` (forget-everything also retires semantic rows), `package.json` test chain.
- Add: `lib/semantic/{types,repo,resolve,ingest,supersede}.ts`, `lib/agent/context-graph/{types,build,shadow}.ts`,
  `lib/procedures/{schema,registry,adapter,templates/*}.ts`, migrations `20261109*_semantic_graph.sql` (+rollback),
  `scripts/verify-semantic-*.mts`, `verify-context-graph-*.mts`, `verify-procedures-*.mts`.

## 5. Concurrency

Open drafts touching `lib/agent/brain.ts`: #1335 (answerFollowups, line ~479) and #1295 (TRACK_ASK regex, line ~139).
The Phase 2 hook edits `loadBrainContext` (~line 240) only; no overlap. #1359 (enterprise governance) adds
`lib/enterprise/governance/*`; not touched here. 50 other P1/P2 security drafts from 5–7 Nov touch dashboard/owner
precision; none touch the paths leased above.

## 6. Protected behaviour carried forward

Exact owner ids as strings; service-role reads always `.eq(scope)`; no learning of consequential handlers;
`MIN_CALIBRATION_SAMPLES=20` and `0.82` unchanged; an inference never becomes a verified fact; no migration run by
the agent; no live sends, payments, bookings or account mutations.
