# AskGogo — Master Handoff

**Compiled 12 Aug 2026.** Supersedes `ASKGOGO-CREDITIQ-HANDOFF-1.md` (5 Aug).
Paste into a fresh session to resume. Everything below is either verified-shipped
or a scoped next step.

---

## 0. How to read this

- **§1 Environment** — repos, projects, deploy flow, the gotchas that have cost real time
- **§2 Shipped & verified** — don't rebuild these
- **§3 The queue** — ordered, with what's blocked and by what
- **§4 Open bugs** — found, not fixed
- **§5 Standing rules** — the discipline that has caught every bug this week

---

## 1. Environment

**Repos (Windows PC "Jarvis"):**

| Repo | Path | Prod | Vercel project |
|---|---|---|---|
| Bot + dashboard | `C:\Users\gover\gogo-memory-os` | app.askgogo.in | `gogo-memory-os` |
| Marketing site | `C:\Users\gover\askgogo-site` | askgogo.in | `askgogo-main` |
| CreditIQ web | `C:\Users\gover\creditIQ\creditIQ` | creditiq.app | `credit-iq` |

**Supabase — near-identical refs, always check the URL bar before Run:**
- Bot runtime DB = **`qenhjcooyecmatwducpu`** ("Whatsapp Bot")
- CreditIQ consumer DB = **`yazpphublutdodahfwvr`** ("cardiq")

**Deploy:** `git add/commit/push` then `npx vercel --prod`. Vercel is **not**
git-linked. PowerShell: chain with `;` not `&&`.

**Twilio:** sender `whatsapp:+15797006612`. Balance $21.06 as of 10 Aug, ~6 weeks
runway. **Auto-recharge is still NOT enabled** — open item since July.

**Typecheck:** `npx tsc --noEmit` shows **5 known pre-existing errors**
(resolve-user, limits, media-memory, next.config, and a `/s` regex in
process-message). Only NEW errors matter.

### Hard-won gotchas

1. **Vercel env vars added through the dashboard UI silently fail to save.**
   Three times this week (`TWILIO_STATUS_CALLBACK_URL`, `REMINDER_DELIVERY_TRACKING`,
   `DASHBOARD_THROTTLE_PEPPER`). Use `npx vercel env add <NAME> production` from the
   CLI, then **verify with `npx vercel env ls` before redeploying**. Each miss cost
   two debugging rounds.
2. **Env vars need a redeploy.** They're baked at build time.
3. **`npx vercel --prod` ships the WORKING DIRECTORY**, not the committed tree.
   Stash unrelated WIP before deploying.
4. **Hand-applied migrations:** Claude Code can't run DDL. Always confirm with a
   `SELECT` that returns the object. Code has shipped against a missing column
   before — only an env gate prevented a repeat-delivery loop.
5. **Agent summaries go stale.** An agent reprinted an old report twice while
   claiming it was fresh. `git diff` is the only trustworthy check.
6. **Twilio template rejections are routine** — expect submit → reject → fix →
   resubmit. Common: missing `{{n}}` sample, "too many variables for its length"
   (fix by lengthening the body).
7. **Three git stashes exist** on gogo-memory-os and are easy to forget:
   `stash@{0}` briefing greeting + TIER 1C calendar-flag fix, `stash@{1}` meeting
   upload timeout, `stash@{2}` Instagram link preview.

---

## 2. Shipped & verified — do not rebuild

### Reliability
- **TIER 1A delivery-truth is LIVE** (10 Aug). `twilio_sid` + `delivery_status` on
  `reminders`, a signature-validated status webhook at
  `/api/webhooks/twilio-status`, gated behind `REMINDER_DELIVERY_TRACKING` and
  `TWILIO_STATUS_CALLBACK_URL`. Verified end to end: a real reminder walked
  `accepted → sent → delivered → read`.
- **Recurring-reminder dedupe** (commit `5e81428`), fail-open.
- **Month-long outage closed** — cron-job.org had auto-disabled the reminders job;
  re-enabled with auto-disable OFF.

### Consent (friend reminders)
- **STOP opt-out shipped and verified** (10 Aug). `reminder_optout` table keyed
  per sender-recipient pair; the gate sits **before `resolveUser`** so a STOP never
  creates a user row or triggers onboarding. Cron skips suppressed reminders and
  **fails closed**. Friend-reminder recipients no longer get broken Done/Snooze
  buttons, and the duplicated "⏰ Reminder" prefix is fixed.

### Routing — four hijacks fixed, all phone-verified
- Nutrition substring (`rice` ⊂ "price"), list `startsWith`, split lazy-prefix
  (`<anything> balance`), and the LLM-driven `show groceries` failure.
- Lists now: normalisation inside `getList` with a legacy fallback, dedupe on
  user lists only (artifact buckets exempt), set-not-flip on check/uncheck,
  deterministic show-matcher that **claims only if the list exists**, plus a
  reserved-name guard (`cards`, `reminders`, `weather`…).

### Dashboard
- Magic-link auth over WhatsApp; **desktop login by 8-char Crockford base32 code**
  with per-IP throttling (verified 11 Aug).
- Four of five surfaces live with real data: **Today** (thread + now-marker +
  filter pills), **Lists**, **Usage** (breath ring), **Calendar**, **You**.
- `/upgrade` IDOR closed.

### Travel
- Flight-ticket parsing → per-leg rows, T-3h + T-24h reminders, morning-brief
  section. **Per-airline check-in window fixed** (Indian carriers 48h, not 24h),
  with fail-safe fallback and the check-in link now included.

### Meter
- Live since 7 Aug. Web search metered. `plan_limits` seeded:
  Free 5 AI/day · Lite ₹99 25/day · Starter ₹149 50/day · Pro ₹199 150/day ·
  Pro-annual ₹1,499. Reminders deliberately **unmetered** under a fair-use ceiling.

---

## 3. The queue

### BLOCKED — waiting on something external

**A. WhatsApp display name.** `AskGogo by Fleetwise` rejected on all three numbers.
Root cause found: Meta checks name-to-legal-entity correlation **and** whether the
name appears on the website — and "Fleetwise" appeared **zero times** on askgogo.in.

- ✅ `index.html` edited (footer now names the entity + registered address). **Held
  pending Gogo confirming the exact legal name** in Meta Business Suite → Business
  info → Business legal name.
- Then: deploy the site, confirm the footer is live, submit exactly **`AskGogo`**.
- ⚠️ Repeated resubmission locks name changes for a week to two months. Check for a
  lockout first.
- **This blocks the 250-business-initiated-messages/24h cap**, which in turn blocks
  friend-to-friend invites and any lifecycle messaging.

**B. Lifecycle mailers.** Blocked on email capture, which is blocked on onboarding.
Full 10-mail Memorae sequence captured and specced (see §3 below).

### READY — in priority order

**1. Dashboard Phase 6 — the four writes.** *Built, not committed.*
Edit reminder, delete reminder, create list, tick/untick item. Includes a shared
`verifySameOrigin` CSRF wrapper, an `updated_at` CAS helper routing all three list
writers, id-scoped reminder services calling `cancelFollowupChain` on delete.
**Next step:** commit, deploy, run the phone-test list — starting with the WhatsApp
list regression (`add milk to grocery`, `done milk`, `clear done`).

**2. Onboarding.** Six docs written (`docs/onboarding/`), plus `REVISION-07` which
supersedes them: **keep the existing branching 1–6 menu**, don't replace it with a
flat list. Migration applied, 539 users backfilled to `complete`. Remaining: fix the
menu content (add travel tickets, drop italics, demote meeting notes), move state
from conversation-string-matching to `onboarding_stage`, point `welcome_menu` at the
good menu, add email capture + first-action acknowledgement, gate `route.ts:266`.

**3. Pricing surfaces.** Two are wrong. `/upgrade` shows a ₹299 plan that doesn't
exist. **The public pricing page is worse** — it advertises per-*month* quotas
(60 AI actions, "5 active reminders") where the meter grants per-*day* (25/day,
unmetered reminders). It under-sells by 10× on the page where people decide to pay.
Also: the free tier exists and 88 users are on it, but appears nowhere.

**4. Dashboard Phase 5c — desktop layouts.** Designed at 1180px (frames 1i, 2a-2e,
3a) but never built; the shell caps at 480px so a laptop shows the mobile column.

**5. TIER 1A Stage 2b.** Daily due-vs-delivered audit **including the unsent-past-due
query** (without it the audit is blind to the outage class it exists to catch),
Telegram as the alert channel instead of freeform WhatsApp, and a Healthchecks.io
heartbeat — which needs the true cron cadence read off cron-job.org first.

**6. Friend-to-friend, v1.** Fully specced from the Memorae teardown. Consent gate
✅ done. Remaining: per-recipient daily cap (2/day), reconcile the two independent
cap systems, dashboard Friends section inside You, graceful non-owner reply to
`done`/`snooze`. **User-to-user needs no new template** — only inviting a non-user
does, which is what's blocked on the display name.

**7. Deferred deliberately:** web-search de-emphasis, gold/silver sanity gate,
gamified learning, the synced dashboard chat widget.

---

## 4. Open bugs

| Bug | Detail |
|---|---|
| **Reminder labels are garbage** | Of 7 active reminders, 4 have broken labels ("reminder at gift", "on at", "Reminder") and two pairs look double-created. Visible on the one screen users check. |
| **Gold/silver prices wrong** | 18K priced above 24K. Scraped from Tavily prose by three regexes with a 40-char jump; 24K and 18K can come from different pages at different scales. No ordering validation. Silver has the same fragility with no invariant to expose it. |
| **"Amex Amex"** | Issuer + card name both render in the cards formatter. Same class as "2 rotis roti". |
| **LLM has no link-state awareness** | A linked user whose phrasing misses a matcher is told to go link their cards. Widening matchers is whack-a-mole; injecting link state into LLM context kills the class. |
| **Non-English voice notes** | Transcripts stay in the original script, so they're invisible to every keyword-routed feature. |
| **`work-life balance`** | Still claimed by bill-split → "No split group found yet". Needs the deferred claim-only-if-serviceable refactor. |
| **Credentials in memories** | The LLM surfaced a stored laptop password in plaintext over WhatsApp. Password vault was a deliberate skip, but users store them anyway. |
| **5 reminders with `sent=true`, `sent_at=null`** | Something marks sent without stamping a timestamp — and Stage 2b's audit keys off `sent_at`, so those rows would be invisible. |
| **`app/page.tsx` is the default Next.js template** | And the WhatsApp link preview still reads "Create Next App". |
| **Harness debt** | `verify-list-routing.mjs` *mirrors* `RESERVED_SHOW_NAMES` instead of importing it. Add a name and forget the test, and it still passes. |
| **Two cap systems** | `lib/data/limits.ts` vs the `plan_limits` table disagree ("Free Beta" vs "Free"). Unreconciled. |
| **Usage ≠ WhatsApp** | The dashboard counts `usage_events`; the WhatsApp reply counts legacy memories + `daily_count`. Two answers to "how much have I used". |

---

## 5. Standing rules

1. **Verify before build.** Read-only investigation first. Every wrong assumption
   this week came from building on one — including "there's no onboarding" when
   three onboarding surfaces already existed.
2. **Migration-first, confirm with a SELECT.** Never trust "migration applied".
3. **Harnesses must model the real pipeline order.** `verify-creditiq-routing`
   passed 22/22 while production was broken, because it tested one layer in
   isolation. `routeFeatureIntent` runs ~253 lines before `detectIntent`.
4. **A feature route may only claim a message if it can service it.** Four bugs of
   this exact class so far. Where the matcher is async and has `telegramId`, do the
   existence check — it's free.
5. **Fail open on non-critical guards; fail closed on consent and auth.** A dedupe
   check must never drop a reminder. A suppression lookup must never send to
   someone who opted out.
6. **Reversible rollouts.** Gate risky changes behind an env var so unsetting
   reverts instantly. Consent gates are the exception — those ship unconditionally.
7. **One flow at a time** for template campaigns. Never submit four at once.
8. **Test on phone.** The real confirmation is always the WhatsApp screenshot.
   Every routing bug this week was found on a phone, not in a test.
9. **Don't let the model do lookups.** `show groceries` failed because the LLM had
   `grocery` in its context, compared it literally, and invented a sentence that
   exists nowhere in the codebase. Every lookup moved into code is one fewer
   confident wrong answer.
10. **Label where commands run** — Claude Code / PowerShell / Supabase SQL editor
    (name the project ref) / phone / Vercel dashboard.

---

## 6. Recommended first move

Commit and ship **Phase 6** — it's built and tested, and the dashboard is read-only
until it lands. Run the WhatsApp list regression first; it's the only test touching
something already working in production.

Then the **display-name resubmission** as soon as the legal name is confirmed —
it's the single item unblocking the most downstream work.
