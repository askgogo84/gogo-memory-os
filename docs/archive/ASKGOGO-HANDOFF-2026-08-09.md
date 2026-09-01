# AskGogo — Master Handoff & Remaining Work
*Compiled 9 Aug 2026. Paste into a fresh session to resume. Everything below is either verified-shipped (don't rebuild) or a scoped open task.*

---

## 0. How to read this

- **§1 Environment** — repos, DBs, deploy, the gotchas that have cost real hours.
- **§2 Urgent** — two things that can break production this week.
- **§3 Shipped & verified** — don't rebuild these.
- **§4 The queue** — every remaining task, ordered, grouped by track.
- **§5 Standing rules** — the discipline that has caught real bugs every session.
- **§6 Reference** — IDs, SIDs, numbers you'll need.

---

## 1. Environment

**Repo:** `C:\Users\gover\gogo-memory-os` → prod `app.askgogo.in`, Vercel project **`gogo-memory-os`** (not `credit-iq`).
**DB:** Supabase **`qenhjcooyecmatwducpu`** ("Whatsapp Bot") — **not** `yazpphublutdodahfwvr`, which is CreditIQ's. The refs look alike. Check the URL bar before every Run.
**Deploy:** `git add/commit/push` then `npx vercel --prod`. Vercel is **not** git-linked, so a push never deploys. PowerShell chains with `;` not `&&`.
**Stack note:** Next 16, App Router, Tailwind v4 **CSS-first** — there is no `tailwind.config.js` and one must not be created.
**Typecheck:** `npx tsc --noEmit` shows **5 known pre-existing errors** (process-message.ts, resolve-user.ts, limits.ts, media-memory.ts, next.config.ts). Only NEW errors matter.

### Hard-won gotchas

1. **Hand-applied migrations.** Claude Code can't run DDL. Always confirm a migration landed with a `SELECT` that returns the object — "migration applied" has been asserted before it actually ran.
2. **Key types differ per table.** `dashboard_tokens`, `dashboard_sessions`, `user_plans`, `usage_events` use `telegram_id` **TEXT** — always `String(telegramId)`, including negative synthesized ids. `reminders`, `users`, `lists`, `friend_contacts` use **numeric**. Cast at the boundary; don't unify.
3. **`whatsapp_id` vs `whatsapp_to`.** The user's own number is `users.whatsapp_id`. `whatsapp_to` on `reminders` is the *recipient*. `user_plans.whatsapp_id` stores the **bare** `+91…` form; `users.whatsapp_id` uses the `whatsapp:+91…` prefix.
4. **Synthesized ids.** A WhatsApp user's `telegram_id` is the last nine digits of their number, negated (`+918105216253` → `-105216253`). Real Telegram users have a positive id and null `whatsapp_id`.
5. **Case-sensitive env checks.** `METER_ENABLED === 'true'` cost a full day because the value was `True`. Never mark a boolean env var Sensitive — you can't read it back.
6. **The router order.** On WhatsApp, `routeFeatureIntent` (webhooks/whatsapp/route.ts:836) runs ~260 lines *before* `processIncomingMessage`/`detectIntent` (:1095) and returns early. Anything in `feature-intents.ts` wins over `detect-intent.ts`.
7. **Twilio template rejections are routine.** Expect submit→reject→fix→resubmit. Common rejects: missing `{{n}}` sample, "too many variables for its length" (fix: lengthen the body).

---

## 2. Urgent

### 2A. Twilio balance is $1.09
At WhatsApp per-message rates that's a few hundred messages. At zero, **every reminder fails to send** — the exact silent-failure class that caused the month-long outage, arriving through billing instead. Auto-recharge has been unconfirmed since July. **Top up and enable auto-recharge.**

### 2B. Memorae trial cancels ~12 Aug
Started 5 Aug, 7-day free trial, Origin tier ₹650/mo. Real money. Cancel unless you're keeping it for research.

### 2C. Display name — in review, do not resubmit
`+1 579-700-6612` shows **In review** with a clock icon. A verification is in flight, which is why a resubmission was blocked. Wait it out.
- Approved as anything → the rejected state clears, which lifts the **250 business-initiated messages / 24h** throttle. Then submit plain `AskGogo` (capital G) as a fresh change.
- Rejected again → it's an ownership problem, not a naming one, and the fix is your own WABA under your own verified Meta portfolio. That means a new sender registration and your two approved templates are tied to the current WABA — confirm with Twilio what happens to them before migrating.
- **Don't** click "Submit request" under Official business account (blue tick) until the name passes.

---

## 3. Shipped & verified — do not rebuild

**Meter** — `lib/services/meter-core.ts` + `meter.ts` + 19 offline tests. Web search metered at both call sites behind `METER_ENABLED`. Recording confirmed in production (usage_events rows with Twilio SIDs as `meta.message_id`). Idempotency DB-enforced via `usage_events_msg_idem_idx`; 23505 treated as a benign dedupe.

**Dashboard auth** — magic link over WhatsApp. `dashboard` → single-use token (32 random bytes, SHA-256 at rest, 15-min TTL, 5/hour rate limit counted on `dashboard_tokens`) → `askgogo_session` httpOnly cookie backed by `dashboard_sessions`. Verified end to end. The client-side POST redeemer must stay a POST — WhatsApp's link-preview crawler would burn a single-use token on a GET.

**Both IDORs closed** — `/dashboard` stubbed then rebuilt with session auth; `/upgrade` migrated off `?id=` and verified in incognito.

**Dashboard shell** — Tailwind v4 `@theme` tokens, Fraunces + Karla, route group `(app)` with one session guard, five tabs with the custom icon set, `.dashboard-root` light-theme scoping.

**Today surface** — the thread: vertical spine, now-marker, gap line, am/pm times, single-timezone rendering, collapse of consecutive past occurrences of the same series ("Hourly · 5 done today").

**Lists surface** — read-only, sentence-cased names, underscores→spaces, expanded view capped at 10 with "Show all N".

**Nutrition/list routing** — the `rice`⊂`price` substring bug fixed, deterministic list route added ahead of nutrition, reminder-shape and interrogative guards, 18/18 regression harness at `scripts/verify-nutrition-routing.mjs`.

**Earlier, still true** — conversational reminder engine, follow-up/nag reminders, dedupe guard (`5e81428`), reminder buttons (Done/Snooze/Move), context emojis, bidirectional Google Calendar, flight-ticket parsing to `travel_tickets`, expense tracker, lists, translation, voice, CreditIQ linking + "show my cards" with the honesty model.

---

## 4. The queue

### TIER 1 — Reliability (the competitive thesis)

**1A. Delivery-truth for reminders — HIGHEST VALUE, STILL UNBUILT.**
Reminders are marked `sent=true` on Twilio *accept*, not delivery, and the SID isn't stored (`markReminderSent`, cron/reminders/route.ts:145-151). Same silent-failure class as the month-long outage.
Build: store `twilio_sid` + `delivery_status` on `reminders` (migration first, confirm with SELECT); a Twilio status-callback webhook; a daily due-vs-delivered self-audit; a heartbeat alerting if cron dispatch stops >15min.
Constraints: the send path is the most dangerous file in the repo — no refactors, every new check **fails open**, never touch the dedupe guard or the followup cap, gate behind an env var so unsetting reverts instantly.

**1B. Meter enforcement has never been tested against a real wall.** Recording is proven; the cap isn't. Set `-573866654` to `plan_code = 'free'`, run six searches in one sitting, confirm the 6th refuses *without calling Tavily*, then set a reminder to prove the habit path is untouched, then restore to `lite`.

**1C. `METER_ENABLED` is a module-level const** evaluated at cold start (process-message.ts:46). Convert to a request-time read so a config toggle can't be silently stale.

**1D. Briefings and topic digests still send freeform** — they fail outside the 24-hour window. Each needs its own Utility Content template, same pattern as `askgogo_reminder_v1`.

### TIER 2 — Correctness bugs

**2A. Check-in reminders fire 24 hours late for every Indian domestic flight.** Every Indian carrier opens check-in at **48h**; the reminder is hardcoded at T-24h. `lib/services/airline-checkin.ts` is already in the repo with per-airline windows and `checkInOpensHours(code, isInternational)` — wire it into the reminder scheduling.

**2B. Travel-day links — approved, not built.** Web check-in URL + PNR on the T-24h reminder; "leave now" + two country-appropriate cab links on the T-3h reminder. Plain `https://` links (they open the operator's app via universal links). Links only, no booking. Airline table exists; cab links need a small country→operators map.

**2C. Flight feature never fully verified.** Forward a **future-dated** ticket to confirm the T-24h/T-3h reminders actually fire and the morning-brief "✈️ Today's flight" section renders. The image-ticket path has never been tested on a phone (only PDF).

**2D. Calendar brief is ambiguous** — "No calendar events lined up today" reads identically whether connected-and-empty or token-dead, because `google_calendar_connected` is a stale-positive that's never reset. Derive state from the `getCalendarTokens` triple check, render three distinct outcomes, and **set the flag false when a refresh fails**. *(In progress at time of writing.)*

**2E. Calendar create-intent is broken** (calendar-actions.ts). `isCreate` needs contiguous substrings, so "add X meeting to my calendar tomorrow" fails all of them and the "calendar tomorrow" substring routes it to the *view* branch. `isCalendarAction` also fires on the bare word "meeting". Patch pending since July.

**2F. Meal-log line duplicates the noun** — "2 rotis roti — 160 kcal". Display-only, in the meal item formatter.

**2G. Absolute-date reminder patch** — file delivered, never deployed.

**2H. Bill-split routing bug** — open since July.

### TIER 3 — Security & privacy

**3A. The LLM echoes stored credentials.** Freeform output surfaced a saved laptop password and its email in plaintext over WhatsApp. Users store credentials in `memories` despite a password vault being a deliberate product skip. Minimum: mask credential-shaped values in any output. Decide whether `memories` should accept them at all.

**3B. `/upgrade` still needs hardening beyond the session fix** — stop passing `customerName` to `createPaymentLink`, and create the payment link on button click rather than page render.

**3C. Nine duplicate `users` rows** (one phone, two rows — a 2026-05-15 batch inserted `whatsapp:`-prefixed rows alongside bare-format originals). Currently **inert**, because `resolveUser` only matches the bare row. But if anyone ever normalises the prefix, those nine become matchable and identities collide. Note it in the repo before touching phone normalisation.

### TIER 4 — Pricing surfaces

**4A. Three prices are live simultaneously.** Landing says "from ₹99/month", `/upgrade` offers a single ₹299/mo Pro with pre-unit-model copy ("unlimited messages, 500 memories"), and the meter run-out says "Lite ₹99 gives you 25 a day". Rebuild `/upgrade` against `plan_limits`.

**4B. Meter Phase 4 — wire the remaining actions**, one per commit: translate → ask-anything → image classify → skin check → nutrition → ticket parse → receipt parse → meeting notes. Rule: one action decrements exactly one counter; a CreditIQ-owned question hits the CreditIQ meter, never the local one; a blocked Site-B message must record ONE `ai_action`, not two, via the shared `inboundMessageId`.

**4C. Meter Phase 5 — reminder fair-use ceiling.** Creation path only, **fail open**, never in the send path. Note this is genuinely new code: the existing `checkFeatureLimit` counts *active* reminders and is enforced only in `plan-my-day.ts:278`.

**4D. Meter Phase 6 — entitlements.** `calendars_max` and `friend_contacts_max` at connect/add time, plus the 7-day calendar trial for Free (`calendar_trial_started_at`). When the trial lapses the morning brief carries a warm pause message — never a silent drop.

### TIER 5 — Dashboard, remaining

**5A. Usage surface** — must call `getUsage`/`getPlan`/`getLimits` from `meter.ts`; never re-implement counting. Breath ring with the figure inside, Reminders shown as the *word* "Unlimited", bars turning plum in the last 20%, no upsell for pro/pro_annual/founder_pro, `CardError` rather than zeros on failure.

**5B. Calendar surface** — must derive "connected" from `getCalendarTokens`, not the boolean. Three distinct states: not connected / connected-but-empty / connected-with-events. Import `@/lib/google-calendar` (the one the bot uses), not `lib/services/google-calendar.ts`.

**5C. Today v2** — greeting in Fraunces, counts on the filter pills, and three summary rows below the thread (Lists / Usage / Calendar) each with a fact and a green chip. Mockup at `docs/askgogo-today-v2-mockup.html`.

**5D. Phase 6 writes** — edit reminder, delete reminder, create list, delete list item. Every route re-reads the session and re-verifies row ownership server-side. The recurring-delete prompt ("this one or the series?") is the one to get right.

**5E. The Recurring/Done pill row** — deferred from the Today build; queries already fetch all three sets.

**5F. OG metadata** — the WhatsApp link-preview card said "Create Next App". *(Fix was in progress.)* And `app/page.tsx`, the root of `app.askgogo.in`, is still the default Next.js template.

### TIER 6 — Polish & growth

**6A. Name consistency** — the brief says "Goverdhan", the dashboard greeting says "Gogo". One source of truth (`users.name`); update the row rather than hardcoding:
```sql
update users set name = 'Gogo' where telegram_id = -884501501;
```

**6B. Collapse the brief's stacked headers** — "☀️ Good morning" and "☀️ Today for <name>" into one line.

**6C. Warm named confirmations** — Memorae does "You're on a roll, Gogo! ✅ Marked as done." Ours are transactional. String-level change, no migration.

**6D. Reconsider button labels** — Memorae uses "Done / Remind me in 1 hour / Remind me tomorrow", coarser and more natural than "Snooze 10m / Move to 8pm". Also: they grey out Done after tap.

**6E. Button campaign flows 2–4** — show-my-cards buttons, morning-brief next-actions, Yes/No confirmations. One flow at a time, each its own template + approval cycle.

**6F. Onboarding quiz** — 4 AI cards, ~30 seconds, ending at a WhatsApp deep-link (not a password). This is where an email address gets captured.

**6G. Welcome email sequence** — 5 emails over 7 days. Email carries the narrative; WhatsApp carries in-session teaching. **Never** run a multi-day drip over WhatsApp — that's Marketing-category templates and it risks the sender quality rating that all reminder delivery depends on.

**6H. LLM-emoji Part 2** — `reminder-emoji.ts` is built but unapplied. Needs the `emoji` column migration first, then resolve-at-creation and use-stored-at-send.

**6I. Snooze 10m and Move to 8pm** buttons still unverified on later reminders (only Done confirmed).

**6J. askgogo.in hero uses an italic script serif** ("lives inside") — the italicised-word-in-headline device the house style forbids.

**6K. CreditIQ scrapers** (`cards-sync`, `ig-fetch-results`, `ig-intelligence`, `reddit-scrape`, `youtube-scrape`) still inactive from cron-job.org auto-disable. Decide if they're needed; if so re-enable with auto-disable OFF and failure-notify ON.

**6L. Older open items** — face report, Gmail v1 read-only, Instagram og:title fix.

---

## 5. Standing rules

1. **Verify before build** — read-only investigation first. The codebase has differed from assumption in every session.
2. **Migration-first, confirm with SELECT.** Never trust "applied".
3. **Review the diff before deploy**, especially anything near the reminder send path.
4. **Reversible rollouts** — gate risky changes behind an env var so unsetting reverts instantly.
5. **Fail open on non-critical guards** (dedupe, emoji, fair-use ceiling); **fail closed** on the product meter with an honest error ("couldn't verify your allowance", never "limit reached").
6. **One flow / one action / one surface per commit.**
7. **Test on phone.** The WhatsApp screenshot is the only real confirmation. No agent can inject test messages — `/api/dev/webhook` is an ops console, not an injector.
8. **Gogo deploys.** Agents never run `vercel --prod` or `vercel env`.
9. **375px first** for anything visual.
10. **Restore test state only AFTER a finding is nailed down** — restoring early destroyed the evidence in the meter investigation and cost a day.

---

## 6. Reference

| | |
|---|---|
| Twilio sender | `whatsapp:+15797006612` (Canada, Connected, quality High) |
| Gogo primary | `+918884501501` → telegram_id `-884501501`, plan founder_pro |
| Gogo test number | `+918310441698` → telegram_id `-573866654`, plan lite |
| WABA holding 6612 | `2514401452310403` · phone profile `1054030527800234` |
| Reminder text template | `askgogo_reminder_v1` · `HX7208a178cd6dfa9a8a9f9fd8bcfaecec` |
| Reminder buttons template | `copy_copy_askgogo_reminder_buttons_v3` · `HXd6a8e85fdcead9a3fbf217ef7fca166f` |
| Razorpay plans | Lite ₹99 · Starter ₹149 · Pro ₹199 · Pro-annual ₹1,499 |
| Real active base | ~10 users in 30 days (534 rows, 436 of them dead `imported` contacts) |

**Docs in `docs/`:** the six dashboard docs, the three pricing/meter docs, and two mockups (`askgogo-dashboard-mockup.html`, `askgogo-today-v2-mockup.html`).

---

*Recommended first move in a new session: §2A (Twilio balance), then TIER 1A (delivery-truth). 1A is the highest-value reliability work and the heart of the "more reliable than Memorae" thesis.*
