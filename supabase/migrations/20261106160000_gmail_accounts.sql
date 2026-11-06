-- Second Google account (owner request, 6 Nov): "Connect both goverdhan.md@gmail.com and goverdhan@tipplr.in".
-- DO NOT RUN WITHOUT OWNER APPROVAL. Project: qenhjcooyecmatwducpu.
-- The primary account stays in public.users (gmail_email, gmail_access_token, gmail_refresh_token): nothing there
-- changes. Every further Google account the person connects lives here. Tokens are stored encrypted exactly as the
-- users columns are (lib/security/google-token-crypto). telegram_id is text (WhatsApp ids are 64-bit).
-- Code treats a missing table as "no extra accounts", so deploying code first is safe.
--
-- Rollback (exact; drops only this table, nothing else references it):
--   drop table if exists public.gmail_accounts;
begin;
set local lock_timeout = '5s';

create table if not exists public.gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  access_token text null,
  refresh_token text null,
  scopes text null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz null
);

create unique index if not exists gmail_accounts_owner_email on public.gmail_accounts (telegram_id, email);
create index if not exists gmail_accounts_owner_live on public.gmail_accounts (telegram_id) where disconnected_at is null;

-- Service role only, same as the other agent tables: RLS on, no policies.
alter table public.gmail_accounts enable row level security;

commit;
