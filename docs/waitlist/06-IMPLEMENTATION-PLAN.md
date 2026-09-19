# 06 — Implementation plan: askgogo.in waitlist

Five phases, each ending in a testable state. Every code commit is gated on a **green `npm test`**
(the repo already runs `npm test` via `prebuild`, `package.json:7`; the waitlist adds its validator
test to that chain). **This docs run does none of these phases — it stops after the docs commit.**

**Blocking prerequisites (from the report — resolve before P3/P4):**
- **Q1** — locate the askgogo.in marketing-site source (P3/P4 target it).
- **Q2** — same-origin vs cross-origin (decides CORS in P2).
- **Q4** — Terms/Privacy pages exist (consent line links).

The **backend (P1/P2)** can proceed independently of Q1, because the endpoint lives in this repo.

---

## The gate (applies to every code commit)

```
# with the dummy test env the night report documented (so the suite can import server modules):
npm test 2>&1 | Select-Object -Last 3
# commit only if exit code 0
```
`next.config.ts:10-12` sets `ignoreBuildErrors:true`, so **tests**, not the type-checker, are the
gate. Optionally run `npm run typecheck` and `npm run lint` for hygiene, but they do not block.

---

## Phase 1 — Migration SQL (owner runs it)

**Goal:** `public.waitlist` exists in project `qenhjcooyecmatwducpu` with RLS on and no policies.

- **Files:** new `supabase/waitlist-v1.sql` (DDL from 05 §1). **Docs/SQL only — no app code.**
- **Action:** the **owner runs the SQL** in the Supabase SQL editor (this session never touches the
  database — consistent with the "deploys/env are user-run" rule).
- **Testable state:** `select * from public.waitlist limit 1;` returns an empty result with the right
  columns; `insert` as anon is denied; the CHECK on `country` rejects a bad value.
- **Commit:** SQL file only (no test impact).

## Phase 2 — `POST /api/waitlist`

**Goal:** a working, validated, service-role-backed endpoint in this repo.

- **Files (new/edited in this repo):**
  - `lib/waitlist/validate.ts` (pure validation/normalisation, 05 §3).
  - `lib/waitlist/validate.test.mjs` (Node `--test`, offline, 05 §6).
  - `app/api/waitlist/route.ts` (thin route: parse → honeypot → validate → upsert → success shape;
    `runtime='nodejs'`, `dynamic='force-dynamic'`; 02-TRD §1).
  - `package.json` — add `node --test lib/waitlist/validate.test.mjs` to the `test` chain.
  - **If Q2 = cross-origin:** add the CORS allowlist + `OPTIONS` handler to the route (02-TRD §4).
- **Testable state:**
  - `npm test` runs the new validator test green.
  - Manual: `curl -X POST …/api/waitlist` with a valid IN body → `{ok:true}` + one row; invalid →
    `400` with field errors; duplicate → `{ok:true}` + updated row (no dup); honeypot filled →
    `{ok:true}` + **no** row.
- **Commit:** gated on green `npm test`.

## Phase 3 — Sheet UI + CTA rewiring + hero copy

**Goal:** the three mockup states live on the site; no direct-WhatsApp path remains.

- **Files:**
  - **Marketing-site source (Q1)** — the header "Join Gogo" pill, hero "Join Gogo" button, the sheet
    component, the dashboard link, and the rewiring of every direct-WhatsApp CTA found by re-running
    the 02-TRD §2 search **in that source**.
  - **In this repo (the app.askgogo.in analogue), if in scope:** `app/page.tsx` — replace the wa.me
    CTA builder and anchor (`app/page.tsx:5-8,29,32`) with a "Join Gogo" button that opens the sheet;
    apply the exact hero copy (01 §5) with the conditional "email" word; add the sheet component and
    Fraunces/Karla fonts (light-cream tokens, no italic — 04).
- **Encodes:** 01 §3–§5, 03 (flows), 04 (UI). Sheet posts to the P2 endpoint (same-origin or the
  absolute app.askgogo.in URL per Q2).
- **Testable state:** S1 browsable, every "Join Gogo" opens the sheet, submit reaches S3, close
  returns to S1 with focus restored; dashboard link works; **no wa.me/whatsapp:// reachable**
  (re-run the search → zero hits).
- **Commit:** gated on green `npm test` (UI adds no failing test; keep the validator green).

## Phase 4 — Pricing removal + redirects + sitemap

**Goal:** no pricing anywhere public; pricing URLs 301 → `/`; sitemap clean.

- **Files:**
  - `vercel.json` — add a `redirects` array (301 each pricing path → `/`; 02-TRD §6). Additive to the
    existing `regions`/`crons`.
  - **Marketing-site source (Q1)** — delete pricing sections/plan cards/prices (**no replacement
    line**); remove pricing links from nav/footer; remove pricing entries from the sitemap.
  - **This repo:** **nothing to remove** — there is no public marketing pricing here; product pricing
    (`app/pay`, `app/upgrade`, dashboard, `lib/pricing/*`) is **out of scope** and stays.
- **Testable state:** visiting a former pricing URL returns a **301 to `/`**; no pricing text/link is
  reachable from any public page; the sitemap has no pricing entry.
- **Commit:** gated on green `npm test`.

## Phase 5 — Manual test matrix (375px + desktop)

**Goal:** verify the whole flow by hand at both form factors. No files change.

**Exact test inputs:**

| # | Case | Input | Expected |
|---|---|---|---|
| 1 | IN valid | `+91` · `9876543210` · `Person@Example.com ` · opt-in **off** | S3 success; row `phone_e164=+919876543210`, `email=person@example.com`, `country=IN`, `whatsapp_opt_in=false` |
| 2 | IN valid + opt-in | `+91` · `9123456789` · `a@b.co` · opt-in **on** | S3; row with `whatsapp_opt_in=true` |
| 3 | IN bad leading digit | `+91` · `5876543210` | inline error; no request |
| 4 | IN too short | `+91` · `98765` | inline error; no request |
| 5 | UAE valid | `+971` · `501234567` · `x@y.ae` | S3; row `phone_e164=+971501234567`, `country=AE` |
| 6 | UAE bad leading digit | `+971` · `601234567` | inline error |
| 7 | UAE wrong length | `+971` · `50123456` (8) | inline error |
| 8 | Bad email | `+91` · `9876543210` · `not-an-email` | inline error on email |
| 9 | Duplicate number | resubmit #1 with `email=new@x.com`, opt-in **on** | **S3 success**; **same** row updated (email→`new@x.com`, opt-in→true); **no** second row |
| 10 | Honeypot | any valid body + `company="acme"` | **S3 success**; **no** row written |
| 11 | Existing user | click "Open your dashboard" | navigates to `https://app.askgogo.in`; never enters waitlist |
| 12 | No direct-bot path | scan every page/CTA | **zero** wa.me/api.whatsapp.com/whatsapp:// links |
| 13 | Pricing gone | visit former pricing URL | **301 → `/`**; no pricing anywhere public |
| 14 | a11y (desktop) | open sheet, Tab through, Esc | focus trapped; Esc closes; focus returns to CTA |
| 15 | a11y (375px) | open bottom sheet | close ≥44px; inputs ≥16px (no iOS zoom); all targets ≥44px |
| 16 | Hero "email" word | run Gmail check | if it fails, P1 reads "…WhatsApp, your calendar and your documents" (word removed) |

**Testable state:** all 16 pass at 375px and ≥768px.

---

## File-touch summary (from Step 0)

| Phase | This repo | Marketing site (Q1) |
|---|---|---|
| P1 | `supabase/waitlist-v1.sql` (owner runs) | — |
| P2 | `app/api/waitlist/route.ts`, `lib/waitlist/validate.ts`, `lib/waitlist/validate.test.mjs`, `package.json` | — |
| P3 | `app/page.tsx` (rewire + hero), new sheet component + fonts | header/hero CTAs, sheet, rewire all WhatsApp links |
| P4 | `vercel.json` (redirects) | pricing sections, nav/footer, sitemap |
| P5 | — | — |

## Rollback

- P1: `drop table public.waitlist;` (owner).
- P2: delete the route + validator + revert the `package.json` test line.
- P3/P4: revert the branch; `vercel.json` redirects are additive and independently revertible.
