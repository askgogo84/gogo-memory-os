-- Shared AskGogo credential vault foundation.
-- Secrets remain service-role only; client/dashboard code never selects ciphertext directly.

create table if not exists public.vault_credentials (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  provider text not null,
  account_label text not null,
  username_hint text not null default '',
  username_ciphertext text not null,
  secret_ciphertext text not null,
  allowed_domains text[] not null default '{}'::text[],
  status text not null default 'active'
    check (status in ('active','needs_reauth','revoked')),
  key_version integer not null default 1,
  metadata_json jsonb not null default '{}'::jsonb,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_id, provider, account_label)
);

create index if not exists vault_credentials_user_provider_idx
  on public.vault_credentials (telegram_id, provider, updated_at desc);

create table if not exists public.vault_audit (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  credential_id uuid references public.vault_credentials(id) on delete set null,
  provider text not null default '',
  domain text not null default '',
  event_type text not null,
  outcome text not null default 'ok',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vault_audit_user_created_idx
  on public.vault_audit (telegram_id, created_at desc);

alter table public.vault_credentials enable row level security;
alter table public.vault_audit enable row level security;

comment on table public.vault_credentials is
  'Service-role-only encrypted credentials. No direct anon/authenticated SELECT policy by design.';
comment on table public.vault_audit is
  'Non-secret audit trail for credential lifecycle and browser use. No secret values permitted.';
