# AskGogo — Session Handover
**Last updated:** 1 September 2026, afternoon
**Repos:** `C:\Users\gover\gogo-memory-os` (app), `C:\Users\gover\askgogo-main` (marketing site)
**Supabase project ref:** `qenhjcooyecmatwducpu`

---

## 0. Start here — what is in flight right now

**Asset memory Pass 1 is mid-fix.** The feature saves and retrieves documents, but sensitive retrieval leaked full passport numbers. Two root causes found and fixed in sequence:

1. **`match_documents` RPC did not exist** — every retrieval threw, returned null, and fell through to the freeform LLM, which reconstructed a full passport dump from context. RPC has now been created in production. Retrieval works and returns the signed file link.
2. **Legacy document rows have no `privacyClass`/`assetType`** — rows saved before asset-memory existed have `doc_type: "document"`, so the new sensitive branch was never selected. Fail-closed detection on title/doc_type was written, plus a rule that the masked renderer must never echo `documents.summary` or `documents.title` (the values are baked into the stored summary for legacy rows).

**Status:** the compatibility fix is code-complete and typechecks clean. Whether it has been committed, pushed and tested is the first thing to confirm.

**Test to run:**
```
show me Srini passport
```
Expect a masked reply. A legacy row with no structured `extracted.fields` will degrade to a bare "📄 Passport" plus the signed link — **that is a pass, not a failure.** For the full masked format, re-save the passport through the new path (send the PDF with "save Srini passport") and retrieve again.

**Pass 2 has not started.** It is Cases 1, 2, 4 and the classification correction in `docs/AskGogo-AssetMemory-Fixes.md`.

---

## 1. Where the product actually is

**Verified from the database. Use these numbers, not older docs.**

- **117 WhatsApp users**, all of whom sent at least one message
- 449 additional rows are Telegram-era records, only 5 of which ever messaged. **The "566 users" figure is misleading — do not use it in a deck**
- **36 active in the last 30 days**
- Activation is strong: 0 one-and-done, 41 sent 2–5 messages, 81 sent more than 5
- **2 paying users**

**Retention is the problem.** Cohorts by first message:

| Cohort | Users | Still active |
|---|---|---|
| April | 25 | 2 |
| May | 44 | 2 |
| June | 9 | 0 |
| July | 12 | 0 |
| August | 32 | 32 (too recent to mean anything) |

**No marketing has been done at all.** These arrived organically while waiting on the display name.

**Likely cause:** the daily briefing is the only feature that reaches out on its own, and **only 1 of 117 users had it enabled**. Onboarding advertised it as if already on, but the only way to enable it was to type a parseable time — the obvious phrase either errored or sent a single briefing while setting nothing, so it *looked* like it worked. Fixed 31 Aug.

---

## 2. Shipped and verified

**WhatsApp number cutover — complete.** `+1 760 548 3659`. Display name "AskGogo" **approved**. Inbound, voice, reminders, templates and button IDs confirmed on device.

**Google Calendar OAuth — APPROVED** (1 Sep). Scope `.../auth/calendar.events` on project `askgogo-493811`. Gmail cut entirely (`gmail.readonly` is *restricted* and would force an annual CASA assessment). Consent screen verified clean on device. ⚠️ Any scope change or consent-screen edit triggers a new verification cycle.

**Absolute dates in the calendar.** Any event more than two days out was silently landing on *today*, for every user. Fixed and verified in Google Calendar.

**Briefing enable works.** `briefing on`, `turn on daily briefing` etc. now set `briefing_enabled`.

**Briefing content cleaned.** Removed the internal memory-stats block, removed command menus from both builders, fixed past-dated flight legs in Recent notes, one bullet per note.

**Arabic works better than expected.** Reminders create correctly, reminder queries answered, Arabic understood throughout. Two gaps — **replies come back in English**, and **Arabic calendar phrasing falls through to reminders** because `parseCalendarCreate` requires English tokens.

**Twilio auto-recharge** — page reached; confirm it was actually enabled. Balance was $17.52 against $8–14/month spend. New billing group `billing_group_506p2gc54hfxprpxm41nha4ve0`.

**Passport test data cleaned.** The `documents` row and its `memory_embeddings` entry were deleted. ⚠️ **Still to do: delete the file from Supabase Storage (`user-documents` / folder `-884501501`) and clear the WhatsApp thread** — the row delete does not touch storage, and the chat history syncs to cloud backup.

---

## 3. Open work, in priority order

### 🔴 Blocking
1. **Finish asset-memory Pass 1** — see §0. Then Pass 2 (`docs/AskGogo-AssetMemory-Fixes.md`): save-command-before-media, media-before-save-command, "show me" returning the original without a second command, and the classification correction (an order estimate labelled "payment screenshot" was misclassified and got a calendar suggestion).

2. **The general freeform credential leak — still unfixed.** Demonstrated live during this session: the freeform path reconstructed a full passport dump from context. Users also save passwords into `memories`, and `buildMemorySearchReply` surfaces `memory_embeddings.content` verbatim. Asset memory guarantees *new* assets never put values into that index; every other path still has the problem. Prompt:

   > Fix the general freeform sensitive-memory leak. Do not touch the newly implemented asset-memory behaviour. First trace every path by which `memories.content` or equivalent stored context enters `askClaude` / freeform responses. Build a single masking/redaction boundary before sensitive values reach the model, not only before rendering. Passwords, PINs, CVVs, access tokens, API keys, account numbers, passport numbers, Aadhaar/PAN-like identifiers and other credential-like secrets must be redacted by default. Preserve non-sensitive memory usefulness. Before editing, report the data flow, proposed masking boundary, files changed and regression risks. Add tests proving a saved password cannot be surfaced through paraphrase, summary, "what do you remember about me?", or contextual retrieval. Run `npx tsc --noEmit` afterward and report only new errors.

3. **A one-time backfill for legacy sensitive rows.** Runtime safety no longer depends on it, but the leaky summaries are still in the database at rest. Proposal: for `documents` rows matching the sensitive title pattern, re-run `classifyAndExtractAsset`, populate `extracted.{privacyClass, assetType, fields}`, and overwrite `summary` with a masked version.

4. **Orphaned `users` row** — `whatsapp_id = 'whatsapp:+918884501501'`, `telegram_id NULL`, name "⭐ Contact". Invisible to keyed queries. Three `ilike` lookups were hardened; the row still needs deleting and a normalization guard added on `whatsapp_id`.

### Retention
5. **Two briefing builders.** `lib/bot/handlers/morning-briefing.ts` (scheduled, Vercel cron `daily-briefings` every 15 min, gated on `briefing_enabled`) and `app/api/briefing/route.ts` (on-demand, via `lib/feature-intents.ts:80`). Every fix must be made twice. Consolidation prompt in §5.
6. **Briefing says "Good morning" at any hour.** Fix exists in `git stash@{0}`. **Review before popping** — coupled to a header removal in `daily-briefings`, and carries an unrelated change clearing `google_calendar_connected` on *any* failed refresh, which would disconnect users on a transient Google error.
7. **No conversational briefing config.** `users.briefing_content` exists, `show()` reads it, but nothing can say "remove weather from my briefing".
8. **Message the 117 existing users** offering the briefing. They were all promised one and never got it. Template send on the only healthy WABA.

### Language / UAE
9. **Replies are English-only** regardless of input language. Design decision taken: **detect from the first message, don't ask at onboarding** — the signal already exists, and asking costs a step at the moment you're proving value. Store detected language, allow override ("reply in English"), surface in the dashboard.
   **Phase 1:** pass language into the LLM system prompt so freeform replies match — no Meta involvement.
   **Phase 2:** Arabic versions of `askgogo_reminder_v2` and the buttons template, each needing Meta approval, with the send path picking by user language.
10. **Arabic calendar phrasing** falls through to reminders.
11. Only Kannada and Arabic verified on device. The deck's "90+ languages" rests on the transcription layer's supported range, not testing.

### Lower
- Menu/food photos log as meals — a restaurant menu produced "Meal logged, 200 kcal" and wrote junk into nutrition data.
- Image + date → calendar: the prompt now offers "Reply *add to calendar*", but the calendar handler can't resolve "this" to the preceding note.
- Recurring interval reminders ("every 2 hours between 9am and 7pm") have never worked — silently dropped since at least May.
- Numeric dates (`15/10/2026`) don't reach the calendar handler — gated out by `isCalendarAction`.
- Event titles keep the date in them ("Meeting with Divya on 7 September").
- Note titles truncated at write time by `deriveNoteTitle`, so briefs show "…(Form..." mid-word.
- Recurring delete is a hard delete with no warning — silent data loss.
- "Amex Amex" cards formatter; gold price shows 18K above 24K; `app/page.tsx` is still the create-next-app starter; OG image 404s.
- Friend-reminder recipients who reply "done" hit a dead end.
- Twilio: delete superseded templates `HX4f24ea2298adec4d229c71a2595e7904` and `HXc41b4185c0856faa31b8ddd2b9a00b82`; rotate the auth token (must update Vercel and redeploy in the same pass or the status-callback signature check breaks silently).
- The `notes` list has ~40 empty "Skin check report" entries and dozens of test meeting notes. Never pruned.

---

## 4. Meta / WhatsApp account state

**Display name "AskGogo" — Approved.** Business profile complete: avatar, category (Professional services), description, address, support email, website, Facebook Page connected.

**Username** — `askgogo` is taken. `askgogoai` matches an Instagram business account Gogo owns, and Meta offered a Connect Instagram flow to verify ownership and claim it. In progress.

**Instagram** — `askgogoai` is currently connected to *another* WhatsApp account, probably one of the restricted WABAs or the old Fleetwise one. If the Connect flow fails, disconnect from **Settings → Accounts → Instagram accounts** first. Connecting it unlocks click-to-WhatsApp ads and a unified inbox, which matters for the planned ad videos.

**OBA / green tick — deliberately deferred.** Judged on brand notability (press, Wikipedia, organic search presence), not profile completeness. With 117 users and no press, rejection is likely, and a rejection carries a cooldown. Wait until after launch and some coverage.

**Three restricted WABAs** (27–28 Aug, all dormant, never used) left alone rather than appealed. They may be what's holding the Instagram link.

---

## 5. Ready-to-run prompt: consolidate the briefing builders

```
Consolidate the two morning-briefing builders in gogo-memory-os.

Current state, verified:
- lib/bot/handlers/morning-briefing.ts exports buildMorningBriefing(telegramId,
  userName). Called by app/api/cron/daily-briefings (Vercel cron, */15) and
  process-message.ts:880. Has: weather, today's flight from travel_tickets,
  calendar with connected/error/empty states, reminders. Reads
  users.briefing_content flags via show().
- app/api/briefing/route.ts has buildBriefing(user) + loadBriefingContext(user).
  Called by its own GET/POST; POST is reached from lib/feature-intents.ts:80.
  Has: priority line, reminders, follow-ups, todos, recent notes (deduped,
  past-dated filtered), date header.
- DEAD: app/api/cron/briefing (not in vercel.json), and the isBriefing branch in
  app/api/cron/reminders/route.ts:319 (BRIEFING_KEYWORDS matches zero rows).

Task:
1. Make buildMorningBriefing the single builder. Port in the priority line,
   follow-ups, todos and recent notes (keep the isPastDatedNote + dedupe logic
   already in app/api/briefing/route.ts). Every new section must respect the
   existing show() flag system.
2. Point app/api/briefing POST at buildMorningBriefing.
3. Delete app/api/cron/briefing and the dead isBriefing branch.

Constraints: the send path must not break. Report the plan and every file you
would change BEFORE editing. Do not refactor anything outside these files.
```

---

## 6. Traps that cost hours — read this

**Do not patch this repo with PowerShell string-replacement scripts.** Three failures came from it on 31 Aug:

1. **Silent no-ops.** `.Replace()` on a string it can't find changes nothing and reports nothing. Two patches "succeeded" while doing nothing.
2. **Escaping corruption.** A regex written as `"\\b(\\d{1,2})"` inside a PowerShell double-quoted string lands in the file as `/\\b(\\d{1,2})/` — matching a literal backslash, not a digit. This shipped and silently disabled a filter for hours.
3. **A verification that tested the wrong thing.** The regex was "proven" in node using `new RegExp("\\b(\\d…")`, where string escaping collapses `\\d` to `\d`. The file used a regex *literal*, where it does not.

Six debugging rounds followed. Claude Code found it in one pass by reading the file as it exists. **Use Claude Code for anything touching more than one line or one file.**

**When a fix "should obviously work" but production is unchanged, suspect infrastructure before logic.** The asset-memory leak survived a correct code fix because a database RPC had never been created — every retrieval threw and fell through. Check deploy status, migrations and matcher reachability before writing a second patch.

**The recurring bug class:** a matcher claims a message it can't service, and the message can never fall through. Four instances — nutrition substring (`rice` ⊂ `price`), list_add `startsWith`, bill-split lazy prefix (any phrase ending in "balance"), CreditIQ cards. `routeFeatureIntent` (`feature-intents.ts:24`) runs ~260 lines before `detectIntent` and returns early. **The fix pattern is existence-gating**: only claim the turn if the handler can produce an answer, else return null.

**Privacy fails closed.** If a document can be identified as a passport/ID from title or type, missing metadata must never downgrade it to "normal".

**Other environment notes:**
- `npm run build` reports "Skipping validation of types" — always run `npx tsc --noEmit` separately. Five pre-existing errors expected (briefing/route.ts, resolve-user.ts, limits.ts, media-memory.ts, next.config.ts).
- VS Code's TS config has drifted from the build target — editor diagnostics here are not fully trustworthy.
- `vercel --prod` ships the **working directory**, not the committed tree. Deploy via `git push`.
- Use `-Encoding UTF8` on every `Get-Content` and `Select-String`.
- Claude Code has **no database access** — migrations are run by hand in the Supabase SQL editor.

---

## 7. Marketing — not yet started

`SaaS_Launch_Platforms_Master_List.pdf` — 67 platforms, in the repo.

**Two cautions:**
- AskGogo has no website you can try. Every directory expects a URL where a visitor lands and uses the product; yours is a WhatsApp number. Decide what askgogo.in does for a cold visitor first.
- **Product Hunt and Hacker News are one-shot.** Hold both until the ad videos exist and there is a month of post-fix retention data. The other ~65 are repeatable, free, slow SEO plays.

**Ad videos:** modelled on Memorae's format (own footage) — hook on a real Instagram comment, ~15 demos at one every 6–8 seconds, each a real WhatsApp thread never a mockup, hard-cut one-line captions, closing card.

**Deck:** `AskGogo-Seed-Deck-v3.pptx` and `AskGogo-Deck-Design-Handoff.md` in `docs/`. Ask is **₹2 Cr**, 18 months, India first. Gogo wants the design redone in Claude Design. **No traction slide — the numbers in §1 are what an investor would find.**

---

## 8. Competitive position

From a paid Memorae trial plus teardown of their reel and emails.

**They beat AskGogo on:** conversational briefing config, interval-with-window reminder parsing (they ask when the start time has passed rather than silently dropping it), numeric dates, a "what did you handle for me?" session recap, and work-tool integrations (Notion, Slack, Linear, Drive, Gmail).

**AskGogo beats them on:** document understanding — their retrieval is filename-matching only ("I found DOC-20260816-WA0004.pdf but it is not labelled as a lease agreement"); no app required; price (₹199 vs ₹650/₹1,300).

**Their failures, worth not copying:** they confirm saves they never received ("Your passport number has been saved" when no number was given), and they echo stored passwords in plaintext — including unprompted inside a summary. Document queries took 20–30 minutes to answer.

**Their email program:** two senders — a daily brief from the product, and a daily lifecycle drip from a named human. Every CTA is a **pre-filled wa.link**: the link text *is* the command, so tapping opens WhatsApp with the sentence typed. AskGogo already has `waLink()`. Full teardown in `docs/AskGogo-Email-Program-Spec.md`.

⚠️ **Corrected 30 Aug:** Memorae *does* catch duplicate reminders. Any deck claiming otherwise is false and checkable.

---

## 9. Repo docs index

- `docs/AskGogo-Handover-2026-09-01.md` — this file, the current one
- `docs/AskGogo-AssetMemory-Prompt.md` — the original asset-memory spec
- `docs/AskGogo-AssetMemory-Fixes.md` — Pass 1 + Pass 2 regression fixes
- `docs/AskGogo-Email-Program-Spec.md` — Memorae email teardown + AskGogo build spec
- `docs/archive/` — superseded handoffs, do not work from these
