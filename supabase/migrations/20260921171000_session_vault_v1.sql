-- AskGogo Session Vault v1.
-- Stores only opaque metadata about authenticated browser sessions.
-- Cookies, localStorage, sessionStorage and browser profile contents remain
-- inside the isolated persistent Vercel Sandbox and are never copied here.

create table if not exists public.vault_sessions (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  provider text not null default '',
  domain text not null,
  credential_id uuid references public.vault_credentials(id) on delete set null,
  sandbox_name text not null,
  profile_generation text not null,
  status text not null default 'active'
    check (status in ('active','needs_reauth','human_challenge','expired','revoked')),
  auth_method text not null default 'session'
    check (auth_method in ('session','vault_credential','human_handoff','oauth')),
  last_used_at timestamptz,
  expires_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_id, domain, sandbox_name)
);

create index if not exists vault_sessions_user_domain_idx
  on public.vault_sessions (telegram_id, domain, updated_at desc);

create index if not exists vault_sessions_status_idx
  on public.vault_sessions (status, expires_at);

alter table public.vault_sessions enable row level security;

comment on table public.vault_sessions is
  'Service-role-only metadata for authenticated browser sessions. No cookies, storage values, tokens or profile contents permitted.';
