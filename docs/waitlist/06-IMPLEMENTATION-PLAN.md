# 06 — Implementation plan: askgogo.in waitlist (two-repo)

Six phases. Each names its **repo**, **files**, and **test gate**, and ends in a testable state.
**This docs run does none of these phases — it stops after the docs commit.**

Repos: **APP** = `gogo-memory-os` (→ app.askgogo.in, has `npm test` via `prebuild`). **SITE** =
`askgogo-main` (→ askgogo.in; `npm test` = `node scripts/verify-share-preview.mjs`; verify on its
**Vercel preview** before merge). **Never push to `askgogo-main` from these docs.**

**Blocking pre-reqs (from the report):** copy placement (04 §8), legacy rewire-vs-301 (02-TRD §3),
pricing-removal method (02-TRD §7), the OPEN DECISION (01 §6), fallback links L5/L6. Backend
(P1/P2/P5-app) does not depend on these.

---

## Phase 1 — Migration SQL · APP repo · owner runs it

- **Files:** new `supabase/waitlist-v1.sql` (05 §1). SQL only, no app code.
- **Action:** **owner runs it** in the Supabase SQL editor (project `qenhjcooyecmatwducpu`).
- **Testable state:** `select * from public.waitlist limit 1;` → empty with the right columns; anon
  insert denied; `country` CHECK rejects a bad value.
- **Gate:** none (SQL file); commit the file.

## Phase 2 — `POST /api/waitlist` + CORS + validator test · APP repo

- **Files (new/edited):** `lib/waitlist/validate.ts`; `lib/waitlist/validate.test.mjs`;
  `app/api/waitlist/route.ts` (POST+OPTIONS, CORS allowlist `https://askgogo.in` +
  `https://www.askgogo.in`, reuse `@/lib/supabase-admin`, upsert, same success shape); one line added
  to `package.json` `test`.
- **Testable state:** `npm test` green incl. the new validator; `curl` from an allowed Origin → 
  `{ok:true}` + one row; invalid → `400` field errors; duplicate → `{ok:true}` + updated row (no dup);
  honeypot → `{ok:true}` + no row; `OPTIONS` → `204` with CORS headers; disallowed Origin → no
  `Access-Control-Allow-Origin`.
- **Gate:** commit **only if `npm test` exits 0** (use the night-report dummy env for the run).

## Phase 3 — Sheet + CTA rewiring + copy · SITE repo (branch → preview → merge)

- **Files (site repo, on a branch):**
  - `site-final/waitlist.js`, `site-final/waitlist.css` (new; self-contained vanilla JS/CSS —
    builds the sheet, intercepts CTAs by URL match, posts to app endpoint, focus/Escape). 02-TRD §6.
  - `index.html` — one additive `html.replace('</body>', …)` to inject the sheet markup +
    `<script src="/site-final/waitlist.js">` (mirrors the existing `mobile-v2.css` injection at
    `index.html:54`). **No edit to `support-v2.js`, `/vendor/*`, or `{{ }}` templates.**
  - Relabel the three CTAs to "Join Gogo" (`part-00.htmlfrag:64,80,94`) — label + `data-cta`
    attribute only; behaviour comes from the interceptor. (Or leave labels and let the interceptor
    handle behaviour — owner's call; relabel recommended for clarity.)
  - Hero copy (P1–P3) per the chosen Option A/B (04 §8).
- **Testable state (on the site's Vercel preview):** S1 browsable; every "Join Gogo"/ex-WhatsApp CTA
  opens the sheet; submit → S3; close returns focus; "Open dashboard" still works; re-run the
  WhatsApp search → zero *reachable* bot links from the live page (L5/L6 fallback per decision).
- **Gate:** site `npm test` (`verify-share-preview.mjs`) green **+ manual preview check**; owner
  merges to `askgogo-main` `main`.

## Phase 4 — Pricing removal + redirects + sitemap + legacy pages · SITE repo (branch → preview → merge)

- **Files (site repo, on a branch):**
  - Pricing removal via **Method A** (fragment edits: `stage-06.htmlfrag:14-24`,
    `stage-07.htmlfrag:3` chapters array, `stage-08.htmlfrag:44-52` planData) **or Method B**
    (injected `#pricing{display:none}` + drop menu link in `waitlist.js/.css`) — 02-TRD §7, **owner
    picks**. No replacement line.
  - `askgogo-main/vercel.json` — add 301 `redirects` for `/pricing`, `/Pricing.dc.html`, `/plans*`
    → `/` (additive; keep existing `/dashboard` redirect + catch-all rewrite).
  - `sitemap.xml` — confirm no pricing entry (already only `/`).
  - Legacy pages — per-page **rewire vs 301** (02-TRD §3): recommended 301 → `/` for all legacy
    `.dc.html` + `start/` + `Try for Free`/`Channel`/`AI Magic` pages; **keep** `/privacy/`,
    `/terms/`, `/refund/`.
- **Testable state:** former pricing URL → **301 → `/`**; no pricing text/link reachable publicly;
  sitemap clean; legacy pages resolve per decision (no bypass WhatsApp links reachable).
- **Gate:** site `npm test` green + preview check; owner merges.

## Phase 5 — App root CTA repoint · APP repo

- **Files:** `app/page.tsx` — replace the wa.me CTA builder + anchor (`app/page.tsx:5-8,29,32`) so it
  points to `https://askgogo.in` (no longer a bot bypass). Label update as appropriate.
- **Testable state:** app.askgogo.in root CTA navigates to askgogo.in, not wa.me.
- **Gate:** commit only if `npm test` exits 0.

## Phase 6 — Manual test matrix (375px + desktop)

No files change. **Exact inputs:**

| # | Case | Input | Expected |
|---|---|---|---|
| 1 | IN valid | `+91` `9876543210` `Person@Example.com ` opt-in off, from header | S3; row `+919876543210`, `person@example.com`, `IN`, opt-in false, `source=askgogo.in:header` |
| 2 | IN valid + opt-in | `+91` `9123456789` `a@b.co` opt-in on, from hero | S3; opt-in true, `source=askgogo.in:hero` |
| 3 | IN bad leading digit | `+91` `5876543210` | inline error; no request |
| 4 | IN too short | `+91` `98765` | inline error |
| 5 | UAE valid | `+971` `501234567` `x@y.ae` | S3; `+971501234567`, `AE` |
| 6 | UAE bad leading digit | `+971` `601234567` | inline error |
| 7 | UAE wrong length | `+971` `50123456` | inline error |
| 8 | Bad email | `+91` `9876543210` `not-an-email` | inline error on email |
| 9 | Duplicate | resubmit #1 with `new@x.com`, opt-in on | **S3 success**; same row updated; no 2nd row |
| 10 | Honeypot | valid body + `company="acme"` | **S3 success**; no row |
| 11 | Existing user | click "Open dashboard" | → `https://app.askgogo.in`; no waitlist |
| 12 | No direct-bot path | scan live page CTAs | zero reachable wa.me/api.whatsapp.com/whatsapp:// bot links (per L5/L6 decision) |
| 13 | Pricing gone | visit `/pricing`, `/Pricing.dc.html`, scroll live page | 301 → `/`; no pricing anywhere public |
| 14 | CORS | POST from a non-allowed Origin | no `Access-Control-Allow-Origin`; browser blocks |
| 15 | a11y desktop | open sheet, Tab, Esc | focus trapped; Esc closes; focus returns to CTA |
| 16 | a11y 375px | open bottom sheet | close ≥44px; inputs ≥16px (no iOS zoom); targets ≥44px |
| 17 | Hero "email" | run Gmail check | if fail, P1 = "…WhatsApp, your calendar and your documents" |
| 18 | App root CTA | app.askgogo.in root | CTA → askgogo.in, not wa.me |

**Testable state:** all pass at 375px and ≥768px.

---

## File-touch summary

| Phase | APP repo (`gogo-memory-os`) | SITE repo (`askgogo-main`) |
|---|---|---|
| P1 | `supabase/waitlist-v1.sql` (owner runs) | — |
| P2 | `app/api/waitlist/route.ts`, `lib/waitlist/validate.ts`, `lib/waitlist/validate.test.mjs`, `package.json` | — |
| P3 | — | `site-final/waitlist.js`, `site-final/waitlist.css`, `index.html`, CTA labels in `part-00.htmlfrag`, hero copy |
| P4 | — | `stage-06/07/08.htmlfrag` (or injected hide), `vercel.json`, `sitemap.xml` (confirm), legacy pages |
| P5 | `app/page.tsx` | — |
| P6 | — | — |

## Rollback

- P1: `drop table public.waitlist;` (owner).
- P2/P5 (app): revert the branch; `package.json` test line.
- P3/P4 (site): revert the site branch; `vercel.json` redirects are additive and independently
  revertible; Method B pricing-hide is pure CSS/JS revert.
