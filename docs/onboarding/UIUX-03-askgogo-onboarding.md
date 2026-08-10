# UI/UX Brief — AskGogo First-Message Onboarding

**Track:** Onboarding (doc 3 of 6)
**Status:** Draft copy for Gogo to rewrite in his voice
**Date:** 10 Aug 2026
**Reads with:** `PRD-01`, `TRD-02`

---

## 1. The mobile constraint that changes the design

Memorae's capability response is excellent — in a chat widget on a laptop, in a
scrollable panel, with markdown headings and bold runs.

AskGogo's lands in a WhatsApp bubble on a phone. Copied at full length it is
roughly 1,500 characters: eight capabilities, ten examples, a positioning
paragraph. On a 375px screen that is a scroll-and-give-up message, and the ten
examples — the part that actually drives activation — sit below the fold.

**Therefore the response is split across two bubbles:**

- **2a — What I do.** Short. Five capabilities, one line each.
- **2b — Try one of these.** Five examples, sent immediately after.

Five, not ten. Ten reads as a menu to study. Five reads as a nudge to act. The
other five surface later, in message 3, once they have done one thing.

## 2. Tone rules

- Bold for emphasis. **No italics anywhere** — emphasis comes from weight, not
  slant.
- Short lines. One idea per line. Blank lines between them.
- Second person, present tense. "You can…" not "AskGogo enables…"
- Never a feature list disguised as a sentence.
- Name the user where WhatsApp gives us a profile name; omit gracefully if not.
- No exclamation marks beyond one per message.

## 3. Trigger word

**Recommended: `start`**

Short to type, universally understood, and the conventional bootstrap command in
messaging products.

**Why the choice matters less than it looks.** Per TRD §5, *any* unrecognised
message while the user is in `welcomed` state triggers the capability response.
The trigger word is a suggestion, not a gate. A user who types "hi", "ok",
"what can you do", or nothing recognisable gets the same result. And a user who
sends a real command instead gets that command honoured and skips onboarding
entirely.

So the word only needs to be a low-friction default, not a password.

## 4. Copy

### Message 1 — Welcome

Sent on first-ever inbound message.

> Hi {{name}} 👋
>
> I'm AskGogo. I remember things for you — reminders, lists, expenses, tickets —
> and I live right here in WhatsApp. No app to install.
>
> Send **start** and I'll show you what I can do.
>
> You can type or send a voice note. Either works.

Notes:
- `{{name}}` from the WhatsApp profile name, first word only. If absent, drop
  the line to just "Hi 👋".
- The last line is where "offer both voice and text" is delivered. It is one
  line, not a choice the user has to make.
- No feature list here on purpose. One instruction only.

### Message 2a — What I do

> Here's what I'm good at, {{name}}:
>
> **Reminders** — one-off, recurring, or nagging until you actually do it.
>
> **Lists** — groceries, packing, anything you keep re-making.
>
> **Expenses** — tell me what you spent, I'll keep the running total.
>
> **Documents & tickets** — forward me a PDF and I'll pull out what matters.
>
> **Your cards** — if you use CreditIQ, I can show your points and cards here.

Five, each one line. No sub-bullets.

### Message 2b — Try one of these

> Try one of these right now — copy it, or say it as a voice note:
>
> "remind me to drink water in 2 minutes"
>
> "remind me to take my meds every day at 9am"
>
> "add milk to shopping list"
>
> "show my cards"
>
> "gold price"
>
> Pick one and send it. Which shall we do?

Then, as the final line of 2b — the email capture:

> Want this on your laptop too? Sign in at {{dashboard_url}} — takes ten seconds.

### Message 3 — First action done

Sent when the user completes any real action.

> Nice — that's your first one, {{name}}.
>
> Two more worth knowing:
>
> "remind me to renew my card tomorrow at 6pm"
>
> Or forward me a flight ticket PDF and I'll set your check-in reminders
> automatically.

Warm, named, and offers exactly two next steps — not a menu.

## 5. The five examples: verification status

Every phrasing shipped must be proven to route in the **real pipeline order**
(`routeFeatureIntent` → `detectIntent`), not against matchers in isolation.

| Phrasing | Status |
|---|---|
| `remind me to drink water in 2 minutes` | **Verified on phone** 10 Aug |
| `remind me to take my meds every day at 9am` | Recurring path verified 9 Aug; this exact wording needs a re-test |
| `add milk to shopping list` | **Verified on phone** 8 Aug |
| `show my cards` | **Verified on phone** 9 Aug |
| `gold price` | **Verified on phone** 9 Aug — but see §6 |
| `remind me to renew my card tomorrow at 6pm` | **Verified on phone** 9 Aug |

Reserve examples for message 3 and later rotation, all requiring a phone test
before use:

- An expense phrasing — the tracker is live but no exact wording is verified.
  **Do not ship an expense example until one is proven.**
- A flight-ticket forward — the PDF path is verified for storage, but the
  reminder-fire path still needs a future-dated ticket.

**Explicitly excluded:** `my card balance`. It is currently hijacked by the
bill-split handler and returns "No split group found yet." Cannot appear in
onboarding copy until the split-parser A+B fix ships.

## 6. Known defects that touch this copy

| Defect | Effect on onboarding | Action |
|---|---|---|
| `gold price` returns 18K priced above 24K | A new user's first impression includes visibly wrong data | Fix before shipping this example, or swap the example |
| `my card balance` → bill-split dead end | Cannot be used as an example | Excluded above; unblocked when A+B ships |
| Cards formatter renders "Amex Amex" | Visible in the `show my cards` example output | Cosmetic, fix alongside |
| Non-English trigger word won't match | A Hindi/Kannada speaker can't type `start` naturally | Covered by the fallback in TRD §5 — any unrecognised message works |

The first row is the one that matters. `gold price` is a good example precisely
because it is fast and surprising — and it currently returns an impossible
number. Either fix the parser first or replace the example.

## 7. What the user sees, end to end

```
User: hey
  → M1 Welcome                     (stage: null → welcomed)
User: start
  → M2a What I do
  → M2b Try one of these + laptop offer   (stage: welcomed → capability_sent)
User: remind me to drink water in 2 minutes
  → normal reminder confirmation
  → M3 Nice, that's your first one  (stage: → first_action_done)
```

Alternate path — user ignores the trigger and acts immediately:

```
User: hey
  → M1 Welcome                     (stage: null → welcomed)
User: add milk to shopping list
  → normal list confirmation
  → M3 Nice, that's your first one  (stage: → first_action_done)
```

Onboarding never blocks a user who already knows what they want.

## 8. Open for Gogo

1. **Rewrite the copy in your voice.** This is a structural draft. The framing
   ("I remember things for you"), the ordering, and the two-bubble split are the
   parts worth keeping; the words are yours.
2. **Confirm `start`** as the trigger, or pick another.
3. **Decide on `gold price`** — fix the 18K bug first, or swap the example.
4. **Capability ordering.** Reminders first is right. Whether cards belongs in
   the top five for a non-CreditIQ user is a judgement call — it may be better
   shown only to linked users.
