-- Provider-neutral durable browser identity (Browserbase contextId today, Steel profileId later).
-- Stores ONLY a pointer to provider-held session state. Cookies/localStorage/sessionStorage and
-- any profile bytes stay with the browser provider and are NEVER copied into this table.
-- telegram_id is text to match vault_sessions.telegram_id; WhatsApp users have NEGATIVE ids.
create table if not exists public.vault_browser_identities (
  id                   uuid primary key default gen_random_uuid(),
  telegram_id          text not null,
  domain               text not null,                        -- canonical site key (see canonicalSiteKey), NOT raw host
  provider             text not null default 'browserbase'
                         check (provider in ('browserbase','steel')),
  external_identity_id text not null,                         -- Browserbase contextId / Steel profileId
  status               text not null default 'active'
                         check (status in ('active','needs_reauth','expired','revoked')),
  last_verified_at     timestamptz,                           -- last positive signed-in confirmation
  lease_until          timestamptz,                           -- durable per-identity lock (PR-G)
  lease_owner          text,                                  -- run/worker token holding the lease
  metadata_json        jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (telegram_id, domain, provider)
);

create index if not exists vault_browser_identities_lookup
  on public.vault_browser_identities (telegram_id, domain, status);

alter table public.vault_browser_identities enable row level security;
-- Service-role only (no anon/authenticated policies), matching vault_sessions / vault_credentials.

comment on table public.vault_browser_identities is
  'Durable pointer to a provider-held browser session (Browserbase Context / Steel Profile). No cookies stored.';
