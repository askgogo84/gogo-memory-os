# AskGogo — Engineering Handoff (for a new chat session)
_Last updated after commit `ee1c86e`. Read this top-to-bottom before making changes._

## 1. What AskGogo is
A personal-assistant **WhatsApp bot** (Telegram-ready) for India. "India runs on WhatsApp,
so should your day." Built to reach feature parity with **memorae.ai** and beat it on price
(₹99/mo vs their ₹325+) while adding things they don't have (calories, split bills, expenses,
meeting notes, translation, skin check).

- **Stack:** Next.js (App Router) · TypeScript · Vercel (hosting + cron) · Supabase (Postgres + pgvector) · Twilio (WhatsApp) · OpenAI (embeddings, vision, whisper) · Anthropic Claude (chat/intents) · Razorpay (payments).
- **Repo:** `C:\Users\gover\gogo-memory-os` → GitHub `askgogo84/gogo-memory-os` (branch `main`).
- **Deploy:** `git push` → Vercel auto-deploys to **app.askgogo.in**. No manual build step.
- **Supabase project:** `qenhjcooyecmatwducpu` ("Whatsapp Bot"). Migrations are pasted into the SQL editor by hand.
- **Env (Vercel):** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `CRON_SECRET`, Twilio creds, Razorpay, Google OAuth. Embeddings reuse `OPENAI_API_KEY` (text-embedding-3-small, 1536-dim).

## 2. How to work in this environment (IMPORTANT gotchas)
- **The Edit/Write tools TRUNCATE large files** in this sandbox (they cut the tail off files >~600 lines). This corrupted several files earlier. **Always edit via the shell** (bash + a Python heredoc doing exact string replacement) and **verify** `wc -l` + `tail -1` after every edit. Git has clean copies if anything truncates — restore with `git show HEAD:<file> > <file>`.
- **Typecheck baseline:** `npx tsc --noEmit -p tsconfig.json` reports **5 pre-existing errors** (process-message regex flag, resolve-user, limits, media-memory youtube-transcript, next.config). That's the clean baseline — any NEW error is yours. Vercel builds despite these (Next ignores TS errors).
- **PowerShell:** the user's shell does NOT support `&&`. Give git commands one per line.
- **Line endings:** repo is CRLF; git shows LF→CRLF warnings on new files — harmless.
- **Verify features live:** the reminder/embedding/routing pipeline hides bugs until run on real WhatsApp. Always give the user a copy-paste test after each deploy.

## 2b. Cron & scheduling (CRITICAL ops gotcha)
- **The reminder/briefing crons are driven by an EXTERNAL scheduler, NOT Vercel Cron.** A **cron-job.org** job pings the routes over HTTP using the `?secret=<CRON_SECRET>` query param — that's why both `/api/cron/reminders` and `/api/cron/daily-briefings` accept `?secret=` in addition to the `Authorization: Bearer` header. The real firing cadence (e.g. hourly) lives in the **cron-job.org dashboard**, which is **not in this repo**.
- **`vercel.json` crons are effectively a fallback / are misleading.** The `"/api/cron/reminders": "0 2 * * *"` (daily) entry does NOT match observed behaviour — hourly `hourly_between` reminders (e.g. drink-water 9am–9pm) only work because the external job pings far more often than daily. Don't trust `vercel.json` schedules as the source of truth for when things actually fire.
- **⚠️ Single point of failure, UNMONITORED.** If the cron-job.org job is paused, deleted, hits a billing/quota issue, or its `?secret=` drifts from `CRON_SECRET`, **ALL reminders and briefings stop silently** — no error, no alert, users just stop hearing from the bot. There is currently no heartbeat/dead-man's-switch on this. Treat "reminders stopped" incidents by checking the external scheduler FIRST.

## 3. Architecture — message routing (where bugs hide)
Inbound WhatsApp → `app/api/webhooks/whatsapp/route.ts`. Order matters; earlier handlers win:
1. throwback keep/forget · preference-forget · **bucket save/share** (`handleBucketCommand`) — these run BEFORE `routeFeatureIntent`
2. `routeFeatureIntent` (`lib/feature-intents.ts`) — split bills, contacts, todos
3. `isMemoryControlCommand` → `buildMemoryControlReply` (memory search/forget/toggle)
4. `getDirectWhatsappPremiumReply`
5. `processIncomingMessage` (`lib/bot/process-message.ts`) — the main brain: intent detect → reminders / lists / calendar / gmail / nutrition / friend reminders / topic digest / preferences / weekly brief / Claude fallback

**Collision lessons already fixed (don't regress):**
- "remind `<name>`…" must beat self-reminder → friend detection excludes me/myself.
- "forget rule about X" must beat memory-forget → preference-forget intercept in webhook.
- "remember for X: … at 6pm" must beat reminder/split-bill → `handleBucketCommand` runs before `routeFeatureIntent`.
- "remember `<pronoun>` …" must NOT go to contacts → contacts rule requires phone/email/keyword.
- Serverless: `indexMemory` must be **awaited** (fire-and-forget froze before completing).

## 4. Features shipped this session (all on `main`, deployed)
| Feature | Key files |
|---|---|
| Phase 0 — absolute-date reminders + clean text | `lib/bot/handlers/reminders.ts` |
| 1A — semantic memory search | `lib/services/embeddings.ts`, `lib/services/memory-index.ts`, `lib/bot/handlers/memory-control.ts`, `app/api/admin/backfill-embeddings/route.ts` |
| 1B — Throwback | `lib/bot/handlers/throwback.ts`, briefing cron |
| 1C — friend reminders | `lib/bot/handlers/friend-reminders.ts`, process-message |
| 1D — preference rules | `lib/bot/handlers/preferences.ts`, `lib/services/claude.ts` (prompt inject) |
| 1E — weekly brief + preview + content flags | briefing cron, `lib/bot/handlers/morning-briefing.ts`, process-message |
| 1.5 — shared memory (topic buckets) | `lib/bot/handlers/shared-memory.ts` |
| #18 — topic scheduled digest | `app/api/cron/reminders/route.ts`, process-message |
| #3 — contacts vs memory routing | `lib/feature-intents.ts` |

Pre-existing (already in repo, not built here): calendar, gmail, web search, food calories, split bills, expenses, meeting notes, translation, skin check, nutrition, referrals, plan-my-day.

## 5. DB migrations added this session (run in Supabase already)
`sql/memory-embeddings.sql` (+ `match_memories`, `resurfaced_at`, `topic`), `sql/throwback.sql`, `sql/user-preferences.sql`, `sql/friend-contacts.sql`, `sql/weekly-brief.sql`, `sql/shared-memory.sql` (+ `memory_shares`, `match_shared_memories`), `sql/briefing-content.sql`.

## 6. Memorae parity
See `docs/MEMORAE_PARITY_AND_TEST.md`. **24/28 full**, 1 partial (email: read+draft-reply done; auto-classify/send deferred), 3 pending (dashboard, Twilio template, Telegram), 3 deliberate skips (Outlook/Apple, native app, password vault). Plus 6 features Memorae lacks.

## 7. What's genuinely left (the real backlog)
1. **Website redesign** — see `docs/WEBSITE_REDESIGN_BRIEF.md` (the current user priority).
2. **Twilio approved template** — config, not code; unlocks 1C delivery to cold numbers.
3. **Web dashboard (#24)** — magic-link login, bulk-edit reminders/lists/briefings. `app/dashboard/page.tsx` + `public/dashboard.html` exist as a shell.
4. **Telegram channel (4B)** — adapter mapping Telegram updates onto the same handler chain.
5. **Email auto-classify + payment auto-log (#21 tail)** — deeper Gmail; send scope stays deferred.
6. **Cron heartbeat / dead-man's-switch (NEXT SESSION — not built)** — hardens the external-scheduler SPOF from §2b. Interim guard: cron-job.org's own built-in failure alerts are being enabled from its dashboard (email on failed/missed ping). The durable fix, to spec next session:
   - **Set up:** create a check at **Healthchecks.io** (free tier). It gives a unique ping URL (`https://hc-ping.com/<uuid>`). Set the check's **period** to match the real cron-job.org cadence (e.g. hourly) with a **grace** window (e.g. +15 min). If no ping lands inside period+grace, Healthchecks alerts (email/Slack/etc.).
   - **Where the ping wires in:** the cron route must ping Healthchecks *only after a successful run* so a silent stop OR an erroring run both trip the alarm. Add it at the end of the `GET` in `app/api/cron/reminders/route.ts` (just before the final `NextResponse.json({ ok: true, … })`), gated on a new `HEALTHCHECK_REMINDERS_URL` env var: `if (process.env.HEALTHCHECK_REMINDERS_URL) await fetch(process.env.HEALTHCHECK_REMINDERS_URL).catch(() => {})`. Do the same in `app/api/cron/daily-briefings/route.ts` with its own `HEALTHCHECK_BRIEFINGS_URL` (separate check = independent alerting per pipeline).
   - **Env:** add `HEALTHCHECK_REMINDERS_URL` / `HEALTHCHECK_BRIEFINGS_URL` in Vercel. Absent → the `if` is skipped, so it's safe to deploy before the checks exist.
   - **Note:** this detects the pipeline going *dark* (external job stopped, secret drift, route throwing before the ping). It does NOT verify individual message delivery — that still surfaces via Twilio `WHATSAPP_TEMPLATE_SENT` / 63016 logs.

## 8. Testing
`docs/MEMORAE_PARITY_AND_TEST.md` Part A = full command-by-command checklist. As of handoff, verified live: Phase 0, 1A, 1D, plus (this session's user tests) friend reminders, briefing settings, weekly/preview, content flags, topic digest. The topic-bucket "at 6pm" collision was found and fixed (`ee1c86e`) — re-verify bucket saves.
