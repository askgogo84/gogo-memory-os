# AskGogo Dashboard — Design Brief

For Claude Design. Everything needed to work on the dashboard without further
context.

---

## 1. What AskGogo is

A personal assistant that lives entirely inside WhatsApp. No app to install.
Users text or send voice notes — in English, Hindi, Hinglish, Kannada, Tamil,
Telugu or Malayalam — and it handles reminders, notes and memory, lists,
expenses and bill splitting, travel tickets, meeting notes, saved content, and a
daily briefing.

India-first. Bengaluru-based. Roughly 540 registered users, ~10 genuinely active.
Pricing: free tier, then ₹99 / ₹149 / ₹199 per month.

**The dashboard is not the product.** WhatsApp is. The dashboard exists so people
can see their data on a laptop and act on it — every card carries a WhatsApp
deep-link chip that opens the conversation with a message pre-filled. It is an
on-ramp to the bot, never a replacement for it. That constraint is deliberate
and must survive any redesign.

## 2. The brand

**Logo/mascot:** a seated meditating figure, warm and calm rather than techy.
There is also a slow float/bob animation of the same figure.

**Palette** (sampled from the artwork):

| Token | Hex | Use |
|---|---|---|
| Orange | `#F18219` | primary accent, the now-marker, active states |
| Orange deep | `#D67528` | pressed/hover |
| Plum purple | `#714C77` | secondary accent, upcoming states |
| Plum deep | `#4D2A50` | |
| Ink | `#3E2312` | body text, warm brown not black |
| Sand | `#E4A97D` | |
| Background | cream | never white, never dark |

**Type:** Fraunces (display) + Karla (body). Chosen specifically to avoid the
Playfair/Inter default look.

**Icons:** a custom hand-drawn SVG set built from the product's own vocabulary,
not a library — Today is the thread with its now-marker, Usage is the breath-ring
arc, You is a seated silhouette, Lists is one item ticked with the last faded,
Calendar is a single date rather than a dot grid.

## 3. Hard constraints

These are non-negotiable and pre-existing:

- **Light theme only.** Cream and white backgrounds, dark text. No dark mode, no
  dark-glass surfaces.
- **Mobile-first, tested at 375px.** Desktop is secondary. Anything that only
  works on a laptop is wrong.
- **No italics or slanted type anywhere.** Emphasis comes from weight, size or
  colour. This includes the italicised-word-in-a-headline device and any
  script/handwritten annotation faces.
- **Tailwind v4, CSS-first.** No `tailwind.config.js` — the palette lives in an
  `@theme inline` block in `app/globals.css`.
- Respect `prefers-reduced-motion`. Respect `env(safe-area-inset-bottom)`.

## 4. Information architecture

Five tabs, locked: **today / calendar / lists / usage / you**

Routes are `/dashboard/{today,calendar,lists,usage,you}`. Auth is a magic link
sent over WhatsApp — the user texts `dashboard`, gets a single-use link, and
lands signed in. There is no password anywhere in the product.

### Two signature devices already established

**The day as a thread.** Today is a *time* view, not a list. Reminders sit on a
vertical time spine with an orange `now` marker, and the gap after it is spoken
aloud — "Nothing for the next two hours." This is why the tab is called Today
rather than Reminders. Past items are struck and muted; upcoming carry a plum
ring. Runs of identical repeating reminders collapse into one node labelled
"Hourly · 5 done today".

**The mascot is the meter.** On Usage, the meditating figure sits *inside* a
breath ring, floating. The mascot isn't decoration there — it's the gauge.

Both devices should survive and, ideally, be extended.

## 5. Current state

| Surface | State |
|---|---|
| Auth (magic link) | Shipped, verified in production |
| Shell, tab bar, tokens | Shipped |
| **Today** | Shipped with real data, verified on a phone |
| **Lists** | Shipped with real data |
| **Calendar** | Placeholder |
| **Usage** | Placeholder |
| **You** | Placeholder |
| Any write action | Not built — the dashboard is currently read-only |

Two existing mockups to work from, both self-contained HTML at 375px:

- `docs/askgogo-dashboard-mockup.html` — the original visual direction
- `docs/askgogo-today-v2-mockup.html` — a later pass adding a greeting, filter
  pills with counts, and summary rows

## 6. The actual problem to solve

The owner's words, twice, comparing side by side with a competitor (Memorae):
*"memorae looks very polished"* and *"our dashboard looks very simple and
minimal."*

My read, which the design should test rather than accept: **the problem is
emptiness, not minimalism.** The competitor feels full through two different
mechanisms, and only one of them is worth copying.

**Decoration** — photographic header bands on every card, the mascot repeated on
every screen, search and sort controls over three items, a gamified progress
checklist. This is what makes theirs feel busy. It is padding.

**Aggregation** — a home screen that stacks Reminders / Calendar / Lists / Tasks
cards, each with a count, a one-line preview and two prefill chips; filter pills
carrying counts; a greeting by name. This is what makes theirs feel *inhabited*,
and it is genuinely worth taking.

The brief is to make AskGogo's dashboard feel inhabited without becoming busy.

**Deliberately refused so far, and I'd keep refusing:** header images on cards,
the figure repeated per screen, search and sort over three items, an onboarding
progress checklist.

## 7. What each surface needs

**Today** — has real data and works. Needs the v2 additions: a Fraunces greeting
with the date, filter pills carrying counts (Today 4 · Recurring 2 · Done 9),
and below the thread a short "the rest of today" section with one row each for
Lists, Usage and Calendar — icon, title, one fact line, and a small WhatsApp chip
on the right.

**Lists** — has real data. One row per list, tap to expand. Long lists cap at ten
items with a "Show all 147" affordance. Needs visual work; it's currently plain.

**Calendar** — placeholder. Google Calendar connect, then today's events. Needs a
connected state, a not-connected state, and an empty-day state.

**Usage** — placeholder. The breath ring with the figure inside, showing AI
actions used today against the plan allowance, plus documents this month and
friend contacts. Needs to communicate a limit without feeling punitive.

**You** — placeholder. Name, plan, linked accounts (Google Calendar, Gmail,
CreditIQ), sign out. The least interesting surface; keep it quiet.

## 8. Empty states matter more than usual

Most users have little data. Every surface needs an empty state that is warm
rather than apologetic — the figure, one line of copy, and a WhatsApp chip
pre-filled with the command that would create the first item ("Gogo, remind me
to…").

The existing set: Today (figure + chip + identity line), Usage (figure + chip),
You (figure, no chip), Calendar (figure + connect action).

## 9. Motion

Established and worth matching: the tab bar's active icon lifts 2px on an
overshoot curve, fades 38%→100%, turns orange, with a 4px dot scaling in
beneath. 350–450ms, tuned to match the mascot's float. Soft upward shadow.
Reduced-motion respected.

Calm rather than snappy. The product's whole tone is "I've got this, relax."

## 10. What I'd most like from this work

1. A visual system for the three placeholder surfaces that matches Today and
   Lists rather than inventing a second language.
2. An answer to "inhabited without busy" — specifically for Today, since it's
   the landing surface.
3. The Usage breath ring designed properly. It's the most distinctive idea in
   the product and it currently doesn't exist beyond a mockup.
4. Empty states that make a nearly-empty account feel like a beginning rather
   than a failure.

## 11. Reference material being supplied separately

Screenshots of the competitor's dashboard (Memorae). Use them to understand what
"polished" means to the owner — but note the deliberate divergences: theirs is
dark-glass, desktop-shaped, has a cursor-following avatar, and pads with
decoration. AskGogo is light, mobile-first, and should earn its density from
real content.
