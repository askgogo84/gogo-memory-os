# AskGogo Dashboard v0 — PRD
*Doc 1 of 6 for the dashboard track. 7 Aug 2026. Siblings: TRD, App Flow, UI/UX Brief, Backend Schema, Implementation Plan.*

---

## 1. What this is, and what it must not become

A **control room** for the WhatsApp assistant. Not a second product.

Memorae built the full web app — Dashboard, Friends, Reminders, Calendars, Lists, Boards, a Portal world map, breathing exercises, Memory Bubbles, a 21-video onboarding checklist. They can afford that because they're an app-first company charging ₹650/month.

AskGogo's entire thesis is **no new app**. A dashboard that competes with the chat destroys the thesis. So the design rule is:

> Every screen either shows the user something the chat can't show well, or hands them back to the chat.

The mechanism for the second half is **WhatsApp prefill deep-link chips** on every card. The dashboard is an on-ramp, not a replacement.

---

## 2. Who uses it and why

One user type: an existing AskGogo user on a phone. There is no signup here — you cannot become an AskGogo user via the dashboard, only via WhatsApp.

Three real jobs the chat does badly:

1. **See everything at once.** Scrolling a WhatsApp thread to find what's pending is miserable. A list is better.
2. **Bulk edit.** Deleting six stale reminders takes six conversations. A list with delete buttons takes twenty seconds.
3. **Know where you stand.** Usage against allowance, plan, connection status. The chat can answer it, but it can't *show* it — and this is the upgrade surface.

---

## 3. Scope — five surfaces, read-mostly

| Surface | Read | Write |
|---|---|---|
| **Reminders** | List, filter Active / Recurring / Done | Edit time+label, delete |
| **Calendar** | Month grid, events, connection status | Connect / disconnect Google |
| **Lists** | Lists and their items | Create list, tick item, delete |
| **Usage** | AI actions today, documents this month, friend contacts, plan | — |
| **Profile** | Phone, plan, notification channel, CreditIQ link status | Sign out |

**Creation happens in WhatsApp**, via chips, not via forms in the dashboard. This is deliberate: forms are how a control room turns into a product. The one exception is creating an empty list, because that's a container rather than content.

### Explicitly out of scope for v0

Portal / world map, boards, breathing, memory bubbles, friend management, an onboarding checklist, in-dashboard chat, notifications, and any form that creates a reminder. Several of these may be worth building later; none of them are worth building first.

---

## 4. The decision everything depends on: authentication

AskGogo users have no password, no email on file in most cases, and no login. The current `app.askgogo.in/upgrade?id=<telegramId>` pattern treats a **guessable** id as a credential — WhatsApp ids are the last nine digits of the phone, negated — which is an open IDOR that leaks the user's stored name into a Razorpay checkout.

The dashboard cannot repeat that.

**Decision: magic link delivered over WhatsApp.**

The user types `dashboard` to the bot. The bot replies with a link carrying a single-use, short-lived, cryptographically random token. Opening it exchanges the token for an httpOnly session cookie and burns the token.

Why this is the right fit rather than a compromise:

- **The channel is already authenticated.** Only the owner of that WhatsApp number receives the message. No OTP SMS cost, no password to store or reset, no email needed.
- **It reuses a pattern already proven in this codebase** — the CreditIQ link handshake is the same shape: code issued in one channel, redeemed in another, single-use, throttled.
- **It fixes `/upgrade` at the same time.** Once sessions exist, the upgrade page reads identity from the cookie instead of a query parameter, and the IDOR is closed rather than mitigated.

No passwords are stored. No third-party auth provider is added.

---

## 5. Success criteria

- A user can go from "what's pending?" to seeing every active reminder in under ten seconds.
- Every card offers a chip that returns them to WhatsApp with the message prefilled.
- The usage card is the only upgrade prompt in the product that doesn't interrupt anything.
- No page in the dashboard can be opened for another user's account by editing a URL.
- Works at 375px before it works anywhere else.

## 6. Non-goals worth stating

- Not a place to sign up.
- Not a place to have a conversation.
- Not a place to create reminders.
- Not a desktop product. Desktop is a wider phone.

---

## 7. Dependencies

- The usage card needs `lib/services/meter.ts` (built, Phase 2) and `METER_ENABLED` actually working — currently unresolved.
- The plan display and any upgrade CTA need the upgrade page rebuilt against `plan_limits`. Three prices are live simultaneously today (₹99 on the landing page, ₹299 on `/upgrade`, ₹99 Lite in the meter's run-out copy).
- The calendar surface will expose the existing "not connected" bug rather than fix it. That's a feature — it stops the failure being silent.
