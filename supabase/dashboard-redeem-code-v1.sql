-- Dashboard redeem-by-code — Step 2 schema RECORD.
--
-- STATUS: ALREADY APPLIED & VERIFIED (by SELECT) in Supabase project
-- qenhjcooyecmatwducpu. Nothing here is owed — this file is the record of what
-- the app code assumes, not a pending migration. (Deploys/DDL are user-run.)
--
-- Step 2 adds a typed one-time CODE next to the magic-link token: an 8-char
-- Crockford base32 string, minted on the SAME dashboard_tokens row as the token
-- (same insert), stored ONLY as sha256(normalised(code)). Plaintext is never
-- stored, exactly like token_hash.

-- 1. code_hash column on the existing token row (APPLIED).
alter table dashboard_tokens
  add column if not exists code_hash text;              -- sha256 of the normalised code; plaintext is NEVER stored

-- Partial UNIQUE index (APPLIED as dashboard_tokens_code_hash_uniq). Unique so a
-- code can never collide across live rows; partial so the many historical rows
-- with a null code_hash don't collide on null.
create unique index if not exists dashboard_tokens_code_hash_uniq
  on dashboard_tokens (code_hash)
  where code_hash is not null;

-- Extended atomic burn (issued from the app, shown here for reference):
--   update dashboard_tokens
--   set used_at = now()
--   where (token_hash = $1 or code_hash = $1) and used_at is null and expires_at > now()
--   returning telegram_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Redeem throttle — ALSO APPLIED & VERIFIED. Reproduced as the contract the
--    app assumes (table + column + RPC-arg names). If the live objects ever
--    diverge from these names the app fails CLOSED (refuses every redeem).
--
-- table dashboard_redeem_throttle(ip_hash text pk, attempts int, window_start timestamptz, locked_until timestamptz)
--   ip_hash = HMAC-SHA256(ip) under DASHBOARD_THROTTLE_PEPPER; never a bare IP hash.
-- rpc   dashboard_redeem_register_fail(p_ip_hash text) returns void
--
-- Tunables 20 attempts / 15-min window / 15-min lockout — loosened from 10
-- because Indian carrier-grade NAT pools many users behind one IP; the ~1.1e12
-- code space is the real defence.
