# AskGogo Dashboard v0 — Backend Schema
*Doc 4 of 6. Target DB: Supabase `qenhjcooyecmatwducpu` ("Whatsapp Bot"). **Check the project ref in the URL bar before every Run** — `yazpphublutdodahfwvr` is CreditIQ's and the refs look alike.*

---

## 0. Migration discipline

Claude Code cannot run DDL. Every statement below is hand-applied in the SQL editor and **confirmed with a SELECT that returns the object** before any code is written against it. "Migration applied" has been asserted on this project before it actually ran.

---

## 1. `dashboard_tokens` — single-use magic links

```sql
create table if not exists dashboard_tokens (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  token_hash text not null,              -- sha256 of the token; plaintext is NEVER stored
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists dashboard_tokens_hash_uniq
  on dashboard_tokens (token_hash);
create index if not exists dashboard_tokens_tg_idx
  on dashboard_tokens (telegram_id, created_at desc);
```

**Confirm:** `select * from dashboard_tokens limit 1;`

A token is valid only when `used_at is null` and `expires_at > now()`. Redemption sets `used_at` in the same statement that reads it, so a double-tap can't mint two sessions:

```sql
update dashboard_tokens
set used_at = now()
where token_hash = $1 and used_at is null and expires_at > now()
returning telegram_id;
```

Zero rows returned means invalid, expired, or already used — all three get the same user-facing message. Don't distinguish them; the difference only helps an attacker.

---

## 2. `dashboard_sessions` — the cookie's server side

```sql
create table if not exists dashboard_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,              -- random, this is the cookie value
  telegram_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists dashboard_sessions_sid_uniq
  on dashboard_sessions (session_id);
create index if not exists dashboard_sessions_tg_idx
  on dashboard_sessions (telegram_id);
```

**Confirm:** `select * from dashboard_sessions limit 1;`

`session_id` is 32 random bytes, base64url. It carries no information about the user — the telegram_id is only ever resolved server-side by lookup. Expiry 30 days. Sign-out **deletes the row**; clearing the cookie alone would leave a valid session behind.

---

## 3. Rate limiting

Reuse the existing `wa_link_throttle` table from the CreditIQ handshake rather than adding a second throttle. Cap: **5 token issues per telegram_id per hour**. Over the cap, the bot replies with a plain "try again in a bit" — fail *closed* on issuing, since a token is a credential.

If the existing table's shape doesn't fit, say so before inventing a new one.

---

## 4. Nothing else is new

Every surface reads tables that already exist:

| Surface | Tables |
|---|---|
| Reminders | `reminders` |
| Calendar | Google Calendar API + `reminders` |
| Lists | existing lists tables |
| Usage | `usage_events`, `user_plans`, `plan_limits` — **only via `lib/services/meter.ts`** |
| Profile | `users`, `user_plans`, `wa_creditiq_links` |

**No new columns on `reminders`.** If a dashboard feature seems to need one, that's a signal the feature belongs in v1.

---

## 5. Key-type rules

`telegram_id` is **TEXT** in the meter tables and in both tables above; always `String(telegramId)`, including negative synthesized WhatsApp ids. `reminders`, `users` and `friend_contacts` store it as bigint/numeric — cast at the boundary, and do not change those tables.

Two `users` rows exist for nine phone numbers (a bulk insert wrote `whatsapp:`-prefixed rows alongside bare-format originals). The prefixed copies have a null `telegram_id` and are never resolved to, so they're inert — **but never look a dashboard user up by phone number.** Always by the session's telegram_id.

---

## 6. Cleanup

Expired tokens and sessions accumulate. A weekly delete is enough; don't build it now, and don't add a cron for it until the tables are big enough to notice.

```sql
delete from dashboard_tokens  where expires_at < now() - interval '7 days';
delete from dashboard_sessions where expires_at < now();
```

---

## 7. Migration order

1. `dashboard_tokens` → confirm with SELECT
2. `dashboard_sessions` → confirm with SELECT
3. Verify `wa_link_throttle` exists and its shape suits token issuing
4. Only then write code

Each step is its own Run in `qenhjcooyecmatwducpu`, eyeballed before the next.
