# 06 — Understand-first: one reading of the whole message, shadow + safe live set

**Status:** step 2 of the understand-first plan, extended (founder, 19 Oct) with a live dispatcher for a
safe, read-only action set. Consequential actions are recorded in shadow only.

> "Why should it trigger with few words… it should understand the whole sentence and then decide what to
> do… we should always look for the context instead of just few words." — founder, 19 Oct, benchmarked on
> Instinct and Wajo.

## 1. What runs, and where

One choke point per surface, early, before any feature keyword matcher:

| Surface | Location | Runs after | Runs before |
|---|---|---|---|
| WhatsApp | `app/api/webhooks/whatsapp/route.ts` (directly after the pending-question registry) | secondary-auth codes, onboarding, admin, reminder **button payloads** (incl. title-only taps), media, content workflow, compound requests, typed time routing, open loops, task status, the Jev shadow brain, **APPROVE/REJECT**, the pending-question registry | unsupported-capability notice, account sites, reservation, the Jev clarification guard, provider commands, feature intents, process-message |
| Dashboard | `app/api/dashboard/chat/route.ts` (after run cancel) | session/auth, login code, the pending-question registry, the exact inbox-reply read, run cancel | gold watch, content workflow, compound requests, watches, planners, feature intents, the Jev shadow brain |

Never entered: `APPROVE`/`REJECT` replies (`approvalIntent`), friend-reminder flows, exact commands and bare
menu numbers (`isExactCommand`: "yes", "1", "my reminders"), or any turn when `TYPESAFE_API_KEY` is unset.

Modules:

- `lib/agent/understanding-context.ts` — the owner-bound context pack. Ten sources, each with its own timeout
  (400–900 ms), each optional: recent turns (last 8, both roles, `getConversationHistory` tie order),
  pending question (derived), open runs, pending approvals, saved documents (sensitive ones only as
  `masked <type>`), saved tickets (event/flight/train), upcoming reminders (next 10, in the user's timezone),
  `buildContextPack` from `context-brain.ts` (watches, travel legs, long-term memory: semantic + lexical, top
  few), today/tomorrow calendar titles when connected, standing preferences, profile basics.
- `lib/agent/understanding.ts` — `understandMessage()`: one TypeSafe (Jev) call with three closed-choice
  questions: `action` (closed enum mapped to existing handlers), `referent` (choices are only the ids in the
  pack), `missing_info`. Slots are extracted deterministically from the user's words. Secret-shaped text is
  withheld (`typesafe_sensitive_state_withheld`); digits ≥7 and emails are masked; state is capped at ~6k
  tokens (22k chars), trimming lowest-priority sources first.
- `lib/agent/understand-first.ts` — live policy (`decideLiveDispatch`), dispatcher, shadow recording.
- `lib/agent/understanding-report.ts` — read-only agreement report, served inside
  `GET /api/admin/shadow-brain` as `understandFirst`.

## 2. Live policy (safe set)

Dispatched live only when **all** hold:

1. `UNDERSTAND_FIRST_LIVE` is not `off` (default on; `off` = shadow only, read after the response, zero latency).
2. The reading arrived inside the hard budget: **2.5 s total** (context + model, model ≤ 1.5 s).
3. Action ∈ safe set: `answer_pending_question`, `retrieve_saved_document`, `task_status`, `memory_recall`,
   `web_answer`, `plan_with_clarification` (asks ONE question, executes nothing), `general_chat`.
4. Confidence ≥ **0.82** (same as guarded-live in `decision-learning.ts`; do not lower).
5. A required referent resolved to a record in this turn's owner-bound pack (saved doc/ticket, own run,
   own approval, own memory, or Gogo's latest unexpired question — TTL 30 min).
6. The message does not lead with an explicit mutation verb (`cancel`, `book`, `send`, `pay`, `remind`,
   `move`, …) — those always stay with their own handlers and approvals.
7. The handler returned a reply. A null or a throw falls through.

Anything else falls through to the existing routing **unchanged**. Bookings, sends, payments, calendar
writes, reminder/watch creation, reminder edits and cancellations are never dispatched by understand-first.

Handlers used live (all pre-existing, read-only or question-only):

| Action | Handler |
|---|---|
| answer_pending_question | **Single owner: the pending-question registry (PR #668, `lib/bot/pending-question-resolver.ts`) runs first, once per turn, in both routes.** If it answers ("Goverdhan" → the Toit name step), understand-first never runs. If it rewrites an offered-option pick ("24k" → `<previous request> — 24K gold`), understand-first reads only the completed request, with `registryChecked`, and `processIncomingMessage` gets `pendingQuestionChecked`. Only when the registry has nothing does understand-first act, and then only on answers to its own clarifying questions (→ conversation). A caller that did not run the registry gets it once inside understand-first instead. |
| retrieve_saved_document | `buildDocumentReplyById` (doc referent) or `buildAssetRetrievalReply` with the ticket's event name |
| task_status | `tryGetTaskStatus` (named / referent run) → `tryGetAutonomyStatus` |
| memory_recall, general_chat | `processIncomingMessage({ understoodIntent: 'general_chat' })` |
| web_answer | `processIncomingMessage({ understoodIntent: 'web_search' })` — weather/gold/sports specialists keep the turn when the keyword reading found them (provenance) |
| plan_with_clarification | the one clarifying question, saved to the conversation |

## 3. What is recorded

Every reading writes one `agent_activity` row, `event_type = 'understanding_shadow'`, after the response:

`event_id` (WhatsApp message SID / dashboard `shadowEventId`, the same id the router outcome uses),
`surface`, redacted `user_text`, `action`, `proposed_action` (pre-validation), `handler`,
`referent {id, kind}` (no titles), normalised `slots`, `clarifying_question`, `confidence`, `reasons`,
`error`, `model_latency_ms`, `total_ms`, `candidate_count`, `usage`, `context_sources` (per source:
included / empty / timeout / error / skipped), `pending_question`, and
`live {enabled, dispatched, reason, handled_by}`.

A live answer also writes `shadow_router_outcome` with `actual_handler = handledBy`, so every turn pairs by
`event_id` whichever path answered it.

## 4. How to read agreement

`GET /api/admin/shadow-brain?hours=168` → `understandFirst.comparison`:

- Pairs each `understanding_shadow` row with the turn's `shadow_router_outcome` by `event_id`.
- **Live-dispatched turns are excluded** (they would agree with themselves); `noAction` counts readings
  below 0.6 or with an unknown action.
- An action *agrees* when the actual handler is one of the action's mapped handlers
  (`UNDERSTANDING_ACTIONS[action].handlers`). Generic handlers (`process-message`,
  `legacy-feature-intent`) map to several actions, so agreement on those is weaker evidence; read the
  `disagreements` list for them.
- Disagreement is not automatically an understanding error: on the 19 Oct cases the *router* was wrong.
  Review the disagreement list by hand before drawing a conclusion.
- `latencyMs.p50/p90/p99` and `contextSourceFailures` show the cost and which sources time out.

## 5. Promotion criteria for step 4 (more actions live)

Reuses `SHADOW_BRAIN_PROMOTION_GATE.md` and `decision-evidence.ts` thresholds — **do not lower them**:

Per action, before it may join the live set:

- ≥ **20** paired turns at confidence ≥ 0.82 (`MIN_CALIBRATION_SAMPLES`), and ≥ 50 paired turns overall
  across the window (gate: "at least 50 paired production events").
- Agreement ≥ **90 %** on those confident turns after manual review of every disagreement (gate:
  capability agreement ≥ 90 %).
- Pairing rate ≥ 95 % for the surfaces involved.
- Zero observed case where the reading would broaden a consequential action or pick a referent the
  owner does not own.
- Hard safety gates unchanged: approval binding, Sentinel, human-auth, idempotency and per-user
  serialisation tests all green.
- Consequential actions (bookings, sends, payments, calendar writes, reminder/watch creation,
  cancellations) may only ever be promoted to *choose the existing handler first*; that handler's own
  approvals stay the executor's gate.

## 6. Cost and latency

- Model calls: exactly **one** understanding call per non-trivial turn (golden test asserts it), on top of
  the existing Jev shadow call. On WhatsApp the Jev call runs earlier in the route (before approvals), so
  every observed turn makes Jev + understanding. On the dashboard the choke point precedes the shadow
  brain, so a turn answered live makes only the understanding call.
- The `context_pack` source reuses `buildContextPack` with semantic memory on, which makes one embedding
  request (same as today's recall path); it is cut at 900 ms.
- Latency added to the reply path: context (parallel, ≤ 900 ms) + model (≤ 1.5 s), hard-capped at 2.5 s;
  typical cost is the TypeSafe round trip plus the slowest included source. `UNDERSTAND_FIRST_LIVE=off`
  removes it entirely (shadow only, after the response).

## 7. Golden replay

`scripts/verify-understanding-golden.mts` + `scripts/fixtures/understanding-golden.json` (registered in
`npm test`). Offline and deterministic: model outputs are stored in the TypeSafe response shape. Run with
`--record` and `TYPESAFE_API_KEY` to capture live outputs into `recordedLive` per case and print live vs
expected actions before step 4.
