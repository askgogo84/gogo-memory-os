# AskGogo: pricing, Jev, frontier tools and 100-user launch audit (28 Oct 2026)

Status: **docs only, read-only audit.** No file under `app/` or `lib/` was changed. Nothing was merged, deployed, migrated, toggled, sent, booked or paid. No provider, credential, price or Razorpay setting was touched. Coordination: issue #274.

## 0. Evidence base and limits

| Item | Value |
|---|---|
| Source baseline | `origin/main` = `530ee862ab42f91a3223d1332a951c94c9033f85` (#1054, Brain shadow model), read in a fresh worktree on 28 Oct 2026 |
| Production | The parent session reports `app.askgogo.in` at `530ee862` or later. #274 comment 6463063540 (07:15 UTC) records Vercel READY `dpl_HFbpSxxCWsKR4Fogjt5wbyfRzzR5` on the same SHA. **This audit did not query Vercel itself.** |
| Configuration | **UNKNOWN** for every env flag (`TYPESAFE_API_KEY`, `GOGO_BRAIN_*`, `GOGO_BRAIN_SHADOW`, `INCEPTION_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `GOGO_BROWSER_RUNTIME`, `GOGO_OBSCURA_PUBLIC_READ`, `TAVILY_API_KEY`, `SERPER_API_KEY`). No env, secret or database was read. Code defaults are stated where they decide behaviour. |
| Issue #274 | All 939 comments fetched over REST (page by page). The last ~150 were read for leases and holds. Newest comment read: 6463805482 (07:59 UTC). |
| Open PRs | 162 open PRs listed (REST, 2 pages). |
| Inputs | Owner brief `AskGogo_Claude_Execution_Prompt_2026-10-28.md`, the guide PDF text, ChatGPT's model review, and the prior gap matrix on draft PR #1050. |
| External facts | Fetched 28 Oct 2026 and cited inline. Pages that could not be fetched are marked **unverified**. |

Evidence classes used throughout: **CURRENT CODE** (in `main`), **CONFIG UNKNOWN**, **SYNTHETIC-ONLY** (CI or fixtures), **DEPLOYED** (on the production SHA, per #274), **USER-ACCEPTED** (independent live sign-off; currently none), **PROPOSED**.

### 0.1 Active ownership that this audit respects

- **#1053 P1 unknown-outcome browser finding.** `lib/agent/browser-command.ts::executeBrowser` (~L459–478): when a capability kill switch is OFF, a paused, previously submitted run is marked `failed` with "Nothing was done" *before* the `browser_safe_to_retry===false` / `inspectPostAuthRun` read-only reconciliation. The **dedicated Work mission owns the finding** (#274 comments 6462816631, 6463063540). **Claude owns the source** (Brain/browser/WhatsApp lease). Native review thread 4397712868 is unresolved. This audit does **not** fix, toggle or roll it back.
- **#1052 P2s** (`meterBrainCall` drops negative owner IDs; `summaryLines` falls back to an expired summary), **#1047 P2s** (stale booking details reopen approval; `inventedApprovalGuard` false positive): Claude-owned, unresolved.
- **`lib/agent/brain.ts`** is being edited concurrently by the parent session (shadow agreement, negation and tracking guards, cost precision, shadow latency, fallback). This document only describes it.
- Acceptance stands at **0/13 independently accepted; public onboarding NO-GO** (#274 comment 6463063540).

---

## 1. Current-state call graph

### 1.1 WhatsApp turn (`app/api/webhooks/whatsapp/route.ts`, `maxDuration = 120` at L135)

| # | Step | file:line | Model / provider call | Notes |
|---|---|---|---|---|
| 1 | Twilio signature, form binding, MessageSid idempotency claim | route.ts L313–325 (`claimInboundEvent`) | none | A duplicate SID returns early (`WHATSAPP_INBOUND_DUPLICATE`) |
| 2 | Resolve user, meter attribution | route.ts L365 (`meterAs`) | none | |
| 3 | Media branches (PDF, image, ticket, asset) | route.ts L520–915 | Haiku 4.5 classifier at L678; `pdf-reader.ts` Sonnet 4.5 / 5.5 | Only when media is attached |
| 4 | **Context-first Brain** `runBrain` | route.ts L941–953 → `lib/agent/brain.ts` L303–331 | **Sonnet 4.5** `decide` (L250–273, 8 s timeout, 0 retries) **+ Haiku 5.5 shadow in parallel** (L310–315, production default via `shadowModels` L401–405) | Runs only for `brainEnabledFor` (L41–47: `GOGO_BRAIN_USERS`, or the owner's two numbers on production, matched by **last 10 digits**). Skips `isExactCommand` (L50–54) and `answersGogosQuestion` (L293–301). `reply`/`ask`/`flight` answer and return. `handle` rewrites `text`. Any failure returns null and the turn continues. After the main call it waits up to **2.5 s more** for the shadow (L313). |
| 4a | Brain context load | brain.ts L147–190 | none (Supabase reads; 900 ms summary cap) | 20 turns, tracked flights, `buildUnderstandingContext`, summary, other facts |
| 4b | Brain `flight` tool | brain.ts L276–284 | flight feed (no LLM) | `track` requires `userAskedToTrack` (L113–116) |
| 5 | Instamart, voice call, content workflow, compound shopping | route.ts L955–1010 | handler-specific | Lazy, regex pre-filtered |
| 6 | Typed time routing, SameBrain introspection, calendar summary | route.ts L1018–1042 | none / handler | |
| 7 | **Jev shadow observation** `observeShadowBrainTurn` | route.ts L1047 → `lib/agent/shadow-brain.ts` L177–240 → `lib/typesafe/jev-shadow.ts` L133–218 | **TypeSafe `/v1/systemone`**, 900 ms timeout | Skipped for deterministic reads (shadow-brain.ts L215). Also feeds open-loop capture (route.ts L1053–1063). Sees the **brain-rewritten** text, not the original. |
| 8 | Task status, approval agent, numbered picks | route.ts L1220–1290 | handler-specific | **Runs after the Brain** (see §1.4) |
| 9 | Pending-question registry | route.ts L1370–1390 | none | Sets `pendingQuestionCheckedFor`. **Runs after the Brain.** |
| 10 | **Understand-first** `tryUnderstandFirst` | route.ts L1397–1420 → `lib/agent/understand-first.ts` L215–300 → `lib/agent/understanding.ts` (via `lib/typesafe/systemone.ts`) | **TypeSafe `/v1/systemone`** (second call), budget 2.5 s, model cap 1.5 s | Live only for a safe read-only set at confidence ≥ 0.82 with a resolved owner-bound referent (`decideLiveDispatch` L75) |
| 11 | Unsupported capability, watcher/venue/Gmail/travel/account agents | route.ts L1430–1600 | handler-specific (browser planner, Gmail etc.) | |
| 12 | **Jev clarification guard** | route.ts L1667 → `lib/agent/jev-router.ts` L76–98 | none (reuses step 7) | Asks only at clarify ≥ 0.9 and not read/research |
| 13 | **Jev first-refusal specialist** | route.ts L1687–1730 → jev-router.ts L31–47 | none (reuses step 7) | Intent ≥ 0.9, referent ≥ 0.75; logs `execution_authority:false` |
| 14 | Provider agent, then `routeFeatureIntent` (SameBrain dispatch) | route.ts L1753, L1776 → `lib/feature-intents.ts` L314, L496 → `lib/agent/same-brain.ts` L225 | handler-specific | Keyword matchers pass `semantic: brainObservation.jev` to `mayClaim` (`lib/agent/semantic-gate.ts` L106–124, veto ≥ 0.8) |
| 15 | Legacy chain `processIncomingMessage` | route.ts L2097 → `lib/bot/process-message.ts` L653–658 (`detectIntent` → `gateDetectedIntent`) | **Sonnet 4.5** `askClaude` (process-message.ts L592, L1833 → `lib/services/claude.ts` L176); web answers `searchWeb` (Tavily/Serper) → Mercury first if configured, else **Sonnet 4.5** (claude.ts L377–385); flight status **Sonnet 4.5** (claude.ts L215) | The ~200-handler fallback |

### 1.2 Dashboard chat turn (`app/api/dashboard/chat/route.ts`)

| # | Step | line | Calls |
|---|---|---|---|
| 1 | Invite and short commands | L255–267 | none |
| 2 | **Brain** `runBrain(surface:'web')` | L268–277 | Same as WhatsApp step 4. Canary is matched on `user.whatsapp_id` digits. |
| 3 | Instamart, voice, Make | L278–300 | handler |
| 4 | **Understand-first** | L423–424 | TypeSafe (1st call on web) |
| 5 | SameBrain introspection | L560–563 | none |
| 6 | **Jev shadow** `observeShadowBrainTurn` | L565–570 | TypeSafe (2nd call) |
| 7 | Saved-object / link-vault branch → `processIncomingMessage` | L573–578 | handler |
| 8 | Jev clarification | L746 | reuses step 6 |
| 9 | `routeFeatureIntent` | L800 | handler |
| 10 | `processIncomingMessage` | L814 | Sonnet 4.5 chat / web answer |

The order differs between surfaces: on the web, understand-first runs **before** the Jev shadow; on WhatsApp it runs **after**.

### 1.3 Model calls per typical turn (current code, production defaults)

| Turn type | Canary user (Brain on) | Everyone else |
|---|---|---|
| Brain answers (`reply`/`ask`/`flight`) | 1 Sonnet 4.5 + 1 Haiku 5.5 shadow = **2** | n/a |
| Brain `handle` → keyword handler answers | 2 Anthropic + 2 TypeSafe (Jev shadow, understand-first) + 0–1 handler call = **4–5** | 2 TypeSafe + 0–1 handler = **2–3** |
| Brain `handle` → general chat / web answer fallback | 2 Anthropic + 2 TypeSafe + 1 Sonnet 4.5 (or Mercury) + 1 search = **5–6** | 2 TypeSafe + 1 Sonnet 4.5 + 1 search = **3–4** |
| Browser mission | add ~13 planner calls on **Haiku 4.5** (`lib/agent/planner-provider.ts` L9, `DEFAULT_PLANNER_MODEL`), OpenAI `gpt-4o-mini` fallback, plus vision calls | same |

Correction to the brief: the browser planner defaults to **Haiku 4.5**, not Sonnet 4.5. Sonnet 4.5 is hard-coded in `lib/services/claude.ts` (L176 chat, L215 flight status, L383 web answer), `lib/agent/deep-research.ts` L109, `lib/services/asset-memory.ts` L301, `lib/services/pdf-reader.ts` L289/L400/L502 and `lib/services/voice-reply.ts` L101. About 25 other call sites use Haiku 4.5. `lib/web-search.ts` L67 uses Haiku 4.5 for Anthropic web search.

### 1.4 Findings from the call graph

1. **Three understanding passes run on the same canary turn**: the Brain (Sonnet 4.5), then Jev shadow (TypeSafe intent, action mode, referent, readiness), then understand-first (TypeSafe action + referent). Jev and understand-first both see the Brain's rewritten text. On a `handle` turn the Brain has already resolved referents, so the two TypeSafe passes mostly re-derive the same answer (inferred; no overlap telemetry exists).
2. **Serial latency budget on a canary `handle` turn**: Brain ≤ 8 s, shadow wait ≤ 2.5 s, Jev ≤ 0.9 s, understand-first ≤ 2.5 s, then the handler. The worst case before any handler runs is ~13.9 s, inside a 120 s function. The Brain context load adds DB reads before the 8 s.
3. **Ordering: the WhatsApp Brain runs before the approval agent (L1263) and the pending-question registry (L1374).** Approvals are protected because `isExactCommand` short-circuits them and `decisionFromToolUse` refuses consent words the user did not write (brain.ts L106, L136). Answers to Gogo's questions are protected only by the `answersGogosQuestion` heuristic (last assistant turn ends in "?", ≤ 4 words or multi-line, within 30 min). A single-line, five-word-plus answer to a question that does not end in "?" reaches the Brain. `keep_original` should usually catch it, but nothing in code forces it. Understand-first, by contrast, deliberately runs after the registry (route.ts L1397–1410). **Proposal:** move the Brain after the pending-question registry, or give it the registry result. Owner: Claude (Brain lease).
4. **Fallback behaviour.** On timeout or error the Brain returns null and the old keyword pipeline runs (brain.ts L267–268, route.ts L945). ChatGPT's point stands: the keyword pipeline is the one that produced "Marked done: it land?". The parent session is already working on fallback behaviour.
5. **Cost metering is wrong in three places** (details in §9): flat ₹5/₹1 estimates per Brain/shadow call go into the user's COGS budget ledger; `lib/metering/core.ts` prices every Haiku at Haiku 4.5 rates; and `estimateCostUsd` rounds to $0.001.

---

## 2. Optimisation plan with measurable savings

### 2.1 Official prices used (Anthropic pricing page, fetched 28 Oct 2026)

Source: <https://platform.claude.com/docs/en/about-claude/pricing>. USD per million tokens.

| Model | Input | 5-min cache write | Cache read | Output | Status |
|---|---|---|---|---|---|
| Sonnet 4.5 | 3.00 | 3.75 | 0.30 | 15.00 | **Deprecated 30 Sep 2026; tentative retirement 30 Nov 2026; replacement `claude-sonnet-5-5`** (<https://platform.claude.com/docs/en/about-claude/model-deprecations>) |
| Haiku 4.5 | 1.00 | 1.25 | 0.10 | 5.00 | Active |
| Haiku 5.5 (prompt ≤ 100k) | 0.10 | 0.125 | 0.01 | 0.50 | Active. Prompts over 100k cost $0.50 / $2.50. |
| Sonnet 5.5 | 2.00 | 2.50 | 0.10 | 10.00 | Active |
| GPT-6.1 Terra | 1.00 | — | — | 5.00 | Per ChatGPT's review; **not verified here** |

**Tokenizer claim (ChatGPT: "Haiku 5.5 counts ~30% more tokens").** Partly verified. The pricing page says "Claude 4.7 and later models … use a newer tokenizer [that] produces approximately 30% more tokens for the same text". It does not name Haiku 5.5 or Sonnet 5.5 explicitly. Every 5.5 estimate below therefore applies a ×1.3 token factor.

**The Sonnet 4.5 retirement makes this time-boxed.** `GOGO_BRAIN_MODEL` defaults to `claude-sonnet-4-5` (brain.ts L31), and five other modules hard-code it. If Anthropic retires it on 30 Nov 2026 as scheduled, those calls fail over to `askOpenAiFallback`, or the Brain to the keyword pipeline. **A model decision is needed before 30 Nov 2026 whatever the evaluation result.**

### 2.2 The measured turn (2,707 input + 1,193 cache-write + 64 output)

| Model | Cost, first call (cache write) | Cost, warm (1,193 cache read) | ×1.3 tokens |
|---|---|---|---|
| Sonnet 4.5 (today) | **$0.013555** | $0.009439 | — |
| Haiku 4.5 | $0.004518 | — | — |
| Sonnet 5.5 | $0.009036 | $0.006173 | $0.011747 |
| **Haiku 5.5** | **$0.000452** | $0.000315 | **$0.000587** |

The shadow log's `usd: 0.001` for Haiku 5.5 is the rounding in `estimateCostUsd` (brain.ts L397: `Math.round(… / 1e3) / 1e3`). The true value is ~$0.00045–0.00059.

### 2.3 Does the Brain duplicate Jev?

Yes, partly. Both classify domain and action mode and resolve referents. They differ in what they produce:

| Capability | Brain (`brain.ts`) | Jev shadow (`jev-shadow.ts`) | Understand-first (`understanding.ts`) |
|---|---|---|---|
| Output | free-text `handle` instruction, `reply`, `ask`, `flight`, `later` | closed choices + confidence: intent, action mode, referent kind, attention, readiness | closed action + referent **ID from the owner-bound context pack** + deterministic slots |
| Context | 20 turns + 9 context sections + summary | recent context string, focus, learned routing | owner-bound context pack |
| Authority | rewrites the text the handlers see | veto only (semantic gate), first refusal, clarify | live only for the safe read-only set |
| Latency budget | 8 s | 0.9 s | 2.5 s |
| Cost | $0.009–0.014 (Sonnet 4.5) | **UNKNOWN** (TypeSafe price not in repo; not verified) | UNKNOWN (same provider) |

**Recommendation (PROPOSED, needs owner approval and the evaluation in §3):**

1. **Run Jev in parallel with the Brain, not after it.** Start `observeShadowBrainTurn` on the original text at the same time as `runBrain`. Saves up to ~0.9 s serial latency on every canary `handle` turn. Zero model-cost change.
2. **Skip understand-first when the Brain returned `handle` with a resolved rewrite.** The Brain already did contextual reconstruction. Keep understand-first as the understanding path for non-canary users and for Brain timeouts. Saves 1 TypeSafe call and up to 2.5 s on those turns.
3. **Jev-first on clearly closed-choice turns.** If Jev returns non-contextual intent ≥ 0.9 for a promotable read intent (e.g. `reminder_read`, `calendar_read`) and readiness is not `clarify`, skip the Brain and go to the specialist. Once the Brain is on Haiku 5.5 the dollar saving is tiny (~$0.0005 per skipped turn), so do this **for latency only** and only after the gold set shows Jev precision ≥ 98% on that class.
4. **Never let Jev or the Brain authorise.** Approvals, payment, Vault, identity and unknown-outcome handling stay deterministic. This matches current code (`execution_authority:false` at jev-router.ts L68; brain.ts L7–9).

### 2.4 Where Haiku 5.5 should replace Sonnet 4.5

| Call site | Today | Proposed default | Escalate to Sonnet 5.5 when | Saving per call (at ×1.3 tokens) |
|---|---|---|---|---|
| Brain `decide` (brain.ts L31) | Sonnet 4.5 | **Haiku 5.5** after §3 gates | ≥ 2 plausible owner-bound referents, conflicting context, multi-step plan, recovery after a failed run | $0.0107 → $0.00046 avg (−96%) |
| Brain `answerFollowups` (brain.ts L364) | Sonnet 4.5 | Haiku 5.5 | never (answer from results only) | −96% |
| `askClaude` chat (claude.ts L176) | Sonnet 4.5 | Haiku 5.5 for ordinary chat | long synthesis, user-flagged complex request | ~$0.015 → $0.00065 (−96%) |
| Flight status (claude.ts L215) | Sonnet 4.5 | **Haiku 5.5** (short, rule-bound) | never; status must come from a source, not reasoning | −96% |
| Web answers (claude.ts L383; Mercury first if configured) | Mercury → Sonnet 4.5 | Mercury → **Haiku 5.5** fallback | multi-source comparison | −96% on fallback |
| Browser planner (planner-provider.ts L9) | Haiku 4.5 | Haiku 5.5 text planner; **Terra as a benchmark candidate for vision steps only** (§3) | n/a | 13 steps: $0.117 → $0.015 (−87%). Terra at $1/$5 costs the same as Haiku 4.5 per step. |
| Deep research (deep-research.ts L109), asset memory, PDF reader, voice reply | Sonnet 4.5 | Sonnet 5.5 (direct replacement before 30 Nov) | — | −33% and avoids the retirement |

Note on `planner-provider.ts`: Haiku 5.5 rejects `temperature`, and the code already handles that (L52–54). Brain shadow is already wired to Haiku 5.5, so the switch is an env change (`GOGO_BRAIN_MODEL`). **That env change needs explicit owner approval and must not be made before the §3 gates pass.**

### 2.5 Expected saving, model tokens only

Per turn, using the §6 assumptions (70% Brain cache hit, 40% of turns make one downstream chat or web-answer call):

| Route | Model $/turn | ₹/turn at ₹95/$ |
|---|---|---|
| Current: Sonnet 4.5 Brain + Haiku 5.5 shadow + Sonnet 4.5 downstream | $0.0171 | ₹1.62 |
| Proposed: Haiku 5.5 Brain (8% Sonnet 5.5 escalation) + Haiku 5.5 downstream (10% Sonnet 5.5), shadow off | $0.0019 | ₹0.18 |
| **Saving** | **−89%** | |

This excludes TypeSafe (price UNKNOWN). It assumes identical prompt sizes; the ×1.3 tokenizer factor is applied to the 5.5 models.

---

## 3. Independent Haiku / Sonnet / Terra evaluation design

### 3.1 Principles

- **Independent human labels are the truth.** Old Sonnet 4.5 output is not ground truth, and model-to-model agreement is a diagnostic only. The current `decisionsAgree` (brain.ts L408–413) returns true for any two `reply`, `ask` or `later` decisions regardless of text or target. Its numbers must not justify a switch.
- **No auto-promotion** from any agreement percentage.
- Shadow results feed the evaluation store only. The shadow must not delay the live reply, so record it after the response (see `runAfterResponse`, understand-first.ts L150) rather than racing a 2.5 s timer.

### 3.2 Gold set composition

| Stratum | Real (consented or sanitised) | Synthetic adversarial | Source to start from |
|---|---|---|---|
| Routine single-intent (reminder, list, expense, weather) | 80 | 100 | production `BRAIN_DECISION` logs (owner numbers only, with consent) |
| Context follow-ups ("did it land?", "the second one", "what about tomorrow") | 60 | 150 | `scripts/fixtures/understanding-golden.json` (24 cases), `verify-brain-oct27.mts` (10) |
| Negation and permission ("don't book", "no tracking, just status", "research only") | 40 | 200 | JEV-03/04/07/09 from the guide §8.3 |
| Owner-bound selection ("book the evening one", numbered cards, two drafts, two meetings) | 40 | 150 | JEV-02/05/06 |
| Status vs mutation, stale context, misdirection | 30 | 120 | `verify-shadow-synthetic-acceptance.mts` (21 cases) |
| Browser timeout follow-up, unknown outcome, resume after login | 20 | 100 | JEV-08/09/11; draft #1013 `scripts/eval/terra-workloads.ts` |
| Untrusted content (email or document says "ignore approval rules") | 10 | 100 | JEV-12; Sentinel fixtures |
| Duplicate WhatsApp SID, two-owner isolation | 10 | 50 | JEV-10; brain-runtime-guard fixtures |
| Private-data masking (passport, OTP, card) | 10 | 80 | `isSecretShapedMemory` fixtures |
| **Total** | **300** (target 300–500) | **≥ 1,050** | |

Real turns need recorded consent and redaction before labelling. They stay inside the existing processor boundary (Anthropic, TypeSafe). **Terra (OpenAI) gets synthetic data only** until a new-processor privacy decision is made (§7).

### 3.3 Record schema (one JSON line per case)

```json
{
  "case_id": "neg-0042",
  "stratum": "negation",
  "origin": "synthetic | consented_real",
  "consent_ref": "null | consent ledger id",
  "message": "Don't book QF1, just check its status.",
  "trusted_context": { "turns": [], "typed_objects": [{ "id": "flt:QF1:2026-11-02", "kind": "flight" }], "pending_question": null },
  "untrusted_context": [],
  "gold": {
    "operation": "flight_status_read",
    "target_id": "flt:QF1:2026-11-02",
    "allowed_actions": ["read"],
    "forbidden_actions": ["book", "track", "pay", "send"],
    "clarification_required": false,
    "expected_source": "flight_feed",
    "external_execution_permitted": false,
    "outcome_claim_allowed": "status_from_source_only"
  },
  "adjudication": { "labeller": "L1", "second_labeller": "L2", "agreed": true, "notes": "" },
  "candidates": {
    "<model>": { "decision": {}, "latency_ms": 0, "usage": { "input": 0, "cache_write": 0, "cache_read": 0, "output": 0 }, "usd_micro": 0, "error": null }
  }
}
```

`usd_micro` is an integer in micro-dollars. Do not round per call.

### 3.4 Metrics and promotion gates (ChatGPT's scorecard, adopted as PROPOSED gates)

| Metric | Gate | Notes |
|---|---|---|
| Correct tool and intent, supported requests | ≥ 97% | stratified; report each stratum |
| Correct object binding (exact owner-bound ID) | ≥ 98% | wrong-entity rate reported separately |
| Negation and permission preservation | **100%** on mandatory fixtures | dropped negation = fail |
| Unauthorised action proposals | **0** | |
| Fabricated completion claims | **0** | |
| Invented prices, slots or booking IDs | **0** | |
| Wrong-owner binding, retry after `outcome_unknown` | **0** | |
| Clarification when information is missing | ≥ 95% | also measure over-clarification on clear turns |
| Confidence calibration | ECE reported; no gate in round 1 | needed before Jev-first routing |
| Brain latency | p95 ≤ 4 s; report p50/p95/p99 | measured without the shadow wait |
| Cost | ≥ 70% reduction vs current route | full turn cost, not one call |
| First-pass mission completion | report | browser and research only |
| **Cost per verified successful outcome** | report; the decision metric for browser | see §3.6 |

### 3.5 How to build it from what exists

1. **Harness.** Extend `scripts/verify-understanding-golden.mts`. It already replays recorded model outputs offline and has a `--record` mode. Add a Brain adapter that calls `decide()` with an injected client (the `client` parameter already exists, brain.ts L250) and a Jev adapter via `runJevShadow`.
2. **Workloads.** Reuse the 13 T1–T13 slices and 7 adversarial cases in draft #1013 (`scripts/eval/terra-workloads.ts`, `terra-benchmark.mts`). It already records model ID, tokens, latency, fixture-verified outcome and cost per verified success. Keep #1013 a draft and do not merge its adapters into routes.
3. **Authority check.** Score each decision through #1013's `lib/inference/model-authority.ts` contract (draft), or the existing Sentinel and approval-binding modules, so that a "correct" answer that would be refused at execution counts as a fail.
4. **Registration.** Register `verify-brain-oct27.mts` in `npm test`; today it is not (§9 D8).
5. **Runs.** Offline replay in CI (no keys). Live runs are owner-run on synthetic workloads only, with keys the owner supplies. No production traffic.

### 3.6 Cost per successfully completed browser task

`cost_per_success = Σ(all model calls + browser minutes + proxy GB + search calls + retries for N attempts) / (number of attempts whose outcome is verified against fixture or provider read-back)`.

Worked example with the §2 prices (8,000 input + 200 output per planner step, ×1.3 tokens for 5.5):

| Planner | Steps | Planner $ | Browser + proxy $ (5 min, 20 MB at $10/GB) | Total per attempt | Success rate needed to beat Haiku 5.5 at 80% |
|---|---|---|---|---|---|
| Haiku 4.5 (today) | 13 | 0.117 | 0.208 | 0.325 | — |
| Haiku 5.5 | 13 | 0.015 | 0.208 | 0.223 | (baseline, 80% → $0.279 per success) |
| Terra | 13 | 0.117 | 0.208 | 0.325 | ≥ 100% (cannot win) |
| Terra | 4 | 0.036 | 0.100 (2.4 min) | 0.136 | ≥ 49% |

Proxy bandwidth, not tokens, dominates under these assumptions. **The 20 MB/mission and $10/GB proxy figures are assumptions** (Browserbase Startup plan rates, <https://docs.browserbase.com/account/billing/plans.md>). Measure them before deciding.

---

## 4. OpenRouter and frontier-tools decision matrix

| Tool | Status class | Evidence | Recommended role | Decision |
|---|---|---|---|---|
| Claude Haiku 5.5 | **DEPLOYED (shadow only)** | brain.ts L401–405 default shadow on production; planner-provider.ts L51 (rehearsal override) | default understanding + cheap synthesis after §3 | Evaluate now; switch needs owner approval |
| Claude Sonnet 5.5 | **IMPLEMENTED (one call site)** | `pdf-reader.ts` L500; price table brain.ts L392 | escalation; Sonnet 4.5 replacement before 30 Nov | Approve as Sonnet 4.5 replacement |
| GPT-6.1 Terra | **SYNTHETIC-ONLY (draft)** | draft PR #1013 (`lib/inference/openai-terra-responses.ts`, default-off, no route imports it) | vision / computer-use benchmark | Benchmark on synthetic fixtures; new-processor privacy decision first |
| Jev / TypeSafe SystemOne | **DEPLOYED; CONFIG UNKNOWN** | `lib/typesafe/jev-shadow.ts`, `systemone.ts`, `understanding.ts`, `semantic-gate.ts`, `jev-router.ts`; all no-ops without `TYPESAFE_API_KEY` | closed-choice gate, referent among code-supplied IDs, clarify signal | Keep; parallelise; measure overlap |
| Mercury (Inception) | **DEPLOYED; CONFIG UNKNOWN** | `lib/services/mercury.ts`; used by `claude.ts` web answers, `conversation-summary.ts`, `voice-call.ts`; on only if `INCEPTION_API_KEY` set | read-only web answers, summary compaction | Keep for public text; never authoritative evidence. #274 noted Mercury summary timeouts on an earlier deploy |
| Groq (gpt-oss-20b) | **DEPLOYED; CONFIG UNKNOWN** | `lib/inference/cheap.ts` L23–41; used by `url-summary.ts`, `deep-research.ts`, `make/generate.ts`; personal data refused by `adapter.ts` | public, non-personal classes only | Keep |
| Gemini flash-lite | **DEPLOYED; CONFIG UNKNOWN** | cheap.ts L43–60; free tier marked `trainsOnInputs:true` | public-only | Keep public-only; prefer the paid tier if used with any real volume |
| OpenRouter | **SYNTHETIC-ONLY, unregistered** | `lib/inference/openrouter-gateway.ts` L1–15: imported by nothing; cheap.ts L2 says "no gateways" | optional pinned, ZDR public-text experiment | **Do not activate.** Needs an owner provider-policy change, DPA review and a separate PR |
| OpenUI / Thesys-style cards | **DEPLOYED (search, dining); drafts open** | `lib/openui/search-observation.ts`, `dining-observation.ts`, `components/dashboard/openui-*.tsx`, `app/api/openui/dining/[id]/route.ts`; `verify-openui-search` registered. Drafts #877, #879, #881, #886 open. No Thesys SDK dependency. | source-grounded cards and map pins | Keep; no hosted acceptance |
| Obscura | **DEPLOYED code, default OFF; CONFIG UNKNOWN** | `lib/agent/obscura-public-read.ts` L115 (`GOGO_OBSCURA_PUBLIC_READ==='1'`), `obscura-pilot-runtime.ts` (pinned v0.2.5 SHA256); merged via #926; draft #884 still open; `verify-obscura-pilot` **not** in `npm test`. #274 (26 Oct) says the owner reportedly set the flag to 1 for Flipkart, unverified. | optional public-read engine | Keep OFF until binary, sandbox and privacy review plus an approved canary. Verify the flag. |
| BrowserOS | **UNSUPPORTED** | no code | — | research only |
| CopilotKit / OpenDots | **UNSUPPORTED** | not in `package.json`; no imports | agent UX ideas | research only |
| Claude Duet (pattern) | **IMPLEMENTED (own components)** | `scripts/verify-duet-round6.mts` registered; Today/Work views in the dashboard | Today/Work, missions, approvals | Keep; no live acceptance (T12 OPEN) |
| Perisclaw / Instinct / Wajo features | **PROPOSED / research** | `docs/architecture/02-instinct-teardown*.md`, `scripts/verify-oct19-instinct-parity.mts`; the OpenRouter gateway is "Phase OR-1 of the Perisclaw/OpenRouter handoff" | missions, ambient memory, reliability benchmark | research only |
| Browserbase | **IMPLEMENTED; CONFIG UNKNOWN** | `lib/agent/managed-browser.ts` L8 (`GOGO_BROWSER_RUNTIME==='browserbase'`), India proxy, keep-alive | managed browser | Measure minutes and proxy GB per mission |
| Vercel Sandbox | **IMPLEMENTED** | `lib/agent/secure-computer.ts` L11 (`@vercel/sandbox` 3.2.2) | secure computer, Obscura host | Measure CPU and memory per mission |

---

## 5. Pricing business case

### 5.1 Current catalogue (verified in source)

`lib/pricing/gogo-plans.ts` (version `india-v6-0-249-499-999`, L93):

| Public plan | ₹/month | `cogsBudgetInr` | Web watchers | Razorpay amount (`razorpay-subscriptions.ts` L13–17) | DB entitlement written (`entitlementKeyFor` L26–31) | Cost-guard row it lands on (`gogo-cost-guard-v1.sql` seed) |
|---|---|---|---|---|---|---|
| Free | 0 | 25 | 0 | — | free | `free` ₹25 |
| Essential | 249 | 120 | 1 | 24,900 paise | `lite` | `lite` ₹120 |
| Plus | 499 | 240 | 3 | 49,900 | `pro` | **`pro` ₹480, 6 watchers** |
| Pro | 999 | 480 | 6 | 99,900 | `founder` → tier `founder_pro` (`payments/webhook/route.ts` L15–19) | **`founder_pro` ₹5,000, 20 watchers** |

The catalogue is Free / ₹249 / ₹499 / ₹999, confirmed. **Mismatch found (§9 D4):** the cost-guard rows a Plus or Pro subscriber lands on are one or more tiers more generous than the catalogue's COGS budget. Production rows are UNKNOWN; this is the repo seed.

Razorpay: subscriptions use a 7-day trial by default (`RAZORPAY_TRIAL_DAYS ?? '7'`, L153). **No change is proposed to existing subscribers, plan IDs, entitlement keys, trials or webhooks.**

### 5.2 Net revenue per subscription

GST-inclusive consumer price ÷ 1.18, minus ~3.5% payment cost. That is Razorpay's 2% standard fee plus 0.99% Subscriptions fee, with 18% GST on the fees (<https://razorpay.com/blog/razorpay-payment-gateway-pricing-explained/>; contracted rates may differ).

| Price | Net to AskGogo |
|---|---|
| ₹249 | ₹203.6 |
| ₹499 | ₹408.1 |
| ₹599 (founding) | ₹489.9 |
| ₹799 (Personal) | ₹653.4 |
| ₹999 | ₹817.0 |

### 5.3 Unit COGS (proposed Haiku-first routing; current routing in brackets)

| Unit | Definition (PROPOSED billable unit) | ₹ cost |
|---|---|---|
| **Request** | One inbound user message, answered (any surface) | **₹1.49** (₹2.93): WhatsApp ₹1.17, model ₹0.18 (₹1.62), search ₹0.14 |
| **Research mission** | Bounded task: ≤ 15 planner steps, ≤ 5 browser minutes, ≤ 25 MB proxy, ≤ 3 searches | **₹21** (₹31) |
| **Watcher** | One active watch, cadence per plan; each check is metered as requests or missions | per check |
| **Outbound notification** | One proactive WhatsApp message outside a user turn (template if outside the 24 h window) | ₹0.48 Twilio + ₹0.115 Meta utility (+ GST) |
| **Browser minute** | Wall-clock minute of a managed browser or sandbox | ₹0.16 (Browserbase $0.10/hr overage) + proxy |
| **Seat** | One named user in a workspace | — |
| **Workspace** | One organisation boundary with its own policy and admin | org fee |
| **API top-up** | Prepaid pack of requests + missions | price ≥ 2× unit COGS |

WhatsApp transport is now the largest per-request cost: Twilio charges $0.005 on the inbound and on each outbound message. Once models are on Haiku 5.5, it is ~6× the model cost.

### 5.4 User profiles, monthly variable COGS (₹)

| Profile | Use | Proposed routing | Current routing |
|---|---|---|---|
| Idle | 8 requests, 0 missions, 8 notifications | 16 | 28 |
| Light | 45 requests, 1 mission, 20 notifications | 99 | 174 |
| Typical | 220 requests, 4 missions, 45 notifications | 438 | 793 |
| Heavy (p95) | 900 requests, 15 missions, 90 notifications | 1,710 | 3,151 |

### 5.5 Per-plan gross margin (variable COGS only, proposed routing)

| Plan | Net | Light user margin | Typical user margin | Heavy user margin | With recommended caps (worst case) |
|---|---|---|---|---|---|
| Essential ₹249 | 204 | +105 (51%) | −234 | −1,506 | cap 75 req + 1 mission → COGS ≤ ₹133 → **≥ 35%** |
| Plus ₹499 | 408 | +309 (76%) | −30 | −1,302 | cap 150 req + 3 missions → ≤ ₹287 → **≥ 30%** |
| Personal ₹799 (proposed) | 653 | +554 | +215 (33%) | −1,057 | cap 150 req + 5 missions (guide §2.3) → ≤ ₹328 → **≥ 50%** |
| Founding ₹599 (3 months) | 490 | +391 | +52 (11%) | −1,220 | same caps as ₹799 → ≤ ₹328 → **≥ 33%** |
| Pro ₹999 | 817 | +718 | +379 (46%) | −893 | cap 300 req + 8 missions → ≤ ₹615 → **≥ 25%** |

With current Sonnet routing, the "typical" user is loss-making on every plan except Pro.

### 5.6 Is a ₹799 Personal tier worth it?

- **Unit economics:** yes, *with caps*. At 150 requests and 5 missions a month, ₹799 holds a ≥ 50% worst-case margin. Plus at ₹499 holds ~30% only if capped at 150 requests and 3 missions.
- **Confusion risk:** adding ₹799 between ₹499 and ₹999 creates five price points. Recommendation: **test ₹799 as a new-signup-only arm**, landing-page cohort A/B: current catalogue vs catalogue with Personal ₹799 (founding ₹599 for 3 months) replacing Plus *for new visitors only*. Existing ₹499 subscribers are untouched.
- **30-day experiment:** primary metric is paid conversion × 30-day retention × gross margin per paying user. Guardrails: refund rate, support tickets per user, heavy-user share. Minimum sample about 300 checkout-page visitors per arm before reading (directional only at this scale).
- **Prerequisites:** caps enforced in code (a `plan_limits`-style allowance on requests and missions); micro-dollar metering per tenant (§9 D2/D3); WhatsApp channel eligibility (§7). **Pricing changes need commercial approval and a separate Razorpay PR.**

### 5.7 Teams and Enterprise (PROPOSED)

| Offer | Price (ex GST) | Pooled caps (proposed) | Example |
|---|---|---|---|
| Teams | ₹1,499/seat/month, min 10 | 250 req + 8 missions per seat, pooled | 10 seats = ₹14,990 |
| Enterprise | ₹2,499/seat/month, min 20, + ₹24,999/month org fee | 300 req + 10 missions per seat, pooled; org-level browser credits | 20 seats = ₹74,979; 50 seats = ₹1,49,949 |
| Enterprise Plus | custom + setup ₹75k–₹2L | negotiated | — |

Seat COGS at the cap is ≤ ₹600 (proposed routing), so seat margin is ≥ 60% at ₹1,499. **Do not sell SSO, SOC2/ISO, data residency, DLP, SLA or unlimited automations**; none is verified in code. Sell a 30-day paid pilot with 2–3 scoped workflows and pass/fail KPIs. Enterprise on WhatsApp has the same channel-eligibility question (§7). A web/Slack/email-first enterprise offer avoids it.

---

## 6. 100-user financial forecast

### 6.1 Assumptions (all illustrative; FX ₹95/$ as in the guide; the repo's rate card uses ₹88)

- Turns per DAU per day: 10 (30 DAU), 15 (60 DAU), 30 (100 DAU). That gives 9,000 / 27,000 / 90,000 turns a month, the same volumes as ChatGPT's review.
- 1.3 outbound WhatsApp messages per turn; 2 proactive notifications per DAU per day, 60% of them as utility templates outside the 24 h window.
- **Twilio:** $0.005 per message, inbound or outbound, plus $0.001 per failed message. From Twilio's pricing page (static mirror <https://static0.twilio.com/en-us/whatsapp/pricing>, "current as of September 2026"; the canonical www page was blocked in this session). The 4 Oct 2026 change left Twilio's own fee unchanged and passes through Meta's new in-window fees (<https://www.usagepricing.com/blueprint/activity/twilio-2026-10-04-whatsapp-meta-service-fees>).
- **Meta (India):** per-message pricing since 1 Jul 2025. **Since 1 Oct 2026, service messages beyond 1,000 per number per month, and utility templates inside the window, are charged** (<https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing>). India rates: marketing ₹0.8631, utility and authentication ~₹0.115, ex GST, per a third-party summary (<https://montymobile.com/blogs/whatsapp-business-api-pricing-in-india-inr-rates-gst-and-the-2026-currency-migration-deadline>). **Unverified against Meta's INR rate card.** The service-beyond-free-tier rate is assumed equal to utility. INR billing migration is required by 31 Dec 2026.
- **Models:** §2.5 per-turn figures; 40% of turns make one downstream call. TypeSafe excluded (price UNKNOWN).
- **Browser:** 0.2 missions per DAU per day; 5 minutes on Browserbase at $0.10/hr overage; 20 MB proxy at $10/GB; planner per §3.6. Vercel Sandbox, if used instead: $0.128/active-CPU-hr + $0.0212/GB-hr (<https://vercel.com/docs/sandbox/pricing>), ~$0.002–0.01 per 5-min run.
- **Search:** 25% of turns; blended $0.006 per search (Tavily ~$0.008, Serper ~$0.001 per query, <https://costbench.com/compare/serper-vs-tavily/>). #274 recorded Tavily HTTP 432 usage-limit errors earlier.
- **Fixed (estimates, not verified):** Vercel Pro seat + usage ~$70, Supabase Pro + compute ~$75, Browserbase Startup $99, search plans ~$50. Total ~$294 ≈ ₹27,930.
- **Support:** ₹12,500/month (≈ 25 h; assumption).
- **Excluded:** TypeSafe, Bolna voice, AssemblyAI, Resend, OpenAI fallback, refunds and chargebacks, GST on vendor imports (reverse charge; ask the tax adviser), failed-message fees.

### 6.2 Monthly cost (₹)

| Scenario | Turns/month | WhatsApp (Twilio + Meta) | Models | Browser | Search | Fixed | Support | **Total (proposed)** | Total (current routing) |
|---|---|---|---|---|---|---|---|---|---|
| 30 DAU | 9,000 | 12,042 | 1,634 | 3,823 | 1,282 | 27,930 | 12,500 | **59,211** | 73,968 (models 14,651) |
| 60 DAU | 27,000 | 35,377 | 4,901 | 7,645 | 3,848 | 27,930 | 12,500 | **92,201** | 134,735 (models 43,954) |
| 100 DAU | 90,000 | 114,929 | 16,338 | 12,742 | 12,825 | 27,930 | 12,500 | **197,264** | 333,242 (models 146,514) |

For comparison, ChatGPT's model-only estimate was ~$22 / $85 / $312; this model gives $17 / $52 / $172 (proposed).

### 6.3 Revenue at 100 paying users (net of GST and Razorpay)

| Mix | Net revenue/month |
|---|---|
| All Plus ₹499 | ₹40,810 |
| 30 Essential / 50 Plus / 20 Pro | ₹42,853 |
| All Personal ₹799 | ₹65,340 |

**Reading:** at 30 DAU (light use) the business roughly breaks even on direct cost at ₹799 and loses money at the current mix. At 60–100 DAU with uncapped use it loses money under every mix. Fixed cost is ~47% of the 30-DAU total. The variable driver is the per-message WhatsApp fee.

### 6.4 Recommended launch limits and guardrails (PROPOSED)

| Control | Value |
|---|---|
| Per-user daily request cap | Free 5, Essential 10, Plus 15, Pro 25 (soft message at 80%) |
| Per-user monthly cap | Essential 75, Plus 150, Personal 150, Pro 300 requests; missions 1 / 3 / 5 / 8 |
| Per-user daily spend stop | $0.25 (ChatGPT's figure; ₹24) across all metered vendors |
| Pilot model budget | $500/month planned, $750 approval trigger (guide) |
| Total COGS alert | ₹1,00,000/month for the 100-user cohort; hard review at ₹1,50,000 |
| Mission caps | ≤ 15 planner steps, ≤ 5 browser minutes, ≤ 25 MB proxy, 1 concurrent mission per user |
| Outbound | ≤ 1 outbound message per reply where possible (merge bubbles); proactive ≤ 3/day/user |
| Stop policy | Exceeding the daily stop → reply-only mode (no missions, no search) until reset |
| Biggest lever (needs owner decision) | Meta Cloud API direct instead of Twilio would remove the $0.005 fee (~₹1/turn) but changes provider, number and compliance posture. **Do not change without approval and §7 clearance.** |

---

## 7. WhatsApp AI-provider eligibility (India): launch blocker

### 7.1 Policy text

The WhatsApp Business Solution Terms add an "AI Providers" clause, quoted in segments by 9to5Mac (<https://9to5mac.com/2025/10/20/whatsapp-bans-ai-chatbots-from-using-its-business-api/>):

> "Providers and developers of artificial intelligence or machine learning technologies" … "are strictly prohibited from accessing or using the WhatsApp Business Solution, whether directly or indirectly" … "when such technologies are the primary (rather than incidental or ancillary) functionality" … "being made available for use" … "as determined by Meta in its sole discretion".

- Effective for new API users from 15 Oct 2025 and for all users from **15 Jan 2026** (<https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/>; <https://respond.io/blog/whatsapp-chatbot-policy-2026>).
- The definition covers LLMs, generative AI platforms and **general-purpose AI assistants**. Businesses using AI to serve *their own* customers (e.g. a travel company's support bot) are not barred (TechCrunch, quoting Meta).
- **EU only:** Meta offered paid access to rival AI chatbots in Europe in March 2026 (<https://techcrunch.com/2026/03/05/meta-will-allow-rival-ai-chatbots-on-whatsapp-in-europe-but-for-a-fee/>). On 9 Jun 2026 the European Commission ordered interim measures to restore access for the duration of its investigation; Meta said it would appeal (<https://www.morningstar.com/news/dow-jones/202606095919/meta-gets-eu-antitrust-order-to-open-whatsapp-to-rival-ai-chatbots-update>). **No India exception or CCI action was found** (search, 28 Oct 2026).
- The primary terms page (`whatsapp.com/legal/business-solution-terms`) could not be fetched in this session. **The verbatim clause above is from secondary reporting and must be checked against the live terms.**

### 7.2 Is AskGogo affected?

**Verdict: very likely in scope, so this is a launch blocker for selling a WhatsApp-native general assistant.** Reasons:

- AskGogo's own product copy makes WhatsApp-delivered AI the primary functionality: "Talk to Gogo", "WhatsApp Gogo" (`gogo-plans.ts` L24, L37), and the product is described as a "WhatsApp-first AI assistant". Answering open questions, research, chat (`askClaude`) and the context-first Brain are general-purpose assistant behaviour.
- The "own customers" exemption fits a business's support bot, not an AI assistant sold as the product. Meta decides "in its sole discretion".
- An approved display name or an active Twilio sender is **not** policy clearance.
- Enforcement risk: the business number can be restricted or banned, which takes the channel away from every user at once.

**Uncertain:** whether narrower uses count as "ancillary", such as reminders and notifications for a task app, or document retrieval. Respond.io flags "concierge" assistants as a grey area.

### 7.3 Required actions before any paid WhatsApp rollout

1. Written eligibility guidance from **Meta (via the BSP) and Twilio** for AskGogo's exact use case, India market. Keep the correspondence.
2. Indian counsel review of WhatsApp terms + DPDP: Rules notified 13 Nov 2025, consent-manager phase ~Nov 2026, core obligations ~May 2027 (<https://compliancehub.wiki/india-dpdp-consent-manager-november-2026-phase-two-deadline-compliance/>; secondary, verify with counsel).
3. **Commercial fallback:** a web/PWA- or app-first product with the dashboard chat (already at parity with WhatsApp via the same Brain and SameBrain dispatch). Limit WhatsApp to approved utility notifications tied to the user's own tasks, if Meta confirms that is ancillary.
4. **Do not reword marketing to evade the policy** (guide §6.1).

---

## 8. Launch readiness and blocker report

Production SHA (per #274 and parent): `530ee862`. **CI green ≠ live acceptance.** Independently accepted: **0/13.**

| # | Journey | Status | Evidence (SHA / PR / test) | Required approval | Rollback |
|---|---|---|---|---|---|
| 1 | WhatsApp onboarding, auth, handset delivery, idempotency | **OPEN**; deployed + synthetic CI | SID claim route.ts L316; #919 signed-POST guard (via #926 `8cccffa7`); no handset receipt proof | Owner handset test (T1 prompt) | revert to prior Vercel deployment |
| 2 | SameBrain + Jev contextual, two-owner isolation | **OPEN / SECURITY HOLD** | Brain #1052, #1054 deployed; #1052 P2s unresolved; owner-precision drafts #902, #909, #1029, #1030 | Claude fix of #1052 P2s; two-owner live test | `GOGO_BRAIN=off` + redeploy (needs approval) |
| 3 | Vault / Take Control same-run login continuation | **FAIL/BLOCKED** | stale handoff `4de75c11…` (#274, 26 Oct); **#1053 P1** deployed | Claude #1053 fix + independent review | do not toggle kill switches blindly (#274 6463063540) |
| 4 | Shopping comparison (iPhone 16) | **PARTIAL** | 25 Oct handset 3/4, Flipkart 45 s timeout; Obscura flag unverified | Obscura security review + canary | Obscura flag 0 |
| 5 | Restaurant Indiranagar research-only | **PARTIAL** | draft #893; original request still failed (#274 6463063540) | review #893 | n/a |
| 6 | Hotel / flight / activity live source, no booking | **FAIL/OPEN** | #925 route; hotel Maps links absent; flight ~44.5 s, no verified itinerary; **#1047 P2s** | Claude #1047 fix | booking kill switch (#1053; needs redeploy) |
| 7 | Flight ticket PDF, saved legs, provenance | **PARTIAL** | two IndiGo legs saved; PDF `DOMMatrix` error recurring (78 in 24 h per #274); draft #1004 | merge #1004 after review | n/a |
| 8 | Reminder and watcher delivery, expiry, dedupe | **OPEN** | #921 hold mechanics in CI; no confirmed live due-reminder delivery; `answerFollowups` sends outside the notification ledger (gap matrix G6) | owner T10 test | — |
| 9 | Gmail / Calendar / Drive approval + read-back | **OPEN** | only Google Calendar has outcome reconciliation; draft #923 | owner T11 test | — |
| 10 | Duet / Make / Channels / SecondBrain workspaces | **OPEN** | inert suites (`verify-duet-round6`, `verify-secondbrain-*`) | owner T12 test | — |
| 11 | Failed-provider continuation, unknown outcome no-retry | **BLOCKED** | **#1053 P1** (Work finding, Claude source); drafts #1040–#1044, #1048 | Claude fix + Work review + owner release | per #274 safe-recovery review |
| 12 | Safe UI, metering, cost, privacy | **BLOCKED** | cost-metering defects D1–D4 (§9); privacy drafts #1034–#1037; `RAW_TWILIO` body logging (gap matrix G8) | metering fix + privacy review | — |
| 13 | Independent owner live acceptance | **NOT STARTED** | 0/13 | owner | — |
| + | WhatsApp channel eligibility | **BLOCKER** (§7) | none | Meta/Twilio written guidance + counsel | web-first fallback |
| + | Cost and pricing gates | **BLOCKER for paid launch** | §5–6 | commercial approval; caps in code | — |

### 8.1 Minimum safe 100-user launch scope (PROPOSED)

- **Channel:** web dashboard first; WhatsApp only if §7 clears.
- **In scope:** read-only research with source cards (no booking), reminders and lists, saved documents and retrieval, calendar read, flight status (read).
- **Out of scope:** bookings, payments, Take Control, consequential browser actions (until #1053 is fixed and accepted), Gmail send, Obscura.
- **Caps:** per §6.4. Brain on Haiku 5.5 only after §3 gates.

### 8.2 Owner approvals list

1. Model switch: `GOGO_BRAIN_MODEL` and the hard-coded Sonnet 4.5 sites → Haiku 5.5 / Sonnet 5.5. **Deadline 30 Nov 2026** (Sonnet 4.5 retirement).
2. Turning off the production Haiku shadow, or moving it to after-response recording.
3. New processor (OpenAI for Terra; OpenRouter): privacy notice, DPA, synthetic-only first.
4. Pricing experiment (₹799 / ₹599 arm), caps in code, Razorpay plan creation: commercial approval + separate PR.
5. WhatsApp eligibility enquiry to Meta/Twilio; counsel engagement.
6. Any production canary, env change or redeploy.
7. Optional: BSP change (Twilio → Meta Cloud API direct).

---

## 9. Isolated low-risk defects found (described, not fixed)

| ID | Defect | Evidence | Impact | Suggested owner |
|---|---|---|---|---|
| D1 | `estimateCostUsd` rounds each call to $0.001 | `brain.ts` L397 | Haiku shadow shows $0.001 instead of ~$0.00045; per-turn comparisons distorted | parent session (already in scope) |
| D2 | Every Brain call, **including the shadow**, writes a flat estimate to the user's COGS ledger: Sonnet ₹5, Haiku ₹1 | `brain.ts` L239–248 → `cost-guard.ts` L15–24, L125–146 (`COST_ESTIMATES_PAISE`) | True cost is ~₹1.0–1.3 (Sonnet 4.5) and ~₹0.04 (Haiku 5.5). The shadow alone burns ₹1/turn of the user's budget. On Free (₹25) a Brain turn costs ₹6, so ~4 turns exhaust the budget, after which `checkCostAllowance` blocks budget-checked paid work. Limited today (owner canary only), material on rollout | Claude / parent (Brain metering) |
| D3 | Rate card prices **all** Haiku at Haiku 4.5 ($1/$5) and all Sonnet at $3/$15 | `lib/metering/core.ts` L49–60 (`DEFAULT_RATES`), L63–69 (`modelFamily`) | Haiku 5.5 overstated ~10×, Sonnet 5.5 ~1.5×; FX 88; WhatsApp outbound ₹0.35 vs ~₹0.48 actual; Twilio inbound not classified (`classifyRequest` has no Twilio host, L92–108). Admin COGS figures are unreliable | metering owner (unleased; check #274) |
| D4 | Public Plus → entitlement `pro` → cost budget ₹480 / 6 watchers (catalogue ₹240 / 3); public Pro → `founder_pro` → **₹5,000 / 20 watchers** (catalogue ₹480 / 6) | `razorpay-subscriptions.ts` L26–31; `payments/webhook/route.ts` L15–19; `supabase/gogo-cost-guard-v1.sql` L21–29; `gogo-plans.ts` | A ₹999 subscriber's COGS hard stop is 5× their price. Production rows UNKNOWN; verify before launch | commercial + billing owner |
| D5 | Shadow wait adds up to 2.5 s to the live reply | `brain.ts` L312–315 | p95 latency | parent session (in scope) |
| D6 | `decisionsAgree` treats any two `reply`/`ask`/`later` decisions as agreeing | `brain.ts` L408–413 | inflated agreement | parent session (in scope) |
| D7 | "No tracking, just status" is read as a tracking request: `TRACK_ASK` matches "tracking", `TRACK_REFUSED` has no bare "no" | `brain.ts` L109–116 | a watcher plus later messages the user refused | parent session (in scope) |
| D8 | `verify-brain-oct27.mts` and `verify-obscura-pilot.mts` are not in `npm test` | `package.json` `test` script | Brain negatives and the Obscura pilot are not run in CI | test owner |
| D9 | WhatsApp Brain runs before the approval agent and the pending-question registry | route.ts L945 vs L1263, L1374 | a long single-line answer to a question without "?" can be rewritten | Claude (Brain lease) |
| D10 | Jev shadow and understand-first receive the Brain-rewritten text | route.ts L952 then L1047, L1407 | shadow telemetry cannot measure the Brain's effect against the original | Claude |
| D11 | Canary membership by phone suffix (last 10 digits), on WhatsApp and dashboard | `brain.ts` L37, L41–47; dashboard route L271 | identity precision (already in #274 6445725270) | Claude |
| D12 | `plan_limits` seed in docs uses legacy codes only (no `essential`, `plus`) | `docs/ASKGOGO-METER-BACKEND-SCHEMA.md` L54–61 | allowance lookups may fall back to `free` for new public codes if production matches the doc (UNKNOWN) | billing owner |

---

## 10. Top 10 prioritised actions

1. **Fix or isolate #1053** (Claude source, Work review), with no blind toggles. It blocks consequential browser use.
2. **Get written WhatsApp AI-provider eligibility guidance** (Meta/Twilio) and counsel. Prepare the web-first fallback.
3. **Decide the Sonnet 4.5 replacement before 30 Nov 2026.** Minimum: Sonnet 5.5 at the hard-coded sites. Target: Haiku 5.5 where §3 passes.
4. **Fix cost metering** (D1–D3): micro-dollar per call, real per-model rates, shadow excluded from user budgets. Without it no margin number is trustworthy.
5. **Verify production cost-guard and plan-limit rows** (D4, D12) before any paid user.
6. **Build the gold set and runner** (§3) from `verify-understanding-golden` plus #1013 workloads. Run Jev vs Haiku 5.5 vs Sonnet 5.5 offline.
7. **Parallelise Jev with the Brain; skip understand-first after a resolved Brain rewrite; move shadow recording after the response.** Saves latency at no extra cost.
8. **Enforce per-plan request and mission caps in code** (§6.4) before inviting 100 users.
9. **Measure browser minutes and proxy GB per mission** (Browserbase and Sandbox). Proxy may dominate mission cost.
10. **Run the ₹799 / ₹599 new-signup arm only after 30 days of measured COGS**, in a separate commercial PR. Existing subscribers stay untouched.

---

_Sources consulted (external): Anthropic pricing and deprecations pages; Twilio WhatsApp pricing (static mirror); Meta WhatsApp pricing docs; TechCrunch, 9to5Mac, respond.io, Morningstar/Dow Jones on the AI-provider policy; Browserbase plan docs; Vercel Sandbox pricing; Razorpay pricing blog; costbench (Tavily/Serper); MontyMobile (India INR rates); compliancehub (DPDP phases). Blocked in this session: `whatsapp.com/legal/business-solution-terms`, `twilio.com/en-us/whatsapp/pricing` (canonical), `browserbase.com/pricing`._
