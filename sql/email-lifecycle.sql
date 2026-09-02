-- AskGogo lifecycle email delivery log.
-- User-run migration. Safe to run more than once.

create table if not exists public.lifecycle_email_log (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  email_key text not null,
  email text not null,
  subject text not null,
  provider_message_id text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (telegram_id, email_key)
);

create index if not exists lifecycle_email_log_user_sent_idx
  on public.lifecycle_email_log (telegram_id, sent_at desc);

alter table public.lifecycle_email_log enable row level security;

-- No client policies on purpose. Only server-side service-role code uses this table.
