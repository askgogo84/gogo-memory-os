# 05 — Backend & schema: askgogo.in waitlist

Supabase table, the cross-origin `POST /api/waitlist` contract, validation, secrets. Backend lives in
the **app repo** (`gogo-memory-os` → app.askgogo.in). **Supabase project:** `qenhjcooyecmatwducpu`.

---

## 1. Table DDL — `public.waitlist`

Authored in Phase 1 as `supabase/waitlist-v1.sql` (match the repo's `supabase/*.sql` convention).
**The owner runs it in the Supabase SQL editor** — this session never touches the database.

```sql
create table if not exists public.waitlist (
  id               uuid primary key default gen_random_uuid(),
  phone_e164       text not null unique,
  email            text not null,
  country          text not null check (country in ('IN','AE')),
  whatsapp_opt_in  boolean not null default false,
  consent_version  text not null,
  source           text,
  created_at       timestamptz not null default now(),
  invited_at       timestamptz
);

alter table public.waitlist enable row level security;
-- NO policies. Service role bypasses RLS; anon/authenticated get nothing.
```

Notes: `phone_e164` unique = upsert conflict target. `email` stored lowercased+trimmed (§3).
`country` `'IN'`/`'AE'` (CHECK + server). `whatsapp_opt_in` default **false** — gates future outreach.
`consent_version` = `'2026-09-19'` (server-stamped). `source` = `'askgogo.in:<cta-id>'`. `invited_at`
reserved (invite flow out of scope). **No IP column — IP is never stored.**

## 2. RLS posture

RLS **enabled, zero policies**. Only the **service role** reads/writes (bypasses RLS). The browser
never touches Supabase directly — it only calls `/api/waitlist`. Matches the repo's existing
agent-table posture; grants **no** anon/authenticated access.

## 3. Server validation & normalisation (authoritative)

Pure module `lib/waitlist/validate.ts` (offline unit-tested, §6), imported by the route.

| Field | Rule | Normalised to |
|---|---|---|
| `country` | ∈ {`IN`,`AE`} (from the +91/+971 select) | `'IN'`/`'AE'` |
| phone (IN) | digits only; **10**, first **6–9** | `+91` + 10 |
| phone (AE) | digits only; **9**, first **5** | `+971` + 9 |
| `email` | trim → lowercase → standard format | normalised email |
| `whatsapp_opt_in` | coerce boolean | default `false` |
| honeypot (`company`) | must be empty | non-empty → success shape, **no write** |
| `consent_version` | **server constant** `'2026-09-19'` (ignore client) | stored |
| `source` | client cta-id from allowlist (`header`,`hero`,`menu`,…) | `'askgogo.in:<cta-id>'`; unknown → `'askgogo.in:unknown'` |

Return field-level errors for phone/email/country so the client renders inline messages.

## 4. Write semantics — idempotent upsert

Duplicate number is **not** an error:

```sql
insert into public.waitlist (phone_e164, email, country, whatsapp_opt_in, consent_version, source)
values ($1, $2, $3, $4, $5, $6)
on conflict (phone_e164)
do update set
  email           = excluded.email,
  whatsapp_opt_in = excluded.whatsapp_opt_in
returning id;
```

On conflict, update **email** and **whatsapp_opt_in** only; leave `country`, `consent_version`,
`created_at`, `invited_at` as first written. The route returns the **same success shape** for insert
and update (anti-enumeration). With `@/lib/supabase-admin`:
`supabaseAdmin.from('waitlist').upsert({…}, { onConflict: 'phone_e164' }).select('id').single()`.

## 5. Secrets & the Supabase client

- **Reuse `@/lib/supabase-admin`** (decision) — the existing service-role client used across
  `app/api/**`. It reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from **Vercel env** server-side.
- These vars are **never** `NEXT_PUBLIC_*` and never reach the browser bundle. The browser only calls
  the endpoint.
- Keep the **validator test pure** (no import of `supabase-admin`) so it needs no env to run in
  `npm test` (the night report noted `supabase-admin` builds a client at import).

## 6. Endpoint contract

**`POST /api/waitlist`** — `app/api/waitlist/route.ts`, `runtime='nodejs'`,
`dynamic='force-dynamic'`. Cross-origin (site → app), CORS allowlist exactly `https://askgogo.in`
and `https://www.askgogo.in`, methods **POST + OPTIONS** only (02-TRD §4).

**Request (JSON):**
```json
{ "country":"IN", "phone":"9876543210", "email":"Person@Example.com ",
  "whatsapp_opt_in":false, "source":"header", "company":"" }
```

**Responses (all carry the CORS headers when Origin is allowlisted):**
| Situation | Status | Body |
|---|---|---|
| Preflight | `204` | (CORS headers only) |
| Valid new / valid duplicate / honeypot | `200` | `{ "ok": true }` (identical) |
| Field validation failure | `400` | `{ "ok": false, "errors": { "phone":"…","email":"…" } }` |
| Disallowed method | `405` | `{ "ok": false }` |
| Server/DB error | `500` | `{ "ok": false, "error":"server_error" }` |

**Validator unit test** `lib/waitlist/validate.test.mjs` (Node `--test`, offline), added to the app
repo's `package.json` `test` chain (06 P2). Cases: IN valid/invalid (length, leading digit), UAE
valid/invalid, email trim+lowercase+format, honeypot, opt-in coercion, country whitelist, source
normalisation, E.164 output.

## 7. Data-protection notes

No IP/user-agent/headers stored. `consent_version` + `created_at` = the consent trail. Deletion on
request = delete the row by `phone_e164` (self-serve delete out of scope; the consent line already
promises it). Terms/Privacy live at `https://askgogo.in/terms/` and `/privacy/` (survey 1f).
