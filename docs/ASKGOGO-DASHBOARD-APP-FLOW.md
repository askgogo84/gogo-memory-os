# AskGogo Dashboard v0 — App Flow
*Doc 3 of 6. Every state below has to exist before the surface ships — the empty and error states are where this product either feels calm or feels broken.*

---

## 1. Entry

There is exactly one way in.

```
User in WhatsApp types:  dashboard
        ↓
Bot replies:  "Here's your dashboard, Gogo — this link works for 15 minutes.
               app.askgogo.in/dashboard?t=…"
        ↓
User taps → token exchanged for session cookie → token burned
        ↓
URL cleaned → /dashboard/today
```

**No session, or an expired/used token:**

> **Your link has expired**
> Links work for 15 minutes and once only.
> [ Get a new link → ] *(wa.me chip, prefills "dashboard")*

Plus the figure, resting. Never a login form, never an error code.

**Returning visit with a valid cookie:** straight to `/dashboard/today`, no interstitial.

---

## 2. Today — the default surface

```
[ Active 4 ]  [ Recurring 2 ]  [ Done ]        ← filter row, orange active pill

💊  Take medicine            Today, 9:00 PM     ✎  🗑
📞  Call Amma                Sun, 6:00 PM  ⟲    ✎  🗑
✈️  Web check-in — AI 983    Tomorrow, 6:40 PM  ✎  🗑

  ⟨ Gogo, remind me to… ⟩                       ← green chip
```

- Emoji comes from the stored reminder emoji; no emoji, no placeholder.
- `⟲` marks recurring.
- **Edit** opens a sheet with label and datetime only. Nothing else is editable in v0.
- **Delete** asks once, inline, no modal. Recurring reminders ask *"Delete this one or the whole series?"* — getting this wrong destroys a routine the user built.

**Empty:** the figure, *"Nothing pending. That's the idea."*, and the chip.

---

## 3. Calendar

```
        ‹   August 2026   ›
   M  T  W  T  F  S  S
                  1  2
   3  4  5  6  7  8  9        ← today circled in orange, dots for events
  …

  Today
  09:00  Standup
  18:40  ✈️ AI 983 to Dubai

  ⟨ Gogo, what's on today? ⟩
```

**Not connected:** the figure and a single **Connect Google Calendar** button with one line of explanation. Never a blank grid — the silent-empty-render is exactly how the old "not connected" bug stayed hidden.

**Connected but no events:** *"Nothing scheduled today."* — different message, different meaning. Don't collapse the two.

**Free plan:** calendar is not included. Show the figure, what it does, and the upgrade line. If the 7-day trial from the pricing PRD is live, show days remaining instead.

---

## 4. Lists

```
  Groceries              4 items    ›
  Packing — Dubai        9 items    ›
  Books to read          2 items    ›

  [ + New list ]
  ⟨ Gogo, add milk to my groceries ⟩
```

Tapping a list expands it inline. Items tick off with a tap; ticked items grey and drop to the bottom. Adding items happens in WhatsApp, via the chip — the only creation in the dashboard is the empty list itself.

**Empty:** figure, *"No lists yet."*, the new-list button, and the chip.

---

## 5. Usage — the conversion surface

```
  Lite · ₹99/month

  AI actions today
  ████████░░░░░░░░  8 / 25

  Documents this month
  ███░░░░░░░░░░░░░  3 / 15

  Friend contacts
  ██░░░░░░░░░░░░░░  1 / 5

  Reminders            Unlimited

  Starter gives you 50 AI actions a day →
```

- Bars fill orange, switch to plum in the final 20%.
- Reminders show the **word** Unlimited, never a bar — a full bar reads as a cap.
- Numbers use tabular figures so they don't jitter.
- Pro and founder tiers show no upgrade line at all.
- **Never shame a high number.** Heavy usage is good news; the copy should read like it.

**Meter unavailable:** *"Couldn't load your usage right now."* and a retry. Never zeros — zeros look like a fact.

---

## 6. You

```
  +91 88845 01501
  Plan            Lite · renews 12 Aug
  Reminders via   WhatsApp
  CreditIQ        Linked ✓
  Calendar        Connected ✓

  [ Sign out ]
```

Deliberately boring. **Sign out** deletes the session row server-side, clears the cookie, and lands on the expired-link screen.

CreditIQ not linked → a chip prefilling `link creditiq`.

---

## 7. Navigation

Bottom tab bar, persistent, five items: **Today · Calendar · Lists · Usage · You**. Active in orange, inactive in ink at 45%. No hamburger, no nested navigation, no back button dependence — every surface is one tap from every other.

---

## 8. Error and edge states

| Situation | Behaviour |
|---|---|
| Session expired mid-session | Redirect to the expired-link screen, keep nothing in memory |
| Supabase read fails | Per-card error with retry; the rest of the page still renders |
| Write fails | Toast, row reverts to its previous state, no silent success |
| Slow load | Float animation, never a spinner or skeleton |
| Reduced motion | Static figure, instant transitions |
| Opened on desktop | Same layout, max-width 480px, centred |

---

## 9. The rule this flow is built on

Every surface answers *"what's true right now?"* and hands anything that would **change** something back to WhatsApp — except the four small writes in the PRD. The moment a form appears that creates content, the control room has become a competing product, and the no-app thesis is gone.
