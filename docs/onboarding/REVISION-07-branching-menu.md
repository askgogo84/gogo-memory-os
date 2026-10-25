# REVISION 07 — Keep the branching menu

**Track:** Onboarding (supersedes parts of docs 01–06)
**Status:** Authoritative. Read this before building from any doc in this folder.
**Date:** 10 Aug 2026

---

## 0. Why this exists

Docs 01–06 were written on a false premise: that AskGogo has no onboarding. It
does. `buildOnboardingMenu` (`lib/bot/handlers/onboarding.ts:14-33`) fires for
every new user at `app/api/webhooks/whatsapp/route.ts:266` and asks "What do you
need most?" with a numbered 1–6 menu.

That menu is **better** than what UIUX-03 proposed. Branching means a user sees
examples for the thing they actually came for. A flat five-capability list is a
downgrade, and adopting it would have deleted a working personalisation quiz.

**Decision: keep the branching menu. Fix its content, its state, and what's
missing around it.**

## 1. What changes in each doc

| Doc | Status | Correction |
|---|---|---|
| PRD-01 | §1 wrong | "A brand-new user gets nothing" is false. Three welcome surfaces already exist: `buildOnboardingMenu`, `buildOnboardingFollowup`, and `buildWelcomeReply` via `welcome_menu`. This is a replacement track, not greenfield. Goals and metrics in §2 stand |
| TRD-02 | mostly stands | §2 pipeline placement, §3 state design, §9 gate all stand. §4 trigger word is now secondary — the menu reply (a digit) is the primary interaction. Add: the state machine must gate or remove `route.ts:266`, `route.ts:944-956`, and the reset command at `:960`, or two welcomes stack |
| UIUX-03 | **superseded by §3 below** | The flat M2a/M2b five-capability design is dropped entirely |
| APPFLOW-04 | amended | Add a `menu_sent` state and an option-pick branch. Everything in §3 (branch cases), §6 (fail-open) and §7 (test matrix) stands and still applies |
| SCHEMA-05 | stands | Columns, migration and backfill are unaffected. Already applied — 539 users stamped `complete` |
| IMPL-06 | amended | Phase C changes shape per §4 below. Phases A and B are done |

## 2. What is actually wrong with the existing flow

1. **State is a string match.** `route.ts:944-956` decides "is this a menu reply?"
   by scanning the last three assistant messages for the literal text
   "What do you need most?". Brittle in exactly the way that fails silently.
   Replacing it with `onboarding_stage` is the real win of this track.
2. **Menu content is stale.** Option 2 leads with meeting notes, which needs a
   browser recorder — a poor first action. Travel tickets, the strongest
   cold-start hook, is absent. Option 6 promises "everything" and lists nine
   capabilities when twenty-two ship.
3. **Italics**, against the standing typography rule.
4. **`buildWelcomeReply` is stateless** — the ~1,500-character single bubble
   fires every time any of 539 existing users types "hey", forever.
5. **No email capture**, which blocks the entire mailer track.
6. **No first-action acknowledgement.**

## 3. Replacement copy

Bold via WhatsApp asterisks. **No italics anywhere.** Short lines, one idea each.

### M1 — the menu

Replaces `buildOnboardingMenu`. Fires once, for a genuinely new user.

> 👋 Hey {{name}}, I'm AskGogo.
>
> Your assistant inside WhatsApp. Type or send a voice note — English, Hindi,
> Kannada, Tamil, Telugu or Malayalam.
>
> What do you need most?
>
> 1️⃣ *Reminders & follow-ups*
> 2️⃣ *Notes & memory* — save anything, find it later
> 3️⃣ *Expenses & splitting*
> 4️⃣ *Travel tickets* — forward one, get check-in reminders
> 5️⃣ *Save content* — reels, articles, YouTube
> 6️⃣ *Show me everything*
>
> Reply with a number, or just tell me what you need.

Changes from today's menu: travel tickets added at 4; notes & memory promoted
from 5 to 2; meeting notes demoted into option 6; italics removed; the last line
added so a user who ignores the numbers isn't stuck.

### M2 — the per-option quick-starts

Each is one bubble: two or three exact phrasings, then one line inviting them to
send one. Every phrasing must pass the routing harness before it ships.

**1 — Reminders**

> Easiest thing I do. Try one of these:
>
> "remind me to drink water in 2 minutes"
> "remind me to take my meds every day at 9am"
> "follow up with Rahul in 3 days"
>
> Send one and I'll set it. I'll nag you until it's done if you want.

**2 — Notes & memory**

> Tell me once, ask me any time. Try:
>
> "remember that Rahul's birthday is 12 March"
> "what do I know about Rahul?"
>
> You can send me a photo of a receipt or a whiteboard too — I'll read it.

**3 — Expenses & splitting**

> Track what you spend without opening an app:
>
> "spent 450 on lunch"
> "expenses today"
>
> Splitting a trip? "create trip Goa with Rahul, Priya, Meera"

**4 — Travel tickets**

> Forward me a flight ticket — PDF or screenshot — and I'll pull out the details
> and set your reminders automatically.
>
> You'll get a nudge when web check-in opens, and again 3 hours before departure.
>
> Try it with your next trip.

**5 — Save content**

> Send me any link and I'll keep it:
>
> Instagram reels, YouTube videos, LinkedIn posts, articles.
>
> Ask "what did I save about X?" later and I'll find it.

**6 — Show me everything**

> The full list. Reminders and follow-ups. Notes and memory. Lists. Expenses and
> splitting. Travel tickets. Meeting notes and transcription. Save content.
> Daily briefing. Weather. Nutrition. Sports. Web search. Contacts. News.
>
> Connect Google Calendar or Gmail and I'll handle your schedule and inbox too.
>
> Pick anything and just ask.

### The email-capture line

Appended to whichever M2 the user receives:

> Want this on your laptop too? Sign in at {{dashboard_url}} — takes ten seconds.

### M3 — first action done

Fires on the first real action (reminder, list, expense, memory, parsed ticket).
Not on a search or a conversational reply.

> Nice — that's your first one, {{name}}.
>
> One more worth knowing: forward me a flight ticket and I'll set your check-in
> reminders automatically.

### `welcome_menu` for existing users

`hi / hello / hey / start / /start` from anyone past onboarding returns **M1**,
minus the "Hey, I'm AskGogo" introduction. Not `buildWelcomeReply`.

This is the change that helps all 539 existing users today.

## 4. Revised Phase C

1. Rewrite `buildOnboardingMenu` to the M1 copy above.
2. Rewrite the six `buildOnboardingFollowup` branches to the M2 copy above.
3. Replace the conversation-history string match at `route.ts:944-956` with
   `onboarding_stage`. States: `null` → `menu_sent` → `option_picked` →
   `first_action_done` → `complete`.
4. Point `welcome_menu` (`process-message.ts:601`) at M1 instead of
   `buildWelcomeReply`.
5. Append the email-capture line to each M2.
6. Add M3 on first real action.
7. Gate the whole thing on `ONBOARDING_ENABLED`; unset reverts to today.

`lib/bot/onboarding-copy.ts` from Phase B needs rewriting to this shape — its
current exports (`CAPABILITIES`, `EXAMPLES`) describe the dropped flat design.

## 5. Verification before ship

- Every phrasing in §3 passes `verify-onboarding-examples.mjs` against the real
  two-stage pipeline order. Several are new and unverified: the memory
  phrasings, the expense phrasings, and "follow up with Rahul in 3 days".
- `my card balance` stays out until the bill-split fix ships.
- `gold price` stays out until the 18K-above-24K bug is fixed.
- Option 4's promise is only honest now that the per-airline check-in window is
  fixed — and that fix is itself unverified until a future-dated ticket is
  forwarded.
- The full test matrix in APPFLOW-04 §7, especially row 8: no existing user
  receives an onboarding message.
