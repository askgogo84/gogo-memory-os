# 01 — AskGogo capability audit

**Date:** 18 September 2026
**Repo:** `askgogo84/gogo-memory-os`
**Audited commit:** `0007897` (branch `main` at time of audit)
**Audit branch:** `claude/askgogo-capability-audit-lomml5`
**Method:** static read of the repository only — no deployment, no database, no live traffic.

---

## 0. How to read this

Every capability below is placed in one of three evidence tiers. The tier describes the
*strength of the evidence found in this repository*, not how good the feature is.

| Tier | Means | Test to qualify |
|---|---|---|
| **W — Wired** | Reachable from a real user surface, persists to a real store, and has an automated check in `npm test` | Route/handler exists → writes or reads a table → a `scripts/verify-*` or `*.test.mjs` asserts its behaviour |
| **B — Built** | Code exists and is reachable, but nothing in the repo proves it behaves correctly | Route/handler exists, no automated check, or the check only asserts source text |
| **C — Claimed** | Asserted in a planning doc or checklist, with no corresponding code path in this repo | Named in `AUTONOMOUS-LAUNCH-MASTER.md` or a docs file; no implementation found |

A **W** is not a claim that the feature works in production against live providers — no test in
this repo touches Supabase, Twilio, Google, Razorpay, or the sandbox browser (see §3). **W** means
the *logic* is pinned by a test; the *integration* is pinned by nothing but production usage.

---

## 1. What the system is

A single Next.js 16 application (App Router, React 19, TypeScript) deployed on Vercel in `bom1`
(Mumbai), backed by one Supabase Postgres project. It is a personal AI assistant for India whose
primary surface is WhatsApp, with a secondary web dashboard.

| Dimension | Measurement |
|---|---|
| TypeScript in `lib/` + `app/` + `components/` | ~55,200 lines |
| API routes | 99 |
| Web pages | 20 |
| Agent modules (`lib/agent/`) | 64 files |
| Conversation handlers (`lib/bot/handlers/`) | 45 files |
| Domain services (`lib/services/`) | 35 files |
| SQL migrations (`sql/` + `supabase/`) | 44 files |
| Verification scripts (`scripts/verify-*`) | 62 (58 wired into `npm test`) |
| Scheduled crons (`vercel.json`) | 10, cadences from 1 min to daily |
| Distinct env vars referenced in code | ~70 |

**Model providers:** Anthropic (`@anthropic-ai/sdk`) and OpenAI (`openai`) both in the hot path;
AssemblyAI and OpenAI Whisper for speech; `text-embedding-3-small` for memory retrieval.

**Entry points:**
- `app/api/webhooks/whatsapp/route.ts` (1,280 lines) — the primary surface, Twilio WhatsApp
- `app/api/webhooks/telegram/route.ts` — a second full channel through the same brain
- `app/api/dashboard/chat/route.ts` and `app/api/agent/run/route.ts` — web
- `app/api/mobile/*` — account-link and session endpoints for a native app that **does not live in
  this repo**
- 10 cron routes — the autonomous half of the product

**The routing spine:** `lib/bot/process-message.ts` (1,244 lines, 42 imported handler modules) is
the deterministic router. `lib/feature-intents.ts` layers agent handling *only when legacy
deterministic routing declines the turn* — the legacy path in `lib/feature-intents-legacy.ts` is
preserved byte-for-byte by design. This ordering is the single most important architectural fact
about the product: **the LLM is a fallback, not the front door.**

---

## 2. Capability inventory

### A. Conversation, routing and input handling

| Capability | Tier | Evidence |
|---|---|---|
| Deterministic intent routing (32 intent types) | **W** | `lib/bot/detect-intent.ts`; `scripts/verify-generic-user-intents.mts`, `verify-input-resilience.mts` |
| Legacy-first routing with agent fallback | **W** | `lib/feature-intents.ts` → `feature-intents-legacy.ts`; `verify-full-feature-legacy-bridge.mts` |
| List vs task vs reminder disambiguation | **W** | `lib/data/lists-core.ts`; `verify-list-routing.mjs`, `verify-list-check-verb.mts`, `verify-list-conversation-context.mts` |
| Calendar-vs-reminder precedence | **W** | `verify-calendar-routing.mts` (models the real dispatch in `process-message.ts`) |
| Conversational follow-up state (30-min freshness) | **W** | `lib/bot/handlers/followup-state.ts`; `verify-pending-followup.mts` |
| AM/PM ambiguity clarification | **W** | `lib/bot/handlers/reminder-ampm-followup.ts`; `verify-voice-reminder-meridiem.mts` |
| Input normalisation (typos, voice artefacts) | **W** | `lib/bot/input-normalizer.ts`; `verify-input-resilience.mts` |
| Telegram channel (full parity path) | **B** | `app/api/webhooks/telegram/route.ts` → same `processIncomingMessage`; no channel-level test |

**Note on the six "shallow-matcher hijacks".** `docs/askgogo-handover-2026-09-18.md` records that
`verify-list-check-verb.mts` covers *six past instances* of one bug class: a broad regex claiming a
message meant for another handler. This is the dominant failure mode of a 45-handler deterministic
router, and the team has been treating it as such. That is a maturity signal, and also a standing
risk (§5, R6).

### B. Memory

| Capability | Tier | Evidence |
|---|---|---|
| Durable memory store + save/forget commands | **B** | `lib/bot/handlers/memory-control.ts` (429 lines), `sql/shared-memory.sql` |
| Semantic retrieval (pgvector, `match_memories` RPC) | **B** | `lib/services/memory-index.ts`, `lib/services/embeddings.ts`, `sql/memory-embeddings.sql` |
| Embedding backfill | **B** | `app/api/admin/backfill-embeddings/route.ts` |
| Secret-shaped memory redaction | **W** | `lib/bot/memory-redaction.ts`; `verify-memory-redaction.mts` |
| Memory Twin (behaviour log → profile → insights → proactive suggestions) | **B** | `lib/bot/memory-twin/` (6 modules), `supabase/memory-twin-*.sql` (5 migrations) |
| Preference rules injected into the prompt | **B** | `lib/bot/handlers/preferences.ts`, `sql/user-preferences.sql` |
| Shared memory (topic buckets, grant to a contact) | **B** | `lib/bot/handlers/shared-memory.ts` |
| Throwback / resurfacing | **B** | `lib/bot/handlers/throwback.ts`, `sql/throwback.sql` |
| Memory consent gate | **B** | `ensureMemoryConsent`/`isMemoryEnabled` in `memory-twin/behavior-logger.ts` |
| Dashboard memory presentation | **W** | `lib/dashboard/memory.ts`; `verify-dashboard-memory-presentation.mts` |

Memory is the product's name and its **weakest-verified** layer: nine of eleven capabilities are
tier B. Only redaction and presentation are pinned by tests. There is no test that a memory written
on WhatsApp is retrievable on web, which is the load-bearing claim of "Memory OS".

### C. Reminders, lists, tasks, calendar

| Capability | Tier | Evidence |
|---|---|---|
| Natural-language reminders incl. recurring | **W** | `lib/bot/handlers/reminders.ts` (611 lines); `verify-interval-cadence.mts`, `verify-reminder-dedup.mts` |
| Reminder editing and snooze | **B** | `lib/bot/handlers/edit-reminder.ts` (637 lines), snooze in `feature-intents.ts` |
| Minute-cadence reminder delivery | **B** | `app/api/cron/reminders/route.ts`, `* * * * *`, `CRON_SECRET`-guarded |
| Insert idempotency | **B** | `supabase/reminder-insert-idempotency-20260915.sql` |
| Friend-to-friend reminders | **B** | `lib/bot/handlers/friend-reminders.ts`, `sql/friend-contacts.sql` — delivery to cold numbers gated on a Twilio template (`docs/BUILD_STATUS.md`) |
| Reminder opt-out / STOP | **B** | `lib/bot/handlers/reminder-optout.ts`, `supabase/reminder-optout-v1.sql` |
| Lists (add/check/uncheck/clear/show) | **W** | `lib/data/lists-core.ts` + `lists.ts`; `lists-core.test.mjs`, `verify-list-*.mts` |
| Tasks / todos | **B** | `app/api/todos/route.ts`, `lib/dashboard/tasks.ts`; `verify-dashboard-tasks-source.mts` covers the dashboard read path only |
| Google Calendar connect (OAuth) | **B** | `app/api/calendar/connect|callback/route.ts`, `CALENDAR_OAUTH_STATE_SECRET` |
| Calendar create / view / conflict move | **W** | `lib/bot/handlers/calendar-actions.ts` (750 lines); `verify-calendar-routing.mts`, `verify-cancel-matcher.mts` |
| Calendar mutations with confirmation | **B** | `lib/bot/handlers/calendar-mutations.ts` |
| Plan-my-day | **B** | `lib/bot/handlers/plan-my-day.ts` |
| Timezone resolution | **B** | `lib/timezone.ts` (247 lines), `supabase/timezone-v1.sql`; `lib/dashboard/wall-time.test.mjs` covers dashboard wall-time only |

### D. Google Workspace

| Capability | Tier | Evidence |
|---|---|---|
| OAuth connect for Gmail + Workspace | **W** | `app/api/gmail/connect|callback`; `verify-google-workspace-oauth.mts` |
| Gmail read / search | **B** | `lib/services/google-gmail.ts` (285 lines), `lib/agent/google-workspace-read.ts` (346 lines) |
| Gmail draft | **B** | `lib/bot/handlers/email-actions.ts` |
| Gmail send with approval | **B** | policy gate exists (`policy.ts` → `email: 'draft'` default); no send-path test |
| Drive contextual retrieval | **W** | `lib/agent/workspace-drive-context.ts`; `verify-workspace-drive-context.mts` |
| Drive binary fetch | **B** | `lib/agent/google-workspace-drive-binary.ts` |
| Meeting preparation + approval | **W** | `lib/agent/workspace-meeting-approval.ts` (276 lines); `verify-workspace-meeting-approval.mts` |
| Ticket credential extraction from Gmail | **B** | `lib/agent/gmail-ticket-credential.ts`; CI workflow `gmail-boarding-pass-v4.yml` |
| Contacts resolution | **B** | `app/api/contacts/route.ts` |

`AUTONOMOUS-LAUNCH-MASTER.md` flags production OAuth scope verification as launch blocker #3. That
blocker is real and cannot be closed from inside this repo.

### E. Autonomous agent core

| Capability | Tier | Evidence |
|---|---|---|
| Deterministic permission/approval policy gate | **W** | `lib/agent/policy.ts`; `verify-agent-policy.mts` — **the safety keystone**, see below |
| Per-capability permissions (11 capabilities × 5 levels) | **W** | `policy.ts`, `app/api/agent/permissions/route.ts` |
| Run orchestration + activity audit trail | **B** | `lib/agent/orchestrator.ts`, writes every event to `agent_activity` |
| Approval records with one-shot semantics | **B** | `app/api/agent/approvals/[id]/route.ts` — conditional update on `status='pending'`, run transitions `waiting_approval`→`queued` |
| Background execution queue with optimistic lock | **W** | `app/api/cron/autonomous-runs/route.ts`, `lib/agent/autonomous-runtime.ts`; `verify-autonomous-runtime.mts` (dependency-ready parallel scheduling, leases, idempotency keys) |
| Stale-run sweep (requeue once, then fail) | **B** | `autonomous-runs` route; described in `docs/askgogo-handover-2026-09-18.md` |
| Goals (capture, decompose, background worker) | **W** | `lib/agent/goal-engine.ts`, `goal-worker.ts`, cron `*/15`; `verify-agent-goals.mts` |
| Compound multi-step planning | **W** | `lib/agent/compound-planner.ts`, `general-planner.ts` (441 lines); `verify-agent-compound.mts`, `verify-agent-general-plan.mts`, `verify-persistent-general-plan.mts` |
| Specialist routing (travel/ticketing/shopping/life-events/payments/research) | **W** | `lib/agent/specialist-registry.ts`, `specialist-routing.ts`; `verify-autonomous-runtime.mts` |
| Sentinel (stalled / looping / contradictory runs) | **W** | `lib/agent/sentinel.ts`; `verify-agent-sentinel.mts` |
| Same-brain context carryover | **W** | `lib/agent/same-brain.ts`; `verify-agent-same-brain.mts` |
| Learning from accepted/rejected outcomes | **W** | `lib/agent/learning-worker.ts`, cron `17 * * * *`; `verify-agent-learning.mts` |
| Cost guard | **W** | `lib/services/cost-guard.ts`, `supabase/gogo-cost-guard-v1.sql`; `verify-cost-guard.mts` |
| WhatsApp→agent bridge with 42s budget | **W** | `lib/agent/whatsapp-bridge.ts`; `verify-agent-whatsapp-bridge.mts` |
| Approve/reject over WhatsApp text | **B** | `approvalIntent()` in `whatsapp-bridge.ts` — exact-phrase match on `approve`/`reject` |
| Watchers: deadline + web-search | **W** | `lib/agent/watchers.ts` (401 lines); `verify-agent-watchers.mts`, `verify-agent-web-watch.mts` |
| Watcher cost policy + quality filter | **B** | `lib/agent/watch-cost-policy.ts`, `watcher-quality.ts` |
| Flight watcher | **B** | `tryCreateFlightWatchFromCommand` in `watch-command.ts` |
| Push notifications (Expo) | **B** | `lib/agent/push.ts` → `exp.host` — targets the native app that is not in this repo |
| Agent dashboard (runs/approvals/goals/watchers/artifacts/permissions) | **B** | `app/dashboard/(app)/agent/page.tsx` (194 lines), polls `/api/agent/snapshot` every 8s |

**On `lib/agent/policy.ts`.** This is the best-engineered file in the repository and the audit's
single strongest finding. It is a pure function — no I/O, no model call — that decides whether any
agent action may proceed. Its invariants: reads need `read`+, drafts need `draft`+, every
irreversible action requires an `approved` approval record, and `email`/`calendar`/`browser`/
`travel`/`payments` **cannot auto-execute** a medium- or high-risk action even when the user has set
`auto`. The comment in the source states the principle exactly: *"The LLM never decides whether its
own action is authorized."* It is unit-tested against a table of cases. Any comparison against a
competitor should start here — most agent products do not have this boundary at all.

The gap: the *gate* is tested, but nothing tests that **every executor actually calls the gate**.
There is no test that enumerates the executors and asserts each one passes through
`evaluateAgentExecutionPolicy`. That is the highest-value test this codebase is missing.

### F. Secure browser / computer use

| Capability | Tier | Evidence |
|---|---|---|
| Per-user isolated browser (Vercel Sandbox + Playwright/Chromium) | **W** | `lib/agent/secure-computer.ts`, `secure-browser-bootstrap.ts`; `verify-agent-secure-browser.mts` |
| Navigate / read / extract structured data | **B** | `secure-computer.ts`, 45s read-mode navigation timeout |
| Provider access-block detection → device handoff | **W** | `lib/agent/provider-browser-handoff.ts`, `browser-handoff.ts`; `verify-browser-auth-gate.mts` |
| Human-auth gate → cloud takeover (live screenshot browser, port 3001) | **B** | `browser-handoff.ts` — self-hosted control UI, verified live twice per the 18 Sep handover, no test |
| Draft-fill without submitting / negation handling | **W** | `verify-browser-negation-draft.mts` |
| Booking context isolation | **W** | `verify-booking-context-isolation.mts` |
| Approval-gated submit | **B** | `executeApprovedBrowserCommand` in `browser-command.ts` |
| Terminal evidence required before declaring completion | **B** | `lib/agent/life-event-execution.ts` + `scripts/verify-checkin-terminal-evidence.mts` — **test exists but is not in `npm test`**; only a path-filtered CI workflow runs it |

The 18 Sep handover documents the structural limit honestly: **the cloud takeover browser runs
inside the same sandbox, so a human driving it is still on a datacenter IP.** Takeover solves
human-presence walls (CAPTCHA, login, OTP, payment auth); it does *not* solve IP reputation blocks
(IRCTC/Akamai). Hence the split: `provider_access_limited` → hand the user a link for their own
browser; `human_auth_required` → cloud takeover. This distinction is correct and is the kind of
thing competitors usually discover in public.

### G. Life events, travel and bookings

| Capability | Tier | Evidence |
|---|---|---|
| Life-event engine + worker (5-min cron) | **W** | `lib/agent/life-event-engine.ts`, `life-event-worker.ts`; `verify-life-event-engine.mts`, `verify-life-event-worker.mts` |
| Life-event integrations worker | **W** | `life-event-integration-worker.ts`; `verify-life-event-integrations.mts` |
| BookMyShow link → booking → credential → reminder | **B/W** | `booking-queue.ts`, `booking-closure.ts`, `booking-screenshot-worker.ts`; `verify-booking-link-intent.mts`, `verify-booking-closure.mts`, `verify-whatsapp-preview-routing.mts` |
| Ticket screenshot extraction (GPT-4o vision, refuses to invent) | **B** | `booking-screenshot-worker.ts` — prompt explicitly forbids inventing seats/IDs/amounts |
| Booking-change and closure workers (1-min cron) | **B** | `booking-change-worker.ts`, `booking-closure-worker.ts` |
| Travel research artifact | **W** | `lib/agent/travel-research.ts`, `travel-research-sanitize.ts`; `verify-agent-travel-research.mts` |
| Train research, fails closed on provider failure | **B** | `lib/agent/train-research.ts` — per handover, replaced a path that was inventing train numbers |
| Travel → calendar plan with approval | **W** | `lib/agent/travel-calendar-plan.ts`; `verify-agent-travel-calendar.mts` |
| Appointment research → prepare → auth resume | **W** | `appointment-research.ts`, `appointment-followup.ts`, `appointment-auth-resume.ts`; `verify-appointment-autonomy.mts`, `verify-appointment-auth-resume.mts` |
| Airline check-in | **B** | `lib/services/airline-checkin.ts` |
| Travel ticket store + life-event bridge | **B** | `lib/services/travel-tickets.ts` (430 lines), `sql/travel-tickets.sql` |
| CreditIQ travel / points-vs-cash | **B** | `lib/integrations/creditiq-travel.ts`, `lib/agent/creditiq-hotel-research.ts`; `verify-creditiq-routing.mjs` covers routing only |

**Provider coverage is narrow and honest about it.** Grepping the whole codebase for provider names
yields: BookMyShow (31 references), IRCTC (10), District (8), Amazon (7), IndiGo (4), Zomato (3),
Uber (3), Swiggy (2). The life-event pipeline is effectively **BookMyShow-shaped** today, with
generic flight/train/hotel ingestion still unticked in the launch master. Any external claim of
"books anything" is not supported by this repo.

### H. Voice, image and documents

| Capability | Tier | Evidence |
|---|---|---|
| Voice transcription (Whisper + AssemblyAI) | **B** | `lib/whisper.ts`, `lib/services/voice-transcription.ts`, `assemblyai` dep |
| Voice reminder normalisation (meridiem) | **W** | `lib/bot/handlers/voice-normalizer.ts`; `verify-voice-reminder-meridiem.mts` |
| Meeting transcription + notes + search | **B** | `lib/services/meeting-transcription.ts`, `meeting-search.ts`, `speaker-profiles.ts` |
| Image note reading / classification | **B** | `lib/services/image-note-reader.ts`, `face-crop.ts` |
| PDF reading | **B** | `lib/services/pdf-reader.ts` (376 lines) |
| Document store + links | **B** | `lib/services/document-store.ts`, `document-links.ts`, `sql/document-links.sql` |
| Asset memory (natural retrieval of stored assets) | **B** | `lib/services/asset-memory.ts` (987 lines), `asset-natural-retrieval.ts`, `sql/asset-memory.sql` |
| Media memory (reels/posts) | **B** | `lib/services/media-memory.ts`, `reel-saver.ts` |
| Translation | **B** | `lib/services/translator.ts` |
| Lesson audio / presenter video | **W** | `app/api/dashboard/lesson-audio`, `master-gogo-presenter`; `verify-product-readiness.mjs` |

Multi-language (Hindi/Kannada/Tamil/Telugu) is **C — Claimed**: `AUTONOMOUS-LAUNCH-MASTER.md` P1
lists all four, and a translator service exists, but no language-specific routing, prompt or test
was found.

### I. Vertical features

| Capability | Tier | Evidence |
|---|---|---|
| Nutrition logging + daily/weekly/report cards | **W** | `lib/bot/handlers/nutrition.ts`, `bot/services/nutrition-*`; `verify-nutrition-routing.mjs` |
| Skin check (analyse, compare, report card) | **B** | `bot/services/skin-check-*.ts` (1,081-line report card), `supabase/skin-check-v1.sql` |
| Split bill / expense splitting + debt simplification | **B** | `lib/splitwise/` (5 modules, 442-line service), `supabase/splitwise-v1.sql`, `split-receipts-v1.sql` |
| Expense analysis + storage | **B** | `bot/services/expense-analyzer.ts`, `expense-storage.ts`, `supabase/expenses-v2.sql` |
| Weather, gold price, sports fixtures/standings | **W** | `lib/bot/handlers/deterministic.ts`, `sports.ts`, `standings.ts`; `verify-weather-routing.mts` |
| Web search + direct answers | **B** | `lib/web-search.ts` (Tavily), `handlers/web-answer.ts` |
| Morning briefing / daily brief | **B** | `handlers/morning-briefing.ts`, cron `daily-briefings` (15-min); `/api/cron/briefing` exists but is not scheduled in `vercel.json` |
| Referral programme | **B** | `handlers/referral-unlock.ts` (242 lines), `app/api/referral` |
| Pitch deck generation | **B** | `lib/pitch/deck-v3.ts`, `pptx-v3.ts`, `app/pitch/*` |

### J. Surfaces

| Surface | Tier | Evidence |
|---|---|---|
| WhatsApp (Twilio) | **W** | Primary surface; dozens of routing tests |
| Telegram | **B** | Full webhook → same brain; `BUILD_STATUS.md` parks it as "do last" |
| Web dashboard (14 pages: today, memory, calendar, lists, tasks, agent, chat, learn, personalize, usage, you) | **B/W** | `app/dashboard/(app)/`; `verify-dashboard-day-chat.mts`, `-memory-presentation`, `-tasks-source`, `-design-refresh` |
| Dashboard auth: WhatsApp OTP + Google login + redeem code | **B** | `lib/dashboard/session.ts`, `whatsapp-otp.ts`, `google-login.ts`, `supabase/dashboard-redeem-code-v1.sql` |
| Email (Resend): daily brief, lifecycle, unsubscribe | **B** | `lib/email/` (5 modules, 421-line lifecycle), cron `lifecycle-emails` |
| Mobile account link + session exchange | **B** | `app/api/mobile/*`, `lib/mobile-auth/`, `supabase/mobile-whatsapp-link-v1.sql`, `mobile-link-rpc-hardening.sql` |
| **Native mobile app** | **C** | **Not in this repo.** `AUTONOMOUS-LAUNCH-MASTER.md` records `mobile/native-app-v1` as 166 commits ahead / 209 behind `main` and names reconciliation as launch blocker #1. The server side (link, session, push, agent API) is built; the client is not here. |
| Admin console | **B** | `app/admin/`, `app/api/admin/*`, `ADMIN_DASHBOARD_TOKEN`, `ADMIN_WHATSAPP_NUMBERS` |

### K. Commerce

| Capability | Tier | Evidence |
|---|---|---|
| Canonical 4-tier India pricing (Free / ₹249 / ₹499 / ₹999) | **W** | `lib/pricing/gogo-plans.ts`; `verify-product-readiness.mjs` asserts every surface sells the same catalogue |
| Razorpay subscriptions + 7-day trial | **B** | `lib/services/razorpay-subscriptions.ts`, `app/api/subscription/create` |
| Razorpay one-time links + webhook | **B** | `lib/services/razorpay.ts`, `app/api/payments/webhook`, `RAZORPAY_WEBHOOK_SECRET` |
| Usage meter (fail-closed allowance, idempotent per message) | **W** | `lib/services/meter-core.ts` + `meter.test.mjs` (342 lines) — pure, dependency-injected, offline-testable |
| Per-plan limits from a DB table, never hardcoded | **W** | `meter-core.ts` invariant; `plan_limits` table |
| Watcher caps per plan | **B** | `activeWebWatchersMax` in `gogo-plans.ts` (0/1/3/6) |
| Unit economics tracked in the catalogue | — | `cogsBudgetInr` + `targetHeavyUserMarginPercent: 30` per tier — a deliberate, unusual discipline worth noting |

`meter-core.ts` is the second-best-engineered file here, for the same reason as `policy.ts`: all
logic, zero I/O, fully testable. Its stated invariants — *checkAllowance fails closed*,
*recordUsage never throws upward*, *one unit per inbound message per counter* — are the right three.

### L. Operations

| Capability | Tier | Evidence |
|---|---|---|
| 10 scheduled crons, all `CRON_SECRET`-guarded | **B** | `vercel.json`, e.g. `app/api/cron/reminders/route.ts:37-39` |
| Agent activity audit trail | **B** | `agent_activity` writes throughout `orchestrator.ts` |
| Admin analytics / growth / stats | **B** | `app/api/admin/*`, `lib/bot/handlers/admin-analytics.ts` (441 lines) |
| Structured error logging (`SCREAMING_SNAKE:` prefixes) | **B** | Consistent convention across the codebase |
| Build-gated regression suite | **B** | `package.json` `prebuild: npm test` — 58 scripts run before every Vercel build |
| Trace ID per run / dead-letter queue / alerting / latency SLOs | **C** | All unticked in the launch master; no implementation found |

---

## 3. Verification posture

`npm test` runs 58 checks. Their composition matters more than their count.

**What they are:**
- **Pure-function unit tests** — `policy.ts`, `meter-core.ts`, `lists-core.ts`, `autonomous-runtime.ts`
  scheduling. These are genuine tests and they are good.
- **Router precedence tests** — the largest group. They import the *real shipped* gate functions and
  model the real dispatch order (see the header comment of `verify-calendar-routing.mts`, which
  explains precisely why it mirrors `process-message.ts` line ordering). This is a deliberate
  anti-drift technique and it works.
- **Source-text assertions** — `verify-product-readiness.mjs` regexes page source for prices and
  route names; `verify-appointment-autonomy.mts` and `verify-autonomous-runtime.mts` both `import fs`
  and grep source. These catch regressions in *what the code says*, not what it does. Commit
  `4473c39` in the handover log is an example of the cost: a source-grep assertion pinned an old
  timeout ternary and had to be updated when the timeout changed.

**What no test in this repo does:**
- Touch Supabase (every module that talks to the DB is untested end-to-end; `verify-calendar-routing.mts`
  sets dummy Supabase env vars specifically to avoid a live client)
- Touch Twilio, Google OAuth, Razorpay, Tavily, Expo push, or the Vercel Sandbox
- Exercise a webhook request end-to-end
- Assert cross-surface identity (the "same brain" claim's actual load-bearing property)
- Assert that every agent executor routes through the policy gate

**CI gaps:**
- `.github/workflows/` contains **two** workflows, both narrowly path-filtered
  (`checkin-terminal-evidence.yml`, `gmail-boarding-pass-v4.yml`). **No workflow runs `npm test` on a
  pull request to `main`.** The suite gates deploys only through `prebuild`.
- Four verification scripts exist but are **not** in `npm test`:
  `verify-checkin-terminal-evidence.mts`, `verify-life-event-email-worker.mts`,
  `verify-mission-list-targeting.mts`, `verify-reminder-list-p0.mts`. One is covered by a
  path-filtered workflow; three run only if someone remembers.

---

## 4. Claimed vs shipped

`AUTONOMOUS-LAUNCH-MASTER.md` is a ~200-item checklist. Reading it against the code produces a
result worth stating plainly: **the checklist significantly understates what is built.**

Examples of items unticked in the master that have working, tested implementations:

| Unticked item | Actually found |
|---|---|
| "Per-capability Read/Draft/Execute-with-approval permissions" | `policy.ts`, tested |
| "Cost guard / rate guard / runaway loop guard" | `cost-guard.ts` + `sentinel.ts`, both tested |
| "Sentinel to detect stalled, looping or contradictory runs" | `sentinel.ts`, tested |
| "Same-brain context carryover between runs" | `same-brain.ts`, tested |
| "Learning from accepted/rejected suggestions" | `learning-worker.ts` + hourly cron, tested |
| "Goal capture / decomposition / background continuation" | `goal-engine.ts` + `goal-worker.ts` + cron, tested |
| "Retry with idempotency and leases" | `autonomous-runtime.ts`, tested |
| "Drive contextual retrieval where approved" | `workspace-drive-context.ts`, tested |
| "Deadline approaching / web-page change watchers" | `watchers.ts`, tested |

Items genuinely absent, matching their unticked state:

- Native mobile app client (blocker #1 — branch not in this repo)
- Generic flight/train/hotel/event ingestion beyond BookMyShow-shaped flows
- Indian language support (Hindi/Kannada/Tamil/Telugu)
- Observability: trace IDs, dead-letter queue, alerting, latency SLOs, provider dashboards
- Account deletion and export-my-data flows (also a store-submission requirement)
- Privacy policy / Terms (not in this repo)
- The full autonomous acceptance matrix with failure injection

**Recommendation:** re-baseline `AUTONOMOUS-LAUNCH-MASTER.md` against this audit before using it to
plan. Planning against a checklist that under-reports completion by this margin causes rebuilding.

---

## 5. Risk register

| # | Risk | Severity | Evidence | Fix shape |
|---|---|---|---|---|
| **R1** | **The inbound WhatsApp webhook does not verify the Twilio signature.** `app/api/webhooks/whatsapp/route.ts` has no `validateRequest` / `x-twilio-signature` check, and there is no `middleware.ts`. The sibling `webhooks/twilio-status/route.ts:19-35` *does* validate correctly — so the capability is present and simply not applied to the main surface. Anyone who learns the URL can post a form body impersonating any phone number, which resolves a user, reads their memory, spends model tokens, and can enqueue agent runs. | **High** | `grep -rn "validateRequest" app lib` → only `twilio-status` | Apply the same `twilio.validateRequest` guard to the POST handler |
| **R2** | All authorization is app-layer. RLS is `enable`d on the agent tables (`supabase/agent-os-v1.sql`) but **no policies are defined**, and every server module uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS entirely. Only 10 of 44 migration files mention RLS at all. A single missing `.eq('telegram_id', …)` in any of 99 routes is a cross-tenant read. | **High** | `grep -rli "row level security" sql supabase` → 10/44 | Audit every query for a tenant predicate; add policies + a non-service-role path for user-scoped reads |
| **R3** | No integration test touches any external dependency (Supabase, Twilio, Google, Razorpay, sandbox). Six external systems are load-bearing and unverified outside production. | **High** | §3 | A small smoke suite against a staging project, run on a schedule |
| **R4** | `npm test` gates deploys via `prebuild` but **nothing gates a pull request**. Two CI workflows exist, both path-filtered to single files. | **Medium** | `.github/workflows/` | One workflow: `npm ci && npm test` on PRs to `main` |
| **R5** | Nothing asserts that agent executors call the policy gate. The gate is excellent and tested; its *universal application* is unproven. | **Medium** | §2E | A test that enumerates executors and asserts each calls `evaluateAgentExecutionPolicy` |
| **R6** | Shallow-matcher hijacks in a 45-handler deterministic router — six instances already fixed and documented as a class. Structural to the architecture, not a one-off. | **Medium** | `verify-list-check-verb.mts`, 18 Sep handover | Keep the pattern: every hijack gets a permanent case in the verify suite |
| **R7** | Provider fragility is structural: IRCTC blocks datacenter IPs at the CDN, and the cloud takeover browser shares that IP. Correctly handled today by splitting device handoff from cloud takeover, but it caps what "autonomous booking" can mean for IP-blocked providers. | **Medium** | 18 Sep handover §4 | Accept and communicate the limit; do not promise end-to-end booking on blocked providers |
| **R8** | Four verification scripts are orphaned from `npm test`, including the one guarding the "terminal evidence before declaring check-in complete" safety rule. | **Medium** | §3 | Add all four to the suite |
| **R9** | ~70 environment variables, **no `.env.example`** and no documented required-vs-optional split. Onboarding a second engineer, or rebuilding the environment, is currently tribal knowledge. | **Medium** | `ls -a \| grep -i env` → nothing | Commit an `.env.example` with every key, grouped, secrets elided |
| **R10** | Repo hygiene: 37 one-off `fix_*.py` / `patch-*.cjs` / `fix-*.cjs` scripts at the repository root, plus a committed `askgogo-payments.zip` (328 KB) and `tmp_gmail_fetch.txt`. These were single-use codemods; leaving them at root obscures the real surface and risks someone re-running one. | **Low** | `ls *.cjs *.py *.js \| wc -l` → 37 | Delete or move to `scripts/archive/` |
| **R11** | Git history is shallow in this checkout (`.git/shallow`, 51 commits, all dated September 2026). Archaeology beyond that window is unavailable to a cloud session — relevant to any future audit run this way. | **Info** | `ls .git/shallow` | Fetch with `--unshallow` when history matters |
| **R12** | `app/api/debug/*`, `app/api/dev/*`, `app/api/test*` — 12 routes. All 12 carry a guard (`NODE_ENV`/`VERCEL_ENV`/`CRON_SECRET`), which is good; but the surface is broad and one regression in one guard is an exposure. | **Low** | Per-file grep, §Appendix | Consolidate behind a single helper, or strip from production builds |

---

## 6. Honest capability statement

What can be said externally, by evidence strength:

**Defensible without qualification.** A WhatsApp-native assistant for India with deterministic
routing across 32 intents; reminders, lists, tasks and Google Calendar; usage metering with
fail-closed allowances and four-tier INR pricing; a permission-and-approval model that structurally
prevents an LLM from authorizing its own consequential actions; an isolated per-user cloud browser
that reads real provider sites, and hands control to the human when it hits a wall it must not
fake past.

**Defensible with a named scope.** Autonomous background missions (goals, compound plans, watchers,
learning) — real, tested at the logic layer, running on 10 crons. Life-event handling — real, but
BookMyShow-shaped. Travel research and appointment booking — real, with the provider-block caveat.
Google Workspace — real, pending production scope verification.

**Not yet defensible.** "Works on mobile" (the client is not in this repo). "Speaks Indian
languages" (translator only; no language routing). "Books anything" (provider coverage is narrow).
"Cross-surface memory" (built, but nothing verifies it). Any reliability or uptime claim (no
observability layer).

---

## 7. Frame for the competitor teardown (Run 2)

For the Instinct teardown to be comparable to this audit rather than a feature-list contest, hold
these axes constant. Each is a place where this codebase has a specific, documented answer:

1. **Who authorizes a consequential action?** AskGogo: a pure function outside the model
   (`policy.ts`), with irreversible actions requiring a one-shot approval record.
2. **Is the LLM the front door or the fallback?** AskGogo: fallback — deterministic routing runs
   first and the legacy path is preserved byte-for-byte.
3. **What happens when a provider blocks the agent?** AskGogo: detect, classify
   (IP-block vs human-presence), hand off to the right browser, never fabricate.
4. **What happens when the agent cannot verify an outcome?** AskGogo: fail closed — the train
   research path was rewritten specifically to stop inventing train times.
5. **Where does the work continue after the user leaves?** AskGogo: a claimed-with-optimistic-lock
   queue on a 60-second cron, with a stale sweep and per-step leases.
6. **What does it cost to run one heavy user?** AskGogo: budgeted per tier in the plan catalogue
   (`cogsBudgetInr`, 30% target margin) and enforced by a fail-closed meter.
7. **What is actually tested?** AskGogo: the logic layer thoroughly, the integration layer not at
   all — state it and compare like for like.

Evidence tiers for Run 2 should be declared the same way this audit declares W/B/C, so an
unverifiable marketing claim is never tabled against a verified code path.

---

## Appendix — how this audit was produced

Static analysis only, on commit `0007897`, from a Claude Code cloud session with no deployment,
database or network access to AskGogo's production systems. Principal commands:

```bash
find app/api -name route.ts | wc -l            # 99 routes
find lib app components -name '*.ts*' | xargs wc -l   # ~55.2k lines
grep -rhoE "process\.env\.[A-Z0-9_]+" app lib scripts | sort | uniq -c   # ~70 env vars
grep -rn "validateRequest\|x-twilio-signature" app lib  # R1
grep -rli "row level security" sql supabase | wc -l     # R2: 10 of 44
grep -o "verify-[a-z0-9-]*\.\(mts\|mjs\)" package.json | sort -u | wc -l  # 58 of 62
grep -rnoiE "bookmyshow|irctc|indigo|amazon|zomato|swiggy|uber" lib app   # provider coverage
```

No test suite was executed: `node_modules` is not present in this checkout and the suite's 58
checks shell out to `npx tsx` per script. Every tier assignment above is therefore based on the
*existence and shape* of a check, not on a green run. Re-running `npm test` locally before acting
on §3 is advised.
