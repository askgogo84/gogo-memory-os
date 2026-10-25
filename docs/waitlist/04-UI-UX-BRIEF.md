# 04 — UI/UX brief: askgogo.in waitlist sheet

Visual + interaction spec for the sheet, CTAs, and hero copy placement. **Flow, fields and copy come
from the mockup; fonts and colours come from the live `askgogo.in` (survey 1e), NOT the mockup's
Fraunces/orange.** The sheet must feel native to the immersive page.

---

## 1. Palette (from the live site — `part-00.htmlfrag`)

| Token | Value | Use |
|---|---|---|
| Cream | **`#F6F1E8`** | sheet background |
| Ink | **`#16130F`** | text; dark pill background |
| Teal | **`#157A6E`** | **primary button ("Join Gogo")**, link hover — matches the hero "Meet Gogo" CTA (`part-00.htmlfrag:94`) |
| Cream-on-dark | **`#F6F1E8`** | text on the ink/teal buttons |
| Muted | **`#5C554C`** | secondary text, consent line |
| Section alt | **`#EFE8DC`** | optional sheet header band |
| White | **`#FFFFFF`** | input fields / cards |
| Orange | **`#EF7A27`** | tiny accents only (dots), not buttons |

Primary CTA = **teal `#157A6E` fill, cream text** (site convention). Do **not** introduce the
mockup's `#F18219` orange or make buttons orange.

## 2. Type (from the live site)

- **Display/headings:** **Newsreader** (serif). **Body/labels/inputs:** **Onest** (sans). Both are
  already loaded (`part-00.htmlfrag:40`); the sheet reuses them (no new font load needed).
- **NO italic or slanted type anywhere in the sheet.** The surrounding site uses `<em>` italics
  (`part-00.htmlfrag:91,118`); the **sheet must not** — no `font-style:italic`, no oblique, no
  faux-italic. (This is the one deliberate departure from the site's own style.)
- **Inputs ≥16px** font-size (prevents iOS zoom). Body ≥16px.

## 3. Responsive form factor

| Breakpoint | Form | Notes |
|---|---|---|
| **<768px (test at 375px)** | **Bottom sheet** — slides up, rounded top, dimmed backdrop | Primary target; everything works at 375px |
| **≥768px** | **Centred modal** | same content, centred, backdrop |

## 4. Sheet anatomy

- **Backdrop:** dims S1 (the immersive page visible but muted); tap/click closes.
- **Close button:** **≥44px**, top-right, `aria-label="Close waitlist"`.
- **Title:** short, Newsreader.
- **Fields (order, 03 §3):** country select → WhatsApp number → email → opt-in checkbox → submit →
  consent line → hidden honeypot.
- **Country select:** **+91 India (default)**, **+971 UAE**; the number field's placeholder/expected
  length follows the country (IN 10 / UAE 9).
- **Opt-in checkbox:** **unticked by default**, label "Message me on WhatsApp when my invite is
  ready."
- **Submit:** teal `#157A6E`, cream text, label **"Join Gogo"**, ≥44px height.
- **Consent line** (under the button, exact): "By joining you agree to our Terms and acknowledge our
  Privacy Policy. You can ask us to delete your details at any time." — **Terms** →
  `https://askgogo.in/terms/`, **Privacy Policy** → `https://askgogo.in/privacy/`.
- **Honeypot:** visually hidden but bot-fillable (`aria-hidden`, `tabindex=-1`, `autocomplete=off`,
  off-screen), name e.g. `company`.

## 5. Tap targets & inputs

- **Every interactive target ≥44×44px** (close, submit, checkbox hit area incl. label, country
  select, links). **All inputs ≥16px.**

## 6. Keyboard, focus & a11y

- **Focus trap** inside the sheet while open; **on open** focus → country select; **Escape** closes
  (desktop); **on close** focus returns to the invoking CTA.
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → title.
- Inline errors `aria-describedby` their field, announced; error state not signalled by colour alone.
- Respect `prefers-reduced-motion` (no transform animation when reduced).
- Contrast: ink-on-cream and cream-on-teal meet WCAG AA for the sizes used.

## 7. CTAs on the site (site repo)

- **Header:** "Join Gogo" pill (replaces "Talk to Gogo" style at `part-00.htmlfrag:64`) — opens sheet.
- **Hero:** "Join Gogo" button (replaces "Meet Gogo" at `part-00.htmlfrag:94`) — opens sheet.
- **Menu drawer:** "Join Gogo" (replaces "Talk to Gogo" at `part-00.htmlfrag:80`) — opens sheet.
- **"Open dashboard"** (`part-00.htmlfrag:63,78`) — unchanged, quiet outline pill → app.askgogo.in.
- Style the "Join Gogo" CTAs to match the existing pill geometry (height 40px header / 54px hero,
  `border-radius:999px`) so the visual layout is untouched — only label + behaviour change.

## 8. Hero copy placement — TWO OPTIONS (propose, do not decide)

The mockup's P1–P3 (01-PRD §3) is explanatory prose; the live hero (chapter 00, `part-00.htmlfrag:87-112`)
is a tightly animated two-column layout ("Meet Gogo." + one serif line + a live chat demo).

| | **Option A — into Chapter 00 (Hero)** | **Option B — new short band after the Hero (before Chapter 01)** |
|---|---|---|
| Where | Replace the hero's lead paragraphs (`part-00.htmlfrag:91-92`) with P1(bold)/P2/P3 | Insert a new calm text band between chapter 00 (`#top`) and chapter 01 `#overwhelmed` (`part-00.htmlfrag:115`) — e.g. `#about` |
| Pro | Literally the "hero"; first thing seen; highest prominence | Keeps the animated hero + chat demo intact (low visual risk); gives dense prose a clean home; can also seed the sheet intro |
| Con | Three dense paragraphs crowd the animated two-column hero and fight the chat demo; **edits the hero fragment** (higher risk; hero has animation refs) | Slightly lower prominence than the hero; adds one chapter to the scroll/menu |
| Risk | Fragment edit inside the most complex chapter | Additive band; still a fragment edit but isolated |

Both keep the **"email" PENDING VERIFICATION** rule: author so removing that one word leaves
"…WhatsApp, your calendar and your documents." **Owner decides A or B.**

## 9. Out of scope for the sheet

No pricing/plan cards (removed site-wide), no social login, no OTP field, no captcha widget (honeypot
only), no dark mode (the marketing site is light-only).
