# AskGogo Dashboard — UI/UX Brief
*Doc 4 of 6 for the dashboard track. Written 6 Aug 2026 against the actual logo assets (logo.png, gogo.gif) and the live askgogo.in landing page.*

---

## 1. The idea the design has to carry

Memorae's mascot is a cartoon alien. It's charming and it means nothing.

Yours is a person sitting cross-legged with their eyes closed. **That is the product promise, drawn.** A quiet mind, because something else is holding the list. The logo and the value proposition are the same idea — which is rare, and it's the thing the whole system should be built on.

Practical consequence: **if a screen feels busy, it's wrong**, no matter how good it looks. Calm is a constraint here, not a mood.

---

## 2. Palette

Sampled directly from the logo, not eyeballed.

| Token | Hex | Role |
|---|---|---|
| `--gogo-orange` | `#F18219` | Primary accent. Buttons, active nav, progress fills, focus rings. |
| `--gogo-orange-deep` | `#D67528` | Hover/pressed state for orange. |
| `--gogo-plum` | `#714C77` | Secondary accent. Section headers, category chips, chart secondaries. |
| `--gogo-plum-deep` | `#4D2A50` | Hover/pressed for plum. |
| `--gogo-ink` | `#3E2312` | Body text and headings. Warm near-black from the hair — *not* pure black. |
| `--gogo-sand` | `#E4A97D` | Soft fill. Illustration backdrops, subtle dividers. |
| `--gogo-cream` | `#FDFBF7` | Page background. |
| `--gogo-surface` | `#FFFFFF` | Cards, sheets, inputs. |

Orange and plum together is a genuinely uncommon pairing — warm, Indian, and nothing like Memorae's cool pink-blue gradients. Lean into it rather than softening it toward the usual SaaS blue.

### The green rule (non-negotiable)

WhatsApp green (`#25D366`) is **reserved exclusively for actions that leave the dashboard and open WhatsApp.** Deep-link chips, "Continue in WhatsApp", the sticky chat button. Nothing else on the dashboard is ever green.

This does real work: the user learns in one session that green means *this hands me back to the bot*. It makes the deep-link chips — the mechanism that keeps the dashboard an on-ramp rather than a replacement — legible without a single word of explanation.

---

## 3. Typography

Follow the landing page's structure: high-contrast serif for display, clean sans for everything else.

| Use | Face | Size (375px) | Weight |
|---|---|---|---|
| Page title | Serif display | 28px | 600 |
| Section header | Sans | 17px | 600 |
| Body | Sans | 15px | 400 |
| Meta / timestamps | Sans | 13px | 400, `--gogo-ink` at 60% |
| Numerals (usage meter) | Sans, tabular figures | 32px | 600 |

**No italics anywhere.** Emphasis comes from weight, size, or colour — never slant. This is a standing rule and the live landing page currently breaks it (see §8).

Tabular figures on the usage meter matter more than they sound: without them the counter jitters horizontally as digits change, which reads as instability on a screen whose entire job is to be trusted.

---

## 4. Motion

`gogo.gif` already establishes the rhythm — a slow float with a soft shadow underneath. That bob *is* the motion language.

- Transitions: **400–600ms**, gentle ease-in-out. Deliberately slower than typical UI.
- Loading: the float animation, not a spinner. A spinner says "waiting"; the float says "resting".
- Never bounce, never snap, never spring. Those are energetic; the brand is settled.
- Respect `prefers-reduced-motion` — drop to a static figure and instant transitions.

---

## 5. Where the figure appears

Memorae's blob floats over every screen and follows you around. After a day it reads as clingy. Yours sits quietly.

**Show the figure:** empty states (no reminders, no lists, no events), loading states, the post-onboarding welcome, and the run-out / upgrade moment.

**Never:** as a persistent floating button, as a per-row avatar, or on any screen that already has content. When there's something to look at, the figure steps back.

**Use the figure alone**, without the circular border and "AI Assistant Bot" wordmark from `logo.png`. That lockup is built for a WhatsApp avatar at 96px; the ring and subtext turn to mud anywhere smaller and add nothing inside an app that's already branded.

---

## 6. Layout

Mobile-first, designed at **375px**, tested there before anything else. Touch targets 44px minimum.

- Bottom tab bar, five items: **Today · Calendar · Lists · Usage · You**. Active tab in `--gogo-orange`, inactive in ink at 45%.
- Single-column card stack. Card radius 16px, 1px border at ink/8%, no drop shadows — shadows fight the calm.
- 20px page padding, 16px between cards, 12px inside them.
- One primary action per screen. If a screen needs two, it's two screens.

### Deep-link chips

Under each card, one or two green pill chips carrying a prefilled WhatsApp message:

> `Gogo, remind me to…`  `Gogo, add to my list…`

These are the most important component on the dashboard. They're what makes it feed the bot instead of competing with it, and they're the reason the no-app thesis survives having a web app.

---

## 7. Screen-by-screen notes

**Reminders** — filter row (Active / Recurring / Done), then the list. Each row: emoji, label, time, edit and delete. Empty state gets the figure and one chip.

**Calendar** — month grid, today circled in orange, dots for events. Not connected yet → the figure plus a single connect button, never a silent empty grid. (The old "not connected" bug hid precisely because the section rendered blank instead of saying anything.)

**Lists** — list of lists, tap to expand. Create via chip, not a form.

**Usage** — the conversion surface. Three progress bars: AI actions today, documents this month, friend contacts. Reminders shown as the word **Unlimited**, not a full bar — a full bar looks like a cap. Bars fill orange, turn plum in the last 20%. Plan name and, if not on Pro, one upgrade line beneath.

**Profile** — phone, plan, notification channel, CreditIQ link status, sign out. Boring on purpose.

---

## 8. Two inconsistencies to fix while you're here

**Italics on the live landing page.** The hero sets "lives inside" in an italic script serif — the exact italicised-word-in-headline device that's meant to be off-limits. Either set it upright in the same serif, or differentiate with weight. It's the first thing a visitor reads and it contradicts the house rule.

**Three different prices are live simultaneously.** The landing page says *from ₹99/month*, `app.askgogo.in/upgrade` offers a single *₹299/month Pro* with feature language ("unlimited messages, 500 memories") predating the unit model, and the meter's run-out message says *Lite ₹99 gives you 25 a day*. A user who hits the wall reads ₹99, taps through, lands on ₹299. Whatever the dashboard does, the upgrade page has to be rebuilt against `plan_limits` before the meter is doing real work.
