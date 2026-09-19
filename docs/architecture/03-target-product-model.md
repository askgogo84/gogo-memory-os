# 03 — Target product model

**FROZEN v1 — 19 Sep 2026**

This is Run 3 of the five-run plan. It freezes a per-capability target for AskGogo by placing each
capability's current state next to a benchmark behaviour and recording a verdict —
**COPY / ADAPT / IGNORE / DIFFERENTIATE** — with the bug or schema drift that blocks it.

Being *frozen* means the verdicts below are the decision of record for v1. They are not re-opened by
new marketing claims; they are re-opened only by new **OBSERVED** evidence (the discipline inherited
from Run 2) or by a resolved schema question. The genuinely undecided items are collected at the end
under **Open decisions** and are deliberately left open.

**Inputs (read in full for this run):**

- [`01-askgogo-capability-audit.md`](./01-askgogo-capability-audit.md) — the AskGogo state, tiered
  W/B/C, cited to `file:line` on commit `0007897`. All AskGogo `file:line` references below come from
  it (its §2 inventory and §8 routing map).
- [`02-instinct-teardown.md`](./02-instinct-teardown.md) — the Instinct benchmark, now with a
  populated OBSERVED tier (§O).
- [`02-instinct-teardown-observed.md`](./02-instinct-teardown-observed.md) — the raw evidence record
  (19 Sep live WhatsApp thread). Its §10 carries *provisional* verdicts; this document **confirms or
  overturns each explicitly** in §2 below.
- [`NIGHT-REPORT-2026-09-19.md`](./NIGHT-REPORT-2026-09-19.md) — the schema drifts (D1–D6), the
  policy-gate coverage finding, the webhook/RLS decisions, and the 19 Sep live-bug investigation from
  which B1–B4 below are drawn.
- **Meta Muse** as the dashboard / control-plane benchmark. No source for Muse could be opened in
  this session, so every Muse reference is tagged **INFERRED** (from general product knowledge, not a
  citable source) and is used only where the benchmark is a control-plane surface, not a consumer
  task.

---

## 0. Legend — the bugs and drifts referenced per capability

The "Blocking" column of every capability table below references these by ID. They are defined once
here so the tables stay terse.

### Live bugs (B) — from the 19 Sep live-bug investigation in the night report

| ID | Bug | `file:line` | Effect | Source |
|---|---|---|---|---|
| **B1** | **Failure-to-decline conflation.** A specialist that *throws* is indistinguishable from one that *declined* — the bridge's catch returns bare `null` | `feature-intents.ts:361` | An infra fault silently degrades to the least-capable path, which then **denies the capability exists in the product's own voice** | NIGHT-REPORT §1, §5 |
| **B2** | **Unguarded multi-chunk WhatsApp send.** No try/catch inside the send loop | `lib/whatsapp.ts:93-97` | A later chunk failing after the first is delivered gives the user a **partial reply plus a false "temporarily unavailable"** message | NIGHT-REPORT §4 |
| **B3** | **Fail-closed invariant is train-only.** The anti-fabrication rule lives in exactly one function | `lib/agent/train-research.ts:170-174` | Six other paths can state **unverified prices / availability / inventory**; the load-bearing one is `same-brain.ts:141` | NIGHT-REPORT §3 |
| **B4** | **Incomplete refusal filter.** The regex that catches model refusals misses the "I cannot open / text-based AI / browse" wording | `process-message.ts:1039`, `:1234` | A **false denial of a shipped capability** passes straight through to the user | NIGHT-REPORT §2 |

### Schema drifts (D) — from §8.3 of the audit and NEEDS-DECISION 1 of the night report

| ID | Drift | Write site | Constraint | If production matches the repo |
|---|---|---|---|---|
| **D1** | `agent_goals.status = 'blocked'` | `goal-engine.ts:83`, `whatsapp-bridge.ts:184`, `goals/route.ts:80` | `active/paused/completed/cancelled` (`agent-os-v1.sql:13`) | `goal-engine.ts:84` **throws**; every goal-worker pass over a blocked-step goal fails on the `*/15` cron |
| **D2** | `agent_watchers.type` = `'web_search'` / `'goal_review'` | `watchers.ts:95`, `goal-engine.ts:100` | seven types incl. `web_change` but **not** these (`agent-os-v1.sql:120`) | every web watcher and every goal watcher **fails to create** |
| **D3** | `agent_watchers.cadence_minutes` below floor | `watchers.ts:58` (`max(15,…)`), `watch-command.ts:44` | `>= 60` (`agent-os-v1.sql:122`) | any watcher at the adaptive floor is rejected |
| **D4** | `life_events.lifecycle_state = 'needs_attention'` | `life-event-worker.ts:256`, `life-event-execution.ts:140` | eight states, not incl. it (`life-events-v1.sql:18`) | **fails silently** on the safety path that stops an uncertain check-in being retried |
| **D5** | `agent_steps` and `agent_threads` have **no `CREATE TABLE`** anywhere in `sql/`/`supabase/` | 15 modules write them | — | the agent's step ledger and thread store are **unreproducible from this repo**; RLS state unknown |
| **D6** | `agent-os-v2-whatsapp-native.sql` widens `capability` to 11 values but is *"branch-only, apply after QA"* | `agent-os-v2-whatsapp-native.sql:1-16` | — | if unapplied, runs with capability `reminders`/`lists`/`tasks` are rejected |

**None of D1–D4 is caught by `npm test`** — the 62 checks never open a database connection. One
`pg_constraint` query (night report NEEDS-DECISION 1) settles all of them and is the single most
urgent action carried into this run.

---

## 1. Cross-cutting invariants and patterns

These bind *every* capability. They come before the per-capability table because a verdict of COPY
or ADAPT below is void if the invariant it depends on is not held.

### 1.1 FAIL-CLOSED INVARIANT (non-negotiable for v1)

> **No path may state a price, an availability, or an inventory fact without a verified source.**
> A failed or absent provider read must report the failure — it must never hand the question to a
> path that answers from the model.

This is the bet that separates AskGogo from the benchmark (see §O.11 of the teardown: Instinct
produced six train timings with no visible source; whether they were live-read or model-knowledge is
**UNRESOLVED** and untested — no conclusion is recorded, but AskGogo's opposite bet is deliberate).

Today the invariant lives in exactly **one** place — `lib/agent/train-research.ts:170-174`, which
returns a `status:'failed'` result instead of throwing, so the caller cannot fall through to a
fabricating path. The only other anti-fabrication control, `hardenTravelResearchResult`
(`travel-research-sanitize.ts:71`), is applied at four travel-research call sites only.

**Every path that currently violates the invariant (from NIGHT-REPORT §3):**

| # | Violating path | `file:line` | Why it can fabricate |
|---|---|---|---|
| 1 | `web_search` intent | `process-message.ts:1030-1043` | `askClaudeWithContext` over snippets; no sanitizer; the B4 refusal filter is the only guard and is incomplete. **This is what answered the 19 Sep amazon.in message** |
| 2 | `general_chat` → `type==='search'` | `process-message.ts:1228-1237` | same call, same incomplete B4 filter |
| 3 | `general_chat` → `askClaude` | `process-message.ts:1202` | free-form model answer from memory + history |
| 4 | **General planner's generic step** | `general-planner.ts:312` → **`same-brain.ts:141`** | any step whose tool is not a whitelisted one falls to `dispatchThroughSameBrain`, which re-enters `processIncomingMessage` — i.e. paths 1–3. **This is B3's load-bearing site** |
| 5 | Agent-bridge repair path (normalised input) | `feature-intents.ts:356` | → `dispatchThroughSameBrain` → same as #4 |
| 6 | Simple workspace read | `feature-intents.ts:347-349` | same dispatch |
| 7 | Travel-research public-web fallback | `travel-research.ts:107` | **partially mitigated** — labels itself "fallback sources only, not completed live inventory"; the one honest path |

Paths 1–6 have no equivalent of the train rule and no sanitizer. **The v1 target is that the train
rule's shape (return a `status:'failed'` result that keeps the turn) is generalised to a single
choke point every specialist and the general planner pass through, and the B4 filter is completed so
a model refusal can never masquerade as a product answer.** This is the precondition for trusting any
COPY verdict on a task capability below.

### 1.2 Quoted-reply threading — CONFIRM COPY (§O.2)

Bidirectional quoted-reply threading (agent quotes the originating message; user quote-replies to a
specific agent question; the agent resumes the right task from the quote) keeps one linear WhatsApp
chat legible with several long-running tasks in flight. It costs nothing architecturally and directly
addresses AskGogo's current inability to disambiguate which in-flight task a bare reply belongs to.
**Confirmed COPY.**

### 1.3 Connector-on-demand, no dead ends — CONFIRM COPY (§O.3)

A missing integration must be presented as a next step (inline connect card + an alternative), never
as an error. AskGogo has the OAuth connect routes (`app/api/gmail/connect|callback`, `verify-google-
workspace-oauth.mts`) but the WhatsApp gap-handling wording is ad hoc. **Confirmed COPY** — this also
requires B1 fixed, because today a thrown connector step becomes a false "I can't do that."

### 1.4 Credential boundary + vault pattern — CONFIRM COPY (wording) / ADAPT (vault) (§O.7, §O.8)

The boundary — *identifier in chat, secret never in chat, secure link if a secret is needed* — is
better phrasing of a boundary AskGogo already enforces (`human_auth_required`). **Confirmed COPY**
for the wording. The **vault as a web surface** (Instinct's app.instinct.com vault) is **ADAPT**: it
belongs on AskGogo's dashboard, and a secret must never route through WhatsApp. AskGogo has no vault
surface today.

### 1.5 Provider reality — device handoff vs cloud takeover

Two walls, two responses, and they must not be conflated (audit §2F; teardown §O.9):

- **IP-reputation walls** — **IRCTC/Akamai** and **BookMyShow/Cloudflare** block datacenter IPs at
  the CDN. The cloud-takeover browser shares that datacenter IP, so takeover cannot solve them.
  Response: **device handoff** — hand the user a link for *their own* browser, hold state, resume when
  they signal. Both AskGogo (`provider-browser-handoff.ts`, `verify-browser-auth-gate.mts`) and
  Instinct (OBSERVED, §O.9) stop this way; the difference is only wording.
- **Human-presence walls** — CAPTCHA, login, OTP, payment auth. These are solvable by a human driving
  the same session, so: **cloud takeover only here** (`browser-handoff.ts`, self-hosted control UI,
  port 3001). Whether Instinct has this *second* branch as distinct from device handoff is unobserved.

`provider_access_limited` → device handoff; `human_auth_required` → cloud takeover. This split is
correct and is frozen as the v1 model. What it caps: **end-to-end autonomous booking cannot be
promised for IP-blocked providers** (IRCTC, BookMyShow). Risk R7 in the audit.

---

## 2. Confirming / overturning the observed doc's provisional verdicts (§10)

The observed record's §10 listed twelve provisional dispositions. Each is confirmed or overturned
here explicitly; these become the frozen decision.

| # | Behaviour (observed doc §10) | Provisional | **Frozen verdict** | Note |
|---|---|---|---|---|
| 1 | Quoted-reply threading (bidirectional) | COPY | **COPY — confirmed** | §1.2 |
| 2 | Connector-on-demand with inline link | COPY | **COPY — confirmed** | §1.3; needs B1 fixed |
| 3 | 👍 acknowledgement reactions | COPY | **COPY — confirmed** | removes noise from long threads; trivial |
| 4 | Triage as "three things that matter" + dismissal | ADAPT | **ADAPT — confirmed** | fits the existing morning briefing, not a new surface |
| 5 | Slot-filling with explicit "I still need two things" | COPY | **COPY — confirmed** | applies to train/flight/appointment specialists |
| 6 | Disambiguate rather than guess between two matches | COPY | **COPY — confirmed** | already the house rule; make it explicit in slot-filling |
| 7 | Credential boundary wording | COPY | **COPY — confirmed** | §1.4 |
| 8 | Credential vault as a web surface | ADAPT | **ADAPT — confirmed** | §1.4; dashboard only, never WhatsApp |
| 9 | Initiative on "U choose" with stated fallback | ADAPT | **ADAPT — confirmed** | low-stakes picks only; must **not** extend to money or identity |
| 10 | Creating an account in the user's name | DIFFERENTIATE | **DIFFERENTIATE — confirmed** | §O.12; the *offer* is observed, the consent step is not — verdict rests on AskGogo's own rule: identity creation needs DPDP-grade explicit, revocable, durably-recorded consent |
| 11 | Graceful stop at the account/IP wall, holding state | ADAPT | **ADAPT — confirmed** | AskGogo's device handoff already does this; borrow the wording |
| 12 | Answering without showing provenance | DIFFERENTIATE (pending §9) | **DIFFERENTIATE — confirmed, still pending the §O.11 test** | AskGogo's verified-or-refuse is the opposite bet; the provenance question stays UNRESOLVED until Instinct is asked directly |

No provisional verdict is overturned. One clause of the *teardown* (not §10) was overturned by
observation: "no equivalent block-handling split was described for Instinct" — §O.9 shows Instinct
does device-handoff too.

---

## 3. Per-capability target model

Legend for the columns: **AskGogo state** cites the audit's tier (W/B/C) and `file:line`. **Benchmark
tier** is Observed / Reported / Inferred per Run 2's rules (Instinct unless "Muse", which is always
Inferred). **Verdict** is COPY / ADAPT / IGNORE / DIFFERENTIATE with a one-line reason. **Blocking**
lists the B/D IDs from §0 that must clear first.

### 3.1 Personal-productivity core

| Capability | AskGogo state (file:line) | Benchmark behaviour (tier) | Verdict + reason | Blocking |
|---|---|---|---|---|
| **Reminders** (incl. recurring) | **W** — `lib/bot/handlers/reminders.ts` (611); `verify-interval-cadence.mts`, `verify-reminder-dedup.mts` | Proactive follow-up on dropped threads; agent initiates (REPORTED, teardown §4) | **ADAPT** — keep AskGogo's tested engine; add proactive re-surfacing on the model's terms | — |
| **Lists / tasks** | Lists **W** — `lib/data/lists-core.ts`; `lists-core.test.mjs`. Tasks **B** — `app/api/todos/route.ts`, `lib/dashboard/tasks.ts` | Not a distinct benchmark surface; folded into task execution (INFERRED) | **IGNORE** (benchmark) — AskGogo's list/task routing is more mature; keep it | — |
| **Calendar** | Actions **W** — `calendar-actions.ts` (750); `verify-calendar-routing.mts`. Connect **B** — `calendar/connect\|callback`. Mutations **B** — `calendar-mutations.ts` | Calendar read stated as a **conclusion** ("open today, rest of Saturday free"), not a list (OBSERVED §O.5) | **ADAPT** — copy the conclusion-shaped summary; keep AskGogo's create/conflict-move engine | — |
| **Memory** | **B** (9 of 11) — `memory-control.ts` (429), `memory-index.ts`, `match_memories` RPC, `memory-embeddings.sql`; only redaction + presentation are **W** | "Persistent computer" memory framed as the moat; recalls detail across days (REPORTED, teardown §3) | **DIFFERENTIATE** — AskGogo's structured, auditable, deletable memory is the *opposite bet* to a persistent VM; lean into correctability | — (but the untested cross-surface retrieval claim is the real gap, audit §2B) |
| **Documents** | **B** — `document-store.ts`, `document-links.ts`, `pdf-reader.ts` (376), `asset-memory.ts` (987), `asset-natural-retrieval.ts` | Handles attachments inside tasks; no distinct doc surface described (INFERRED) | **IGNORE** (benchmark) — AskGogo's asset memory is ahead; keep. NB known issue: freeform path can surface stored secrets (out of scope here) | — |
| **Receipts** | **B** — `lib/splitwise/` (5 mods), `split-receipts-v1.sql`, `expense-analyzer.ts`; itemize gate `whatsapp/route.ts:782` | Not benchmarked (INFERRED) | **IGNORE** (benchmark) — no comparable observed behaviour | — |
| **Meeting notes** | **B** — `meeting-transcription.ts`, `meeting-search.ts`; approval path **W** — `workspace-meeting-approval.ts`; `verify-workspace-meeting-approval.mts` | Not observed; triage of *mail* is (REPORTED/OBSERVED §O.4) | **IGNORE** (benchmark) — keep; the triage *shape* is borrowed under Gmail below | — |
| **Food** | Nutrition **W** — `nutrition.ts`; `verify-nutrition-routing.mjs`. Ordering: **absent** (Zomato/Swiggy = 2–3 refs, no path, audit §2G) | Task execution incl. food ordering (REPORTED, general pitch) | **DIFFERENTIATE** (nutrition, AskGogo-specific) / **IGNORE** (ordering, not built and provider-blocked) | B3 if ordering ever states prices |

### 3.2 Travel, ticketing and appointments

| Capability | AskGogo state (file:line) | Benchmark behaviour (tier) | Verdict + reason | Blocking |
|---|---|---|---|---|
| **Train** | **B** — `train-research.ts`, **fails closed** (`:170-174`); bridge hop G8 `whatsapp-bridge.ts:225` | Six trains + times in 3 min, **no visible source** (OBSERVED §O.9/§O.11); hit IRCTC/Akamai then device-handoff (OBSERVED §O.9) | **DIFFERENTIATE** — verified-or-refuse vs the benchmark's unattributed timetable; **the provenance test (§O.11) is the sharpest differentiator if it confirms model-knowledge** | B1 (a train-leg throw becomes a false denial); provenance UNRESOLVED |
| **Flight** | **B** — watcher only (`tryCreateFlightWatchFromCommand`, `watch-command.ts`); `airline-checkin.ts`; no booking/research specialist | Task-agnostic booking claim (REPORTED); high-demand ticket buy failed (REPORTED, teardown §6) | **ADAPT** — build flight research on the train fail-closed template before any booking claim | B3 (must not quote fares unverified); D2/D3 (flight watcher shares watcher drift) |
| **Hotel** | **B** — `creditiq-hotel-research.ts`, `creditiq-travel.ts`; `verify-creditiq-routing.mjs` (routing only) | Task-agnostic (REPORTED) | **ADAPT** — same fail-closed template; keep points-vs-cash as an AskGogo edge | B3 |
| **Bus** | **Absent** — no bus provider path in repo (not in audit §2G) | Task-agnostic (REPORTED) | **IGNORE** for v1 — no path, provider risk unknown; revisit post-launch | — |
| **Appointments** | **W** — `appointment-research.ts`, `-followup.ts`, `-auth-resume.ts`; `verify-appointment-autonomy.mts`, `-auth-resume.mts` | "Found an in-network podiatrist and completed the paperwork" (REPORTED, teardown §4) | **COPY** (the flow shape) — AskGogo already has research→prepare→auth-resume; borrow the outcome framing | B1 |
| **Cinema / events** | **B/W** — BookMyShow: `booking-queue.ts`, `booking-closure.ts`, `booking-screenshot-worker.ts`; `verify-booking-*.mts` | Task-agnostic (REPORTED); no cinema observation | **ADAPT** — keep the BMS-shaped pipeline; **BookMyShow/Cloudflare forces device handoff** (§1.5), so no end-to-end promise | B1; provider-block ceiling (R7) |
| **Shopping** | **B** — generic browser `tryRunBrowserCommand` (`browser-command.ts`, hop G11); Amazon = 7 refs, no shopping specialist | When locked out of a shop, **reset the user's password** to complete a purchase (REPORTED, teardown §6) | **DIFFERENTIATE** — AskGogo stops at the boundary; routing around access is the exact inverse choice and the wrong one for trust | **B1** (the 19 Sep amazon.in false denial was here); **B3** (shopping prices), **B4** |

### 3.3 Autonomous agent, watchers and life events

| Capability | AskGogo state (file:line) | Benchmark behaviour (tier) | Verdict + reason | Blocking |
|---|---|---|---|---|
| **Goals** | **W** — `goal-engine.ts`, `goal-worker.ts`, cron `*/15`; `verify-agent-goals.mts`. Creation: `whatsapp-bridge.ts:171` (WhatsApp, hop G2), `goals/route.ts:58` (web/mobile) | Multi-day task continuation on a persistent computer (REPORTED, teardown §3/§5) | **ADAPT** — AskGogo's goal engine is real and tested; align surfacing with the benchmark's continuity | **D1** — `status:'blocked'` throws on the `*/15` cron if prod matches the repo; **see Step 2 finding, §5** |
| **Watchers** | **W** — `watchers.ts` (401); `verify-agent-watchers.mts`, `verify-agent-web-watch.mts` | Surfaces life events proactively (REPORTED, teardown §4) | **ADAPT** — keep; wire proactive surfacing | **D2** (`web_search`/`goal_review` types rejected → every web/goal watcher fails to create), **D3** (cadence floor) |
| **Life Events** | **W** — `life-event-engine.ts`, `-worker.ts`, `-integration-worker.ts`; `verify-life-event-*.mts` | Not a named benchmark feature; the persistent-computer memory approximates it (INFERRED) | **DIFFERENTIATE** — a typed life-event state machine is an AskGogo strength; keep and make it visible | **D4** — `needs_attention` fails **silently** on the safety path that halts an uncertain check-in |
| **Booking changes** | **B** — `booking-change-worker.ts` (1-min cron) | Task-agnostic follow-up (REPORTED) | **ADAPT** — keep; ensure changes go through the approval gate | B1; D4 |
| **Cancellations** | **B/partial** — `booking-change-worker.ts:30` writes `→cancelled`; no dedicated cancel specialist | Task-agnostic (REPORTED); irreversible-action risk shown (email sent unapproved, teardown §9) | **ADAPT** — cancellation is irreversible → must require an approved `agent_approvals` row (policy.ts) | approvals gate must hold |
| **Refunds** | **Absent** — no refund path in repo | Task-agnostic (REPORTED) | **IGNORE** for v1 — money-out + irreversible; do not build without the payments authorisation layer | payments authz absent (audit §2K / teardown §7) |
| **Delivery tracking** | **Absent** — no dedicated path (a web watcher could approximate) | Proactive status surfacing (REPORTED) | **ADAPT** — implement as a `web_change` watcher once D2 is resolved | **D2** |

### 3.4 Trust, control plane and safety

| Capability | AskGogo state (file:line) | Benchmark behaviour (tier) | Verdict + reason | Blocking |
|---|---|---|---|---|
| **Gmail / Workspace** | OAuth **W** — `gmail/connect\|callback`; `verify-google-workspace-oauth.mts`. Read/draft/send **B** — `google-gmail.ts` (285), `email-actions.ts`. Drive **W** — `workspace-drive-context.ts` | Mailbox triage as **three things that matter**, catches a bounce, connector-on-demand when unconnected (OBSERVED §O.3/§O.4); agent email address + autonomous signup (REPORTED, teardown §8) | **COPY** (triage shape + connector-on-demand) / **DIFFERENTIATE** (agent email + autonomous signup = identity creation, §O.12) | send path untested (audit §2D); B1 for connector throws |
| **Trusted-person actions** | **B** — `friend-reminders.ts`, `friend-contacts.sql`; shared-memory grant `handlers/shared-memory.ts` | **Trusted Person Network** — agent-to-agent allow lists, framed as a moat; consent/revocation model undescribed (REPORTED/INFERRED, teardown §5) | **DIFFERENTIATE** — agent-to-agent messaging is a new injection surface (teardown §5); AskGogo's human-in-the-loop friend actions are the safer, defensible position | credential/injection boundary |
| **Browser handoff / takeover** | **W** — `provider-browser-handoff.ts`, `browser-handoff.ts`; `verify-browser-auth-gate.mts`. Cloud takeover **B** — port 3001 | Routes around blocks (password reset, REPORTED); device-handoff at IP walls (OBSERVED §O.9) | **ADAPT** — keep the two-branch split (§1.5); borrow only the graceful-stop wording, never the route-around | **B1** — the load-bearing bug: a browser throw becomes a false capability denial |
| **Approvals** | **W** — `policy.ts` (the safety keystone); `verify-agent-policy.mts`; one-shot `approvals/[id]/route.ts`; WhatsApp approve/reject **B**. **Every consequential executor is gated** (night report task 2) | Confirmations disclaimed as possibly-not-preventing unintended actions; an email was **sent unapproved** (REPORTED, teardown §9); Instinct *offered* to create an account in the user's name (OBSERVED §O.12), but the consent step it would use is **unobserved** — the approval model stays REPORTED/INFERRED | **DIFFERENTIATE** — a pure-function authorization boundary outside the model is AskGogo's single strongest asset; the benchmark has no structural equivalent described | keep the gate universal; strengthen consent for identity acts |
| **Activity feed** | **B** — `agent_activity` (append-only, `orchestrator.ts:52`); dashboard `agent/page.tsx` polls `/api/agent/snapshot` every 8s | **Meta Muse** — a control-plane surface where autonomous actions are reviewable/auditable in one feed (INFERRED, no source) | **ADAPT** — AskGogo has the audit trail; adopt Muse-style single reviewable feed as the dashboard's spine | **D5** (`agent_steps`/`agent_threads` undocumented → the feed's provenance is unreproducible) |

---

## 4. What the frozen model commits to (summary)

- **COPY:** quoted-reply threading, connector-on-demand, 👍 reactions, slot-filling with explicit
  "I still need N things", disambiguate-don't-guess, credential-boundary wording, Gmail triage shape,
  appointment flow framing.
- **ADAPT:** reminders (add proactivity), calendar summary shape, credential vault (dashboard only),
  flight/hotel research on the train fail-closed template, cinema/events (device-handoff ceiling),
  goals/watchers surfacing, booking changes, cancellations (approval-gated), delivery tracking (as a
  watcher), browser two-branch handoff, Muse-style activity feed.
- **DIFFERENTIATE:** verified-or-refuse for train/travel (vs unattributed timetables), structured
  auditable memory (vs persistent-VM memory), stop-at-the-boundary browsing (vs password-reset
  route-around), typed life-event state machine, human-in-the-loop trusted-person actions (vs
  agent-to-agent network), the pure-function approval boundary, and — the sharpest line —
  **identity/account creation requires DPDP-grade explicit, specific, revocable consent captured as a
  durable record, never a chat reply** (an AskGogo rule; the benchmark's own consent step is
  unobserved, §O.12).
- **IGNORE (benchmark):** lists/tasks, documents, receipts, meeting-notes surfaces (AskGogo ahead or
  no comparable observation); bus, refunds, food-ordering (not built and/or provider-blocked for v1).

Every COPY/ADAPT on a *task* capability is void until the **FAIL-CLOSED INVARIANT (§1.1)** is
generalised beyond the train path and **B1/B4** are fixed — otherwise a fixed capability still
degrades into a confident false answer.

---

## 5. Step 2 finding — is there a reachable `agent_goals` creation path?

**Yes.** `agent_goals` has zero rows in production, but a reachable creation path exists.

Every `.ts` write to `agent_goals` (excluding `node_modules/.next/dist`), classified:

| `file:line` | Operation | Reachable from the WhatsApp webhook? |
|---|---|---|
| `lib/agent/whatsapp-bridge.ts:171` | **INSERT** (`tryCreateGoal`, specialist hop **G2**) | **YES** — `tryRunWhatsAppAgent:204` ← `feature-intents.ts:352` ← webhook `route.ts:967`. Gated behind `parseGoal` (`whatsapp-bridge.ts:158-165`): the message must match `^goal\s*:\s*(.{8,})$` or `^(?:create\|set\|start)\s+(?:a\s+)?goal\s+(?:to\s+)?(.{8,})$` |
| `app/api/agent/goals/route.ts:58` | **INSERT** (POST) | **NO** — gated by `requireAgentMutationOrigin` + `requireAgentSession`; this is the web/mobile dashboard session, not the webhook |
| `lib/agent/whatsapp-bridge.ts:184` | UPDATE (`→blocked` on init failure) | (webhook, but not a create) |
| `app/api/agent/goals/route.ts:80` | UPDATE (`→blocked`) | no (web/mobile) |
| `app/api/agent/goals/[id]/route.ts:58` | read/update of an existing goal by id | no (web/mobile) |
| `app/api/agent/goals/[id]/resume/route.ts:18,36` | SELECT / UPDATE | no (web/mobile) |
| `lib/agent/goal-engine.ts:83,98` | UPDATE (plan/progress/status recompute) | indirect (called by the create paths and the `*/15` worker) |
| `lib/agent/goal-engine.ts:108`, `goal-worker.ts:21`, `snapshot/route.ts:48` | SELECT (read) | — |

**Plain conclusion: there IS a reachable creation path from WhatsApp** — `whatsapp-bridge.ts:171`,
behind the literal command shapes "goal: …" / "create a goal to …". The insert itself uses a *valid*
status (`'active'`), so D1 does not block the create; D1 bites only on the subsequent
`goal-engine.ts:83` recompute if a step is blocked. **Why zero rows** is therefore *not* a missing
path — it is one of: (a) no user has typed the narrow command shape, or (b) an upstream matcher
claims those messages before hop G2. Which of the two is a question for the open decisions, not a
finding this run can close from static code.

---

## 6. Open decisions — NOT decided here

Listed, with options and trade-offs. None is resolved by this frozen model.

### OD-1 — Dashboard information architecture: the 5-tab ceiling

At 375px (the locked minimum width; tab IA currently **Today / You**, per the dashboard shell work) a
bottom tab bar comfortably holds **five** destinations. The target model above adds three things that
each want a home: a Muse-style **Activity** feed (§3.4), a **Goals** surface (§3.3), and a documents/
assets **Library** (§3.1). That is more than the ceiling allows. The benchmark for a control plane is
**Meta Muse** (INFERRED — a single reviewable action feed as the product's spine).

| Option | Shape | Trade-off |
|---|---|---|
| **A — Activity as the spine** | Replace "Today" with an Activity feed that subsumes goals + agent actions; Goals and Library become filtered views inside it | Matches the Muse benchmark and stays within 5 tabs; risk: "Today" (the calm daily digest) loses its dedicated home and power-user surfaces get buried |
| **B — Five fixed tabs + overflow** | Today / Activity / Goals / Library / You, and push anything further behind a "More" sheet | Every first-class surface gets a tab; risk: hits the ceiling immediately, "More" becomes a junk drawer, and 5 tabs at 375px is cramped |
| **C — Contextual tab set** | 3–4 stable tabs (Today / Activity / You) with Goals/Library surfaced contextually (deep links from the feed, not a permanent tab) | Keeps the bar uncluttered and honours the "conclusion, not a list" ethos; risk: discoverability of Goals/Library drops, and contextual entry points are harder to test |

*Trade-off common to all: adding surfaces competes with the product's own bet that the assistant
lives in chat, not a dashboard. The dashboard is the control plane, not the primary surface.*

### OD-2 — The four schema drifts (most urgent; carried from NIGHT-REPORT NEEDS-DECISION 1)

Run the one `pg_constraint` query. If production allows D1/D2/D4 values, the repo migrations are stale
and should be corrected to match. If it does **not**, background goals (D1) and every web/goal watcher
(D2) are failing right now, and the D4 safety flag is failing silently. **This gates the reliability
of Goals, Watchers, Life Events and Delivery tracking above.** Not decidable from static code.

### OD-3 — Generalising the fail-closed invariant (§1.1)

Where does the single choke point live — a wrapper every specialist returns through, or a sanitizer
applied at `same-brain.ts:141` and the three `process-message.ts` sites? And is B4's refusal filter
completed in the same change or separately? Decision owner's call; both are code changes outside this
docs run.

### OD-4 — B1 (failure-to-decline conflation)

Adopt the train-research shape (return a `status:'failed'` result that keeps the turn) at
`feature-intents.ts:361` so a specialist crash stops being indistinguishable from a decline? This is
the load-bearing fix behind every browser/connector COPY/ADAPT verdict, but it changes bridge control
flow and needs its own test.

### OD-5 — Why `agent_goals` is empty despite a reachable path (from §5)

Is it (a) no user has typed "goal: …", or (b) an upstream matcher claims those messages before hop
G2? Settling this needs either a production log grep for `goal_created` activity vs inbound "goal"
messages, or a routing trace — neither available to a static docs run. Bears on whether Goals is
actually exercised in production.

### OD-6 — The provenance test (teardown §O.11), still UNRESOLVED

Ask Instinct directly where the 21 Sep train timings came from and whether it can show the source.
If model-knowledge-presented-as-availability, the Train DIFFERENTIATE verdict (§3.2) hardens into
AskGogo's headline claim. Until tested, **no conclusion is recorded** — this is an evidence task, not
a decision.

### OD-7 — Carried operational decisions (NIGHT-REPORT)

`WEBHOOK_SIGNATURE_ENFORCE` flip (after reading `WEBHOOK_SIGNATURE_AUDIT` logs); applying the RLS
owner-policy migration and whether to extend it to the 14 non-agent tables; and making `npm test`
runnable from a clean clone (`.env.test.example` vs extending the dummy-env guard). All three are
documented in the night report and left to the decision owner.

---

*Frozen v1 — 19 Sep 2026. Re-open only on new OBSERVED evidence or a resolved schema question.*
