-- AskGogo Daily Brief email preferences + idempotent delivery log.
-- Additive and safe to run more than once.

alter table public.users
  add column if not exists daily_brief_email_enabled boolean not null default false;

create table if not exists public.daily_brief_email_log (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  local_date date not null,
  email text not null,
  subject text not null,
  provider_message_id text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (telegram_id, local_date)
);

create index if not exists daily_brief_email_log_user_sent_idx
  on public.daily_brief_email_log (telegram_id, sent_at desc);

alter table public.daily_brief_email_log enable row level security;

-- No client policies. AskGogo server-side service role only.
