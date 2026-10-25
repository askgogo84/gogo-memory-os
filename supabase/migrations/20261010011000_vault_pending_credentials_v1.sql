-- AskGogo Vault pending sign-up credentials v1.
-- A generated password for a new provider account is written here BEFORE the sign-up form is
-- submitted, so a crash between submit and commit can still be recovered. It moves to
-- vault_credentials only after the site's own success state is verified. Rejected or expired
-- rows have their ciphertext wiped.
-- The payload is AES-256-GCM ciphertext (lib/security/vault-crypto.ts). Service role only.

create table if not exists public.vault_pending_credentials (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  run_id uuid,
  domain text not null,
  status text not null default 'pending'
    check (status in ('pending','committed','discarded','expired')),
  payload_ciphertext text not null default '',
  committed_credential_id uuid references public.vault_credentials(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint vault_pending_payload_only_while_pending
    check (status = 'pending' or payload_ciphertext = '')
);

-- At most one pending generated credential per browser run.
create unique index if not exists vault_pending_one_per_run
  on public.vault_pending_credentials (run_id)
  where status = 'pending' and run_id is not null;

create index if not exists vault_pending_owner_domain_idx
  on public.vault_pending_credentials (telegram_id, domain, status);

create index if not exists vault_pending_expiry_idx
  on public.vault_pending_credentials (status, expires_at);

alter table public.vault_pending_credentials enable row level security;
revoke all on public.vault_pending_credentials from anon, authenticated;

comment on table public.vault_pending_credentials is
  'Service-role-only pending sign-up credentials. Ciphertext exists only while status is pending.';
