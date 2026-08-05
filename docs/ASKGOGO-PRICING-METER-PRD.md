# AskGogo — Unit-Based Pricing & Usage Meter (PRD)
*Doc 1 of 3 for the pricing/meter track. Decided 5 Aug 2026. Sibling docs: Backend Schema, Implementation Plan.*

---

## 1. Why

Time-based tiers ("₹99/month") price the calendar, not the cost. AskGogo's real marginal costs are LLM calls, document parsing, and Twilio Utility messages — all elastic, all per-action. Unit-based plans:

- align price with actual cost per user,
- make the value legible ("25 AI actions a day" beats "Pro"),
- give the dashboard a conversion surface (the meter card),
- match the model already decided for CreditIQ, so one billing brain serves the holdco.

**Competitive note:** Memorae already ships legible unit counters in-product (*"Your Friends 0/20 · 20 left"*, *"Daily reminders 0/10 · 10 left"*). Users read this format fine. This is not an experiment.

---

## 2. The core rule

> **Meter what is expensive and elastic. Never meter the habit.**

Reminders are the habit-forming action and the entire retention story. A user who pauses to think *"should I spend a reminder on this?"* has lost the reflex the product exists to build — and that user is the power user who would have renewed. Reminders are therefore **unmetered**, protected only by an anti-abuse fair-use ceiling that no genuine human hits.

---

## 3. Counters

Exactly **three** metered counters, plus one unmetered ceiling.

| Counter | Reset | What decrements it |
|---|---|---|
| **AI actions** | Daily, midnight IST | Web search, translation, ask-anything/general LLM answer, image classification, on-demand briefing, voice transcription→intent |
| **Documents** | Monthly, 1st IST | Flight ticket parse (PDF or image), statement parse, receipt/expense-doc parse |
| **Friend contacts** | Standing (not a reset counter — a ceiling on active contacts) | Number of saved friend-reminder contacts |
| *Reminders (unmetered)* | Daily fair-use ceiling | Personal reminder creation |

**Why friend contacts get their own counter:** it is the spam/abuse vector, and every friend reminder is a Twilio message delivered to a number that is not paying. Memorae caps this for the same reason.

**Definition of a billable action:** anything that triggers an LLM call or a paid third-party API pull. Page views, dashboard reads, reminder fires, list reads, cached/DB reads, and webhook button taps **never** decrement anything.

---

## 4. Tiers

Mapped onto the **existing Razorpay live plans** — no new price points, no Razorpay rework.

| | **Free** | **Lite ₹99** | **Starter ₹149** | **Pro ₹199** *(annual ₹1,499)* |
|---|---|---|---|---|
| Personal reminders | Unlimited *(fair use 20/day)* | Unlimited *(30/day)* | Unlimited *(50/day)* | Unlimited *(50/day)* |
| AI actions / day | 5 | 25 | 50 | 150 |
| Documents / month | 3 | 15 | 40 | Unlimited *(fair use 200)* |
| Friend contacts | 0 | 5 | 10 | 20 |
| **Calendar integration** | **None** | 1 calendar | 2 calendars | Multi-calendar |
| Morning briefing | Yes | Yes | Yes | Yes |
| CreditIQ link | Yes | Yes | Yes | Yes |

Free tier is selectable at signup. **No paywall before the product** — the meter is visible from the first message; paid tiers appear only when an allowance runs out.

---

## 5. ⚠️ Open decision: calendar on Free

Gogo's call: Free gets **no** calendar integration. That is defensible — calendar is a genuine cost centre (OAuth, token refresh, sync jobs) and a clean upgrade trigger.

**The knock-on to resolve before build:** the onboarding quiz's final card is *"Connect Google Calendar"*. If free users cannot connect, that card becomes a paywall at minute one of the first session — the exact moment activation is most fragile. Three ways out:

- **(a) Recommended — 7-day calendar trial on Free.** Card 4 connects normally, works for a week, then the morning brief says *"Your calendar sync paused — Lite keeps it running."* Preserves activation, creates a warm upgrade moment with real loss aversion, no paywall in onboarding.
- **(b) Move the card.** Onboarding ends at the WhatsApp deep-link; calendar connect is offered later from the dashboard, gated. Simplest, but drops the connect step from onboarding entirely.
- **(c) Straight gate.** Card 4 shows a lock and an upgrade CTA. Highest friction, lowest activation. Not recommended.

**Default if unanswered: (a).** Flagged here because it changes the onboarding flow doc and the entitlement check.

---

## 6. Two meters, not one

This matters more than it looks. AskGogo and CreditIQ live in **different Supabase projects**:

- Bot runtime DB — `qenhjcooyecmatwducpu`
- CreditIQ consumer DB — `yazpphublutdodahfwvr`

CreditIQ's meter decision says quota spans *both* surfaces. So:

| Action origin | Which meter |
|---|---|
| WhatsApp message that triggers a **CreditIQ** billable op (card advice, flight search, points optimizer) | **CreditIQ meter** in `yazpphublutdodahfwvr`, called over HTTP with `x-wa-secret` — same pattern as `/api/wa/portfolio` |
| WhatsApp message that triggers an **AskGogo** billable op (web search, translate, doc parse, general LLM) | **AskGogo meter** in `qenhjcooyecmatwducpu`, local |
| Anything reminder-related | Neither |

**Hard rule: one action decrements exactly one counter.** The router decides by handler ownership, before the call is made. Double-charging a linked user is the worst possible bug here — it makes both products look dishonest at once.

Both meters use the same code pattern and identical error semantics. They are not a shared service.

---

## 7. Failure semantics

- The **product meter fails CLOSED** with an honest error: *"I couldn't verify your allowance right now — try again in a moment."* Never *"limit reached"* when the truth is that the check itself broke.
- The **abuse limiter fails OPEN** — a rate-limit query that errors must never drop a message.
- A **reminder must never be dropped by a meter error**, under any circumstance. Reminders are unmetered; if meter code ever appears in the reminder send path, that is a bug.

---

## 8. What the user sees

**When allowance runs low (last 20%):** a one-line footer on the next relevant reply — *"3 AI actions left today."* Not on every message.

**When it runs out:** honest, specific, one upgrade link.
> "You've used all 5 AI actions for today, Gogo — they reset at midnight. Lite (₹99) gives you 25 a day: app.askgogo.in/plans"

**In the dashboard:** a usage card with three progress bars (AI actions today / documents this month / friend contacts), reminders shown as *"Unlimited"*. This is the primary conversion surface — it earns its place on the dashboard home, above the fold.

Copy rule: never shame the user for hitting a cap. They used the product a lot; that is good news.

---

## 9. Before the numbers are locked

Two inputs to verify — I am not certain of current rates and they have moved before:

1. **Twilio / Meta India Utility-template per-message rate.** Multiply by the fair-use reminder ceiling to get the true floor cost of "unlimited reminders." That number decides whether unlimited is safe at ₹99.
2. **Per-action LLM cost** for each AI-action type at current model pricing (Haiku vs Sonnet paths differ by roughly an order of magnitude). The 150/day Pro allowance is the one to sanity-check.

If either comes back worse than expected, adjust the *allowances*, not the price points — the Razorpay plans are already live.

---

## 10. Success criteria

- No user is ever billed twice for one action.
- No reminder is ever dropped by meter code.
- Free→Lite conversion happens at the meter card or the run-out message, not at a wall.
- Meter state is identical whether the user checks it on WhatsApp or the dashboard.
