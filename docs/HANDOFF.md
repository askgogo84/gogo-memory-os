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

## 8. Testing
`docs/MEMORAE_PARITY_AND_TEST.md` Part A = full command-by-command checklist. As of handoff, verified live: Phase 0, 1A, 1D, plus (this session's user tests) friend reminders, briefing settings, weekly/preview, content flags, topic digest. The topic-bucket "at 6pm" collision was found and fixed (`ee1c86e`) — re-verify bucket saves.
