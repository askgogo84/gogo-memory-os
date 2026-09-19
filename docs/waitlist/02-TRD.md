# 02 — TRD: askgogo.in waitlist (two-repo)

Technical requirements. Reads with 01-PRD. All `file:line` are from the Step-1 survey. Two repos:
**app repo** = `gogo-memory-os` (this, → app.askgogo.in); **site repo** = `askgogo-main`
(`C:\Users\gover\askgogo-main`, → askgogo.in, **read-only for these docs**).

---

## 1. Site repo shape (survey 1a)

- **Not a framework build.** `askgogo-main` is a **static site** whose live page is an **immersive
  single page assembled at runtime**: `index.html` is a loader that `fetch`es
  `site-final/part-00.htmlfrag` + `stage-01…08.htmlfrag`, concatenates them, runs string
  replacements, `document.write`s the result, then boots the **Claude Design runtime**
  `support-v2.js` with **vendored React** (`/vendor/react.production.min.js`,
  `/vendor/react-dom.production.min.js`; mapped via `window.__resources` at `part-00.htmlfrag:28-33`).
  - Loader: `index.html:37-62`. Fragment list: `index.html:42`. CSS injected:
    `index.html:54` (`/site-final/mobile-v2.css`). Body-close script injected: `index.html:55`.
  - Runtime identity: `support-v2.js:1` — *"GENERATED from dc-runtime/src/*.ts — do not edit."*
- **`vercel.json`** (full): one redirect `/dashboard → /` (302), rewrites
  `/askgogo-whatsapp-premium-20260911c.png → /og-image-v2.png` and **catch-all `/(.*) → /index.html`**.
  Vercel serves **existing static files first**, so real files (`*.dc.html`, `/privacy/`, `/terms/`,
  `/refund/`, `/start/`, `/site-final/*`) are reachable by direct URL; only non-existent paths fall
  through to `index.html`.
- **`sitemap.xml`**: a single `<url>` — `https://askgogo.in/` only. **No pricing URL in it.**
- **`robots.txt`**: `Allow: /`, points at the sitemap.
- **`package.json`**: `test: node scripts/verify-share-preview.mjs` (one preview-image check).
- **Pages:** the live experience is the fragments. **Legacy Claude Design exports** (reachable only
  by direct URL, **not linked from `index.html`**): `Home.dc.html`, `Home-v2.dc.html`,
  `Pricing.dc.html`, `Try for Free.dc.html`, `SiteNav.dc.html`, `Gogo.dc.html`, `AI Magic.dc.html` +
  12 `AI Magic - *.dc.html`, `Channel - WhatsApp/Telegram/Email.dc.html`, and `start/index.html`.
  `Pricing.dc.html` is already a stub that redirects to `/#pricing`.

## 2. WhatsApp-link rewiring (survey 1b) — site repo

**Live site (must open the sheet):**

| # | Where | `file:line` | Current | Target |
|---|---|---|---|---|
| L1 | Header pill "Talk to Gogo" | `part-00.htmlfrag:64` | `<a href="{{ links.whatsapp }}">` | "Join Gogo" → opens sheet (`source=askgogo.in:header`) |
| L2 | Hero CTA "Meet Gogo" (`id="meet"`) | `part-00.htmlfrag:94` | `<a href="{{ links.whatsapp }}">` | "Join Gogo" → opens sheet (`source=askgogo.in:hero`) |
| L3 | Menu drawer "Talk to Gogo" | `part-00.htmlfrag:80` | `<a href="{{ links.whatsapp }}">` | opens sheet (`source=askgogo.in:menu`) |
| L4 | Data-model value `links.whatsapp` | `stage-07.htmlfrag:2` | `https://api.whatsapp.com/send?phone=17605483659&text=Hi%20Gogo` | the single source the three `{{ links.whatsapp }}` above resolve to |
| L5 | noscript fallback | `index.html:36` | `api.whatsapp.com/send?phone=17605483659` | **can't open a JS sheet** — repoint to `https://askgogo.in/` or a static "join" note (OPEN, Report Q5) |
| L6 | load-error fallback | `index.html:59` | same | same as L5 |

**Legacy pages (direct-URL only; per-page decision in §3):** WhatsApp links in `Home.dc.html` (6),
`Home-v2.dc.html` (2), `Try for Free.dc.html` (5), `SiteNav.dc.html` (2),
`Channel - WhatsApp.dc.html` (6), `Channel - Email.dc.html` (4), `Channel - Telegram.dc.html` (2),
`AI Magic.dc.html` (2), each `AI Magic - *.dc.html` (6 × 12 files), `start/index.html`
(`:26,:130,:134`).

**Safe rewiring approach (see §6 risk):** do **not** edit `{{ }}` templates or `support-v2.js`.
Rewire with a small isolated script (`waitlist.js`) that attaches a **capturing** `document` click
listener intercepting any `a[href*="whatsapp"]`, `a[href*="wa.me"]`, or href containing
`17605483659`, plus any element tagged as a Join CTA — `preventDefault()` and open the sheet. This
covers L1–L3 without touching the runtime. L4 may optionally be left as-is (the interceptor catches
the rendered link) or changed later; changing L4 alone would rewire all three but requires a fragment
edit.

## 3. Legacy pages — rewire vs 301 (proposal; do not decide)

These are superseded by the immersive page and are not linked from it. Two options per group:

| Page group | Contains | Proposal A (recommended) | Proposal B |
|---|---|---|---|
| `Home.dc.html`, `Home-v2.dc.html`, `Try for Free.dc.html`, `SiteNav.dc.html`, `Gogo.dc.html`, `AI Magic*.dc.html`, `Channel - *.dc.html`, `start/index.html` | WhatsApp links + some pricing | **301 → `/`** in `vercel.json` (they are dead exports; cheapest, removes every bypass at once) | **Rewire each** to load the sheet (≈20 Claude Design files edited — high effort/risk, low value since unlinked) |
| `Pricing.dc.html` | already redirects to `/#pricing` | **301 → `/`** (after pricing removed, `/#pricing` won't exist) | leave (would land on a page with no pricing anchor) |
| `/privacy/`, `/terms/`, `/refund/` | legal | **KEEP** (linked by consent line + menu footer) | — |

Recommendation is 301 for all legacy; **decision is the owner's** (Report Q2).

## 4. Endpoint & CORS (app repo)

- **File:** `app/api/waitlist/route.ts` (new, Phase 2). Next.js **route handler**,
  `runtime='nodejs'`, `dynamic='force-dynamic'`. This repo already hosts ~39 `app/api/**` route
  groups, so it hosts this with no structural change. **Reuse `@/lib/supabase-admin`** (the existing
  service-role client) per decision, following the patterns in e.g. `app/api/todos/route.ts`.
- **Cross-origin:** the site (`https://askgogo.in`) POSTs to `https://app.askgogo.in/api/waitlist`.
  - **Methods:** `POST` and `OPTIONS` only. Any other → `405`.
  - **CORS allowlist — exactly** `https://askgogo.in` and `https://www.askgogo.in`. Echo the request
    `Origin` back in `Access-Control-Allow-Origin` **only if it is in the allowlist** (never `*` on a
    state-changing endpoint); else omit the header. `Access-Control-Allow-Methods: POST, OPTIONS`;
    `Access-Control-Allow-Headers: content-type`. `OPTIONS` returns `204` with those headers.
- **Body:** JSON. Validate everything server-side (§5). Honeypot check. Upsert on `phone_e164`.
  Identical success shape for new and duplicate.

## 5. Server-side validation (never trust the client)

Pure module `lib/waitlist/validate.ts` (offline unit-testable, mirrors `meter-core.ts`/`lists-core.ts`
style), imported by the thin route:

1. Parse JSON; non-JSON → `400`.
2. **Honeypot** (e.g. `company`): non-empty → return **success shape, write nothing**.
3. **country** ∈ {`IN`,`AE`} → else `400`.
4. **phone:** strip non-digits → IN: 10 digits, first 6–9 → `+91…`; AE: 9 digits, first 5 → `+971…`;
   else field error.
5. **email:** trim → lowercase → standard-format → else field error.
6. **opt-in:** coerce boolean, default `false`.
7. **consent_version:** server constant `'2026-09-19'` (ignore any client value).
8. **source:** accept a short client-supplied tag but **prefix/normalise server-side** to
   `askgogo.in:<cta-id>` from an allowlist of cta-ids (`header`,`hero`,`menu`,…); unknown → 
   `askgogo.in:unknown`.
9. Upsert (05 §4) → success shape.
10. **Never** store IP/headers.

## 6. Risk check (survey 1g) — what is safe to edit in the site repo

**Broke-production precedent:** shipping/regenerating a raw Claude Design package. So:

- **DO NOT** edit `support-v2.js` (generated runtime, `support-v2.js:1`), `/vendor/*`, or regenerate
  the fragments wholesale.
- **DO NOT** rely on editing `{{ }}` template expressions or `x-dc`/`dc-import`/`sc-if`/`sc-for`
  nodes for the rewire — that couples the change to the runtime.
- **SAFE, additive edits only:**
  - **`index.html` loader** — add one `html.replace('</body>', …)` to inject the sheet markup +
    `<script src="/site-final/waitlist.js">`, mirroring the existing `mobile-v2.css` injection
    (`index.html:54`) and body-close script (`index.html:55`). The sheet lives **outside** `<x-dc>`.
  - **New files** `site-final/waitlist.js` and `site-final/waitlist.css` — self-contained vanilla JS
    (no React, no runtime coupling): builds the sheet, intercepts CTAs by URL match (§2), posts to
    the app endpoint, handles focus/Escape.
- **Pricing removal (§ below) is the one place a fragment edit may be needed** — see §7 for the
  lower-risk alternative.
- **Verify on the site repo's Vercel preview before merge** (Phase 3/4).

## 7. Pricing removal & redirects (survey 1c) — site repo

**Where pricing lives (live site):**
- Chapter **13 Pricing** section markup: `stage-06.htmlfrag:14-24` (`<section id="pricing">`,
  `<sc-for list="{{ plans }}">`).
- Plan data: `stage-08.htmlfrag:44-52` — `planData` = Gogo Free ₹0 / Essential ₹249 / Plus ₹499 /
  Pro ₹999 (annual variants too).
- Menu/nav chapters array: `stage-07.htmlfrag:3` `this.chapters = [...]` (includes the pricing
  entry) — plus the `#pricing` chapter appears in the menu list.
- `Pricing.dc.html` — redirect stub → `/#pricing`.
- `sitemap.xml` — **no pricing URL present** (only `/`).

**Two removal methods (do not decide — Report Q3):**
- **Method A — fragment edits (surgical):** delete the chapter-13 `<section id="pricing">` block
  (`stage-06.htmlfrag:14-24`), remove the pricing entry from `stage-07.htmlfrag:3` chapters array,
  and drop `planData`/`plans` usage in `stage-08.htmlfrag:44-52`. Lowest footprint but edits built
  fragments (moderate risk; verify on preview).
- **Method B — injected hide (no fragment edit):** in `waitlist.js`/`waitlist.css` (already being
  added), `#pricing{display:none}` and remove the pricing menu link at runtime. Zero fragment edits
  (lowest risk) but the chapter still ships in the DOM (hidden) and is a weaker "removal".

**Redirects (`askgogo-main/vercel.json`, additive):** add 301s for `/pricing`, `/Pricing.dc.html`,
and any `/plans*` → `/`. Keep the existing `/dashboard` redirect and the catch-all rewrite. Because
of the catch-all, a bare `/pricing` currently renders the SPA; a 301 makes it land on `/` cleanly.
**Sitemap:** already clean; confirm no pricing entry is added.

**App pricing is untouched** (THIS repo): `app/pay/page.tsx:7-9`, `app/upgrade/page.tsx:4`,
`app/dashboard/(app)/you|usage` stay — existing users need them.

## 8. Fonts & colours (survey 1e) — govern the sheet

From the **live** `part-00.htmlfrag`:
- **Fonts:** **Newsreader** (serif/display) + **Onest** (sans/body), Google Fonts
  (`part-00.htmlfrag:40`); body `font-family:Onest` (`:42`).
- **Colours:** cream **`#F6F1E8`** (bg), ink **`#16130F`**, teal **`#157A6E`** (primary CTA + link
  hover), orange **`#EF7A27`** (accent), muted **`#5C554C`**, dark pill **`#16130F`**/cream text,
  section-alt **`#EFE8DC`**, white cards **`#FFFFFF`**.

**The sheet uses these, not the mockup's Fraunces/orange `#F18219`.** Note: the live site *does* use
italic `<em>` (e.g. `part-00.htmlfrag:91`), but the **sheet must contain no italic/slanted type**
(hard rule). Detail in 04.
