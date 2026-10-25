-- Multiple Google accounts per user for Calendar (13 Oct).
-- users.google_refresh_token stays the primary account; extra accounts live here.
-- Refresh tokens are stored encrypted by the app (same key as users.google_refresh_token).
-- Run in the Supabase SQL editor, project ref qenhjcooyecmatwducpu.

create table if not exists public.google_calendar_accounts (
  id            uuid primary key default gen_random_uuid(),
  telegram_id   text not null,
  email         text not null,
  refresh_token text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (telegram_id, email)
);

create index if not exists google_calendar_accounts_user_idx
  on public.google_calendar_accounts (telegram_id, created_at);

-- Service role only: no policies, so anon and authenticated roles can read nothing.
alter table public.google_calendar_accounts enable row level security;
revoke all on public.google_calendar_accounts from anon, authenticated;
