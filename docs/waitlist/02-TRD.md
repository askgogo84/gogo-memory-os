# 02 — TRD: askgogo.in waitlist

Technical requirements. Reads with 01-PRD. Grounded in `askgogo84/gogo-memory-os` at the surveyed
commit. All `file:line` references are from the Step-0 survey.

---

## 0. Repo shape (survey 0a)

| Question | Finding | Evidence |
|---|---|---|
| Static HTML or framework? | **Framework — Next.js 16.2.4, App Router, React 19, TypeScript.** Not static HTML. | `package.json:20` (`next: 16.2.4`), `next.config.ts`, `app/` App Router tree |
| Is there an `/api` folder / serverless functions? | **Yes — extensive.** ~39 route groups under `app/api/**` (webhooks, cron, dashboard, gmail, payments, …). Next.js **route handlers** are Vercel serverless functions. | `app/api/*` (listing in report 0a) |
| `vercel.json`? | `regions: ["bom1"]` + 10 `crons`. **No `redirects`, `rewrites`, `headers`, or `functions` block yet.** | `vercel.json:1-45` |
| Build/test scripts? | `build: next build`; **`prebuild: npm test`** (build is gated on tests); `test:` ~66 node/tsx verify scripts; `lint: eslint .`; `typecheck: tsc --noEmit`. | `package.json:5-12` |
| Type-error posture | `typescript.ignoreBuildErrors: true` — **type errors do not fail the build; tests do** (via `prebuild`). | `next.config.ts:10-12` |

**Conclusion for 0a:** this repo **can host `POST /api/waitlist` as-is** — no structural change is
needed to add a route handler. The one config change required later (Phase 4) is adding a `redirects`
block to `vercel.json` for pricing 301s; that is a normal config edit, not a capability gap.

**The green gate:** because `prebuild` runs `npm test`, any Vercel build already runs the full suite.
Every commit in 06 is gated on `npm test` passing (06 §Gate). The waitlist adds its own lightweight
validator test to that suite (05 §6, 06 P2).

---

## 1. Where the endpoint lives

- **File:** `app/api/waitlist/route.ts` (new — created in Phase 2, not this run).
- **Runtime:** **Node.js** route handler (not Edge) — it uses `@supabase/supabase-js`
  (`package.json:16`, already a dependency) with the **service-role key**, which must never run in a
  client/Edge-exposed context. Declare `export const runtime = 'nodejs'` and
  `export const dynamic = 'force-dynamic'`.
- **Method:** `POST` only. Any other method → `405`.
- **Pattern to mirror:** existing route handlers such as `app/api/todos/route.ts` and the webhook
  routes — same `NextResponse.json(...)` shape, same `supabaseAdmin` usage via `@/lib/supabase-admin`
  (see 05 §5 for whether to reuse that client or construct a scoped one).

## 2. WhatsApp-link rewiring (survey 0b)

**Every direct-WhatsApp link on the site must open the sheet instead.** In *this* repo the only such
link is:

| # | What | `file:line` | Current | Target |
|---|---|---|---|---|
| L1 | Hero CTA `ctaHref` builder | `app/page.tsx:5-8` | `https://wa.me/${waNumber}?text=Hi%20Gogo` (fallback `https://askgogo.in`) | Remove the wa.me builder; CTA becomes a **"Join Gogo"** button that opens the sheet (no `href` to WhatsApp) |
| L2 | Hero CTA anchor + label | `app/page.tsx:29,32` | `<a href={ctaHref}>` … "Message Gogo on WhatsApp" | `<button>` "Join Gogo" → opens sheet |

**Non-link mention (not a bypass, noted for completeness):** `app/upgrade/page.tsx:43` contains the
copy "Message Gogo on WhatsApp …" as **plain text behind the product/auth** (app.askgogo.in), not a
link. It is **out of scope** (not on the public marketing site) but recorded so no one mistakes it
for a bypass.

**Search performed:** `wa.me | api.whatsapp.com | whatsapp:// | Chat on WhatsApp | Message Gogo`
across `app/**/*.{tsx,ts}` — only the hits above. **When the real marketing-site source is located
(Q1), this exact search must be re-run there**, because that is where the CTAs the mockup shows
actually live.

## 3. Server-side validation (never trust the client)

The client validates for UX; the **server re-validates everything** and is the source of truth.

1. Parse JSON body. Reject non-JSON → `400`.
2. **Honeypot:** if the hidden field (e.g. `company`) is non-empty → **return the success shape,
   write nothing** (silent bot drop).
3. **Country:** must be `'IN'` or `'AE'` (maps from `+91`/`+971`). Else `400`.
4. **Phone:** strip non-digits.
   - IN: exactly 10 digits, first digit 6–9 → E.164 `+91XXXXXXXXXX`.
   - AE: exactly 9 digits, first digit 5 → E.164 `+971XXXXXXXXX`.
   - Else field error `400`.
5. **Email:** trim, lowercase, standard-format check → else field error `400`.
6. **opt-in:** coerce to boolean; default `false`.
7. **consent:** stamp `consent_version` server-side (05 §3). Do **not** trust a client-sent version.
8. Write via **upsert on `phone_e164`** (05 §4). On success → `200/201` success shape.
9. **Never** store IP address or any request header as PII (PRD/BACKEND).

Validation logic lives in a **pure, unit-testable module** (e.g. `lib/waitlist/validate.ts`) so it
can be tested offline with no network (mirrors the repo's `meter-core.ts` / `lists-core.ts` pattern),
and imported by the route. The route stays thin.

## 4. Origin model (depends on Q1/Q2 — do not decide here)

The endpoint is mandated to live in **this repo** (app.askgogo.in). Two cases:

- **Same-origin** — if askgogo.in is served from this repo/Vercel project: the site POSTs to
  `/api/waitlist`. No CORS needed.
- **Cross-origin** — if askgogo.in is a separate deployment: the site POSTs to
  `https://app.askgogo.in/api/waitlist`, which then needs an explicit **CORS allowlist** for
  `Origin: https://askgogo.in` (and `https://www.askgogo.in`) — `Access-Control-Allow-Origin` echoed
  from an allowlist (never `*` on a state-changing endpoint), plus an `OPTIONS` preflight handler.

Both are documented; the choice follows the answer to Q1/Q2. Until then the route is written
same-origin-first, with the CORS branch noted as a one-block addition.

## 5. Secrets and env

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are read **only** in the Node route/server module,
  **only** from Vercel env vars. They must **never** be `NEXT_PUBLIC_*` and never reach the browser
  bundle. (The repo already uses a service-role admin client server-side — 05 §5.)
- No new public env var is needed for the form itself unless cross-origin (then the site needs the
  absolute endpoint URL, which is a public constant, not a secret).

## 6. Pricing removal & redirects (survey 0c → applied in Phase 4)

- **Survey result:** there is **no public marketing pricing** in this repo. Pricing renders only in
  **product/auth/admin** surfaces: `app/pay/page.tsx:7-9` (₹249/₹499/₹999 = Essential/Plus/Pro),
  `app/upgrade/page.tsx:4` (imports `GOGO_INDIA_PLANS`), `app/dashboard/(app)/you/page.tsx:84`,
  `app/dashboard/(app)/usage/page.tsx:31,52`, plus `app/pitch/*`. **None of these is the public
  site**, so none is touched by "remove pricing from the public site."
- **On the marketing site (Q1):** remove pricing sections/plan cards/prices with **no replacement
  line**; remove pricing links from nav/footer; remove pricing entries from the sitemap.
- **`vercel.json` redirects (Phase 4):** add a `redirects` array giving each known pricing path a
  **301** to `/` (e.g. `/pricing`, `/plans`, `/pricing/*`). Exact paths come from the marketing
  site's routes (Q1). Example shape:
  ```json
  { "redirects": [ { "source": "/pricing", "destination": "/", "permanent": true } ] }
  ```
  This is additive to the existing `vercel.json` (`regions`, `crons`) — nothing existing is removed.

## 7. Accessibility & runtime constraints (detail in 04)

- Sheet: focus trapped; Escape closes (desktop); focus returns to the invoking CTA on close; close
  target ≥44px. Inputs ≥16px (prevent iOS zoom).
- No client-side secret, no analytics that store IP, no third-party script required for the form.

## 8. What Phase-by-phase changes touch (from Step 0)

| Phase | Files (this repo unless noted) |
|---|---|
| P1 migration | `supabase/` new SQL file (owner runs it in the Supabase SQL editor) |
| P2 endpoint | `app/api/waitlist/route.ts` (new), `lib/waitlist/validate.ts` (new), `lib/waitlist/validate.test.mjs` (new), one line in `package.json` `test` |
| P3 sheet/CTA/hero | **marketing-site source (Q1)**; in this repo the analogue is `app/page.tsx` (hero + CTA rewire) and a new sheet component |
| P4 pricing/redirects/sitemap | `vercel.json` (redirects), marketing-site nav/footer/sitemap (Q1) |
| P5 manual QA | no files — test matrix in 06 |
