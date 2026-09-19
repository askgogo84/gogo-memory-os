# 05 — Backend & schema: askgogo.in waitlist

Supabase table, the `POST /api/waitlist` contract, validation, and secrets. Reads with 02-TRD.

**Supabase project:** `qenhjcooyecmatwducpu`.

---

## 1. Table DDL — `public.waitlist`

Authored in Phase 1 as a migration SQL file under `supabase/` (naming: match the repo's existing
`supabase/*.sql` convention, e.g. `supabase/waitlist-v1.sql`). **The owner runs it in the Supabase
SQL editor** (this run does not run it).

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

**Column notes:**
- `phone_e164` — the E.164 string (`+91…` / `+971…`); **unique** → the upsert conflict target.
- `email` — stored **lowercased, trimmed** (server-normalised, §3).
- `country` — `'IN'` or `'AE'` only, enforced by CHECK **and** server validation.
- `whatsapp_opt_in` — default **false**; the flag that gates any future WhatsApp outreach.
- `consent_version` — stamped server-side (§3); lets us prove which consent text a user agreed to.
- `source` — optional provenance tag (e.g. `'askgogo.in'`, or a campaign). Nullable.
- `invited_at` — null until an invite is sent (out of scope for this build; column reserved).
- **No IP column.** IP addresses are **not stored** (PRD/BACKEND hard rule).

## 2. RLS posture

- **RLS enabled, zero policies.** Only the **service-role** key can read/write (it bypasses RLS).
- The browser never talks to Supabase directly for the waitlist; it only calls `/api/waitlist`.
- This matches the repo's existing agent-table posture (RLS enabled, service-role server access) and
  the RLS work in the night report — the waitlist deliberately grants **no** anon/authenticated
  access at all.

## 3. Server validation & normalisation (authoritative — client is advisory)

Implemented in a pure module `lib/waitlist/validate.ts` (unit-tested, §6), imported by the route.

| Field | Rule | Normalised to |
|---|---|---|
| `country` | ∈ {`IN`,`AE`} (derived from the `+91`/`+971` select) | `'IN'` / `'AE'` |
| phone (IN) | digits only; exactly **10**, first digit **6–9** | `+91` + 10 digits |
| phone (AE) | digits only; exactly **9**, first digit **5** | `+971` + 9 digits |
| `email` | trim → lowercase → standard-format check | normalised email |
| `whatsapp_opt_in` | coerce to boolean | `true`/`false` (default `false`) |
| honeypot (`company`) | must be **empty** | if non-empty → success shape, **no write** |
| `consent_version` | **server-stamped constant** (e.g. `'2026-09-19'`); client value ignored | stored string |

Return **field-level errors** for phone/email/country failures so the client can render inline
messages (03 §3). The consent version constant is defined once server-side and bumped whenever the
consent line text changes.

## 4. Write semantics — idempotent upsert

Duplicate number is **not** an error. Upsert on the unique `phone_e164`:

```sql
insert into public.waitlist (phone_e164, email, country, whatsapp_opt_in, consent_version, source)
values ($1, $2, $3, $4, $5, $6)
on conflict (phone_e164)
do update set
  email           = excluded.email,
  whatsapp_opt_in = excluded.whatsapp_opt_in
returning id;
```

- On conflict, **update `email` and `whatsapp_opt_in`** (a returning user may correct their email or
  change their mind on opt-in). `country`, `consent_version`, `created_at` are left as first written
  (do not overwrite the original consent record; a new consent version, if it matters later, is a
  separate concern). `invited_at` is never touched by this path.
- The route returns the **same success shape** whether the row was inserted or updated — the client
  cannot tell (PRD anti-enumeration rule).

Via `@supabase/supabase-js`: `supabase.from('waitlist').upsert({...}, { onConflict: 'phone_e164' })`
with the service-role client, selecting nothing sensitive back (an `id` is fine; do not echo other
rows).

## 5. Secrets & the Supabase client

- Read **only** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from **Vercel env vars**, server-side.
- **Never** expose them to the browser; **never** name them `NEXT_PUBLIC_*`.
- **Client choice (flag for review):** this repo already has a service-role admin client at
  `@/lib/supabase-admin` (used across the API routes). Two options — **do not decide here:**
  1. **Reuse `@/lib/supabase-admin`.** Least code. But note the night report found this module
     constructs its client at import time and several test scripts must set dummy env to import it;
     the waitlist validator test should stay **pure** (no Supabase import) to avoid inheriting that.
  2. **Construct a local service-role client inside the route** from the two env vars. Fully isolated
     from the product client. Slightly more code.
  (Report Q6.)

## 6. Endpoint contract

**`POST /api/waitlist`** (`app/api/waitlist/route.ts`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`).

**Request body (JSON):**
```json
{
  "country": "IN",
  "phone": "9876543210",
  "email": "Person@Example.com ",
  "whatsapp_opt_in": false,
  "company": ""
}
```

**Responses:**
| Situation | Status | Body (shape) |
|---|---|---|
| Valid new / valid duplicate / honeypot | `200` | `{ "ok": true }` (identical in all three) |
| Field validation failure | `400` | `{ "ok": false, "errors": { "phone": "…", "email": "…" } }` |
| Bad method | `405` | `{ "ok": false }` |
| Server/DB error | `500` | `{ "ok": false, "error": "server_error" }` |

**Validator unit test:** `lib/waitlist/validate.test.mjs` (Node `--test`, offline, no network),
added to the `package.json` `test` chain (06 P2) so it runs in the existing green gate. Cases:
IN valid/invalid (length, leading digit), UAE valid/invalid, email trim+lowercase+format, honeypot,
opt-in coercion, country whitelist, E.164 output.

## 7. Data-protection notes

- No IP, no user-agent, no headers stored.
- `consent_version` + `created_at` are the consent audit trail.
- Deletion-on-request is supported operationally by deleting the row by `phone_e164`; a self-serve
  delete flow is out of scope for this build but the consent line already promises it.
