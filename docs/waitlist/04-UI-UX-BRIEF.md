# 04 — UI/UX brief: askgogo.in waitlist

Visual and interaction spec for the sheet, CTAs, and hero. The **approved mockup governs**
(https://claude.ai/artifact/HQaGjw9gB8gfg3jjU3XXPF); this doc encodes the non-negotiable values.

---

## 1. Palette (light cream only — no dark mode on the marketing site)

| Token | Value | Use |
|---|---|---|
| Background | **`#fbf6ef`** | page + sheet background |
| Ink | **`#221c17`** | all text |
| Orange | **`#F18219`** | primary buttons ("Join Gogo", "Submit") |
| Button text | **ink `#221c17`** | text **on** the orange buttons (not white) |

Only these. No secondary accent colours introduced for the waitlist.

> **Divergence note (grounding):** the product app in this repo uses different tokens — cream
> `#f6f1e8`, ink `#16130f`, orange `#ef7a27`, **and a dark-mode block** (`app/globals.css`
> `@theme` + `@media (prefers-color-scheme: dark)`). The waitlist uses the **brief's exact values
> above**, light-only. If the sheet is ever built inside this repo, it must **not** inherit the
> product dark-mode tokens.

## 2. Type

- **Display:** **Fraunces.** **Body:** **Karla.**
- **NO italic or slanted type anywhere.** No `font-style: italic`, no oblique, no faux-italic.
- **Inputs: font-size ≥16px** (prevents iOS auto-zoom on focus). Body text ≥16px.

> **Divergence note (grounding):** this repo loads **Newsreader (with `style: ["normal","italic"]`)
> and Onest** (`app/layout.tsx:13-23`). Those are the product fonts and include italic. The waitlist
> must load **Fraunces + Karla** and must **not** use the italic axis. If built here, add the fonts
> for the marketing surface; do not reuse Newsreader/Onest for the sheet.

## 3. Responsive form factor

| Breakpoint | Sheet form | Notes |
|---|---|---|
| **<768px (mobile, test at 375px)** | **Bottom sheet** — slides up from the bottom, rounded top corners, over a dimmed backdrop | Primary target. Everything must work at **375px** wide. |
| **≥768px (tablet/desktop)** | **Centred modal** | Same content, centred, with backdrop. |

## 4. Sheet anatomy

- **Backdrop:** dims the site (S1 visible but muted behind). Tap/click closes.
- **Close button:** **≥44px** tap target, top-right, clearly labelled for screen readers
  ("Close waitlist").
- **Title:** short, Fraunces.
- **Fields** (order from 03 §3): country select → WhatsApp number → email → opt-in checkbox → submit
  → consent line → hidden honeypot.
- **Country select:** shows **+91 India (default)** and **+971 UAE**. The number input's expected
  length/placeholder updates with the country (IN: 10 digits; UAE: 9 digits).
- **Opt-in checkbox:** **unticked by default**, label "Message me on WhatsApp when my invite is
  ready."
- **Submit button:** orange `#F18219`, ink text, label **"Join Gogo"**, ≥44px height.
- **Consent line** (under the button, exact): "By joining you agree to our Terms and acknowledge our
  Privacy Policy. You can ask us to delete your details at any time." ("Terms" and "Privacy Policy"
  link to those pages — pages must exist, report Q4.)
- **Honeypot:** visually hidden (not `display:none` only — use an off-screen technique that bots fill
  but AT ignores; `aria-hidden` + `tabindex="-1"` + `autocomplete="off"`), e.g. named `company`.

## 5. Tap targets & inputs

- **Every interactive target ≥44×44px** (close, submit, checkbox hit area, country select, links).
- **All inputs ≥16px** font-size.
- Checkbox: the **label is part of the hit area**.

## 6. Keyboard, focus & a11y

- **Focus trap:** while the sheet is open, Tab/Shift-Tab cycle **within** the sheet only.
- **On open:** focus moves to the first control (country select).
- **Escape** closes the sheet **on desktop**.
- **On close:** focus **returns to the CTA** that opened it (03 §5).
- Sheet is a labelled dialog: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → the title.
- Inline errors are associated with their field (`aria-describedby`) and announced.
- Colour is never the only error signal (icon/text too); contrast of ink on cream and ink on orange
  meets WCAG AA for body text.

## 7. CTAs on the site

- **Header:** a **"Join Gogo"** pill (orange, ink text). Opens the sheet.
- **Hero:** a **"Join Gogo"** button (orange, ink text). Opens the sheet.
- **"Already using AskGogo? Open your dashboard"** — a quiet text link (ink, no orange fill) → 
  `https://app.askgogo.in`. Not a sheet trigger.
- **Rewired ex-WhatsApp CTAs** (02-TRD §2) adopt the "Join Gogo" style and open the sheet.

## 8. Hero layout

- P1 **bold**, P2 and P3 regular (exact copy in 01-PRD §5).
- The word **"email" in P1 is conditionally rendered** — removed if the Gmail check fails at launch
  (01-PRD §5). Author the hero so removing that one word leaves a grammatical sentence:
  "…what you already use: WhatsApp, your calendar and your documents."
- Hero CTA = "Join Gogo" button + the dashboard link beneath/beside it.

## 9. Motion

- Sheet enter/exit: a short slide-up (mobile) / fade-scale (desktop), respecting
  `prefers-reduced-motion` (no transform animation when reduced — just show/hide).

## 10. Explicitly out of scope for the sheet

- No pricing, no plan cards (removed site-wide — 01 §3.5).
- No social-login, no OTP field, no captcha widget (honeypot only at this stage).
