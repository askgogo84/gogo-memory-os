-- Email attention: learned rules, feedback events, per-user forwarding addresses and forwarded mail.
-- Service-role only. Forwarded mail is kept 30 days (purged by the inbound handler).

create table if not exists public.email_attention_rules (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  kind text not null check (kind in ('always','never')),
  match_type text not null check (match_type in ('sender','domain','sender_category')),
  match_value text not null check (char_length(match_value) between 1 and 200),
  category text,
  label text not null check (char_length(label) between 1 and 120),
  source text not null default 'feedback' check (source in ('feedback','chat','behaviour','built_in')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists email_attention_rules_unique
  on public.email_attention_rules (telegram_id, match_type, match_value, coalesce(category,''));
create index if not exists email_attention_rules_user on public.email_attention_rules (telegram_id) where active;

create table if not exists public.email_attention_events (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  kind text not null check (kind in ('shown','not_important','important','draft','remind','open','undo')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists email_attention_events_user on public.email_attention_events (telegram_id, created_at desc);

create table if not exists public.email_aliases (
  alias text primary key check (alias ~ '^[a-z0-9]{1,16}-[a-z0-9]{6}$'),
  telegram_id bigint not null unique,
  forwarding_confirmed_at timestamptz,
  last_received_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  alias text not null references public.email_aliases(alias) on delete cascade,
  message_id text not null,
  thread_key text,
  from_addr text not null default '',
  to_addr text not null default '',
  subject text not null default '',
  snippet text not null default '',
  body_text text not null default '',
  list_id text,
  list_unsubscribe text,
  auto_submitted text,
  received_at timestamptz not null default now(),
  category text,
  score numeric,
  picked boolean not null default false,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (telegram_id, message_id)
);
create index if not exists inbound_emails_user_recent on public.inbound_emails (telegram_id, received_at desc);

alter table public.email_attention_rules enable row level security;
alter table public.email_attention_events enable row level security;
alter table public.email_aliases enable row level security;
alter table public.inbound_emails enable row level security;

revoke all on public.email_attention_rules, public.email_attention_events, public.email_aliases, public.inbound_emails from anon, authenticated;
grant all on public.email_attention_rules, public.email_attention_events, public.email_aliases, public.inbound_emails to service_role;
