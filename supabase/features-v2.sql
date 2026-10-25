-- AskGogo Features v2 - FIXED - safe to re-run
-- Uses whatsapp_id as user reference (no UUID FK) matching your existing pattern

-- ── EXPENSES ─────────────────────────────────────────────────────
create table if not exists public.expenses (
  id          uuid        primary key default gen_random_uuid(),
  whatsapp_id text        not null,
  amount      numeric(10,2) not null,
  category    text        not null default 'Other',
  description text,
  logged_at   timestamptz not null default now()
);
alter table public.expenses
  add column if not exists whatsapp_id text,
  add column if not exists amount      numeric(10,2),
  add column if not exists category    text default 'Other',
  add column if not exists description text,
  add column if not exists logged_at   timestamptz default now();
create index if not exists expenses_whatsapp_id_idx on public.expenses(whatsapp_id);
create index if not exists expenses_logged_at_idx   on public.expenses(logged_at desc);

-- ── TODOS ─────────────────────────────────────────────────────────
create table if not exists public.todos (
  id          uuid        primary key default gen_random_uuid(),
  whatsapp_id text        not null,
  text        text        not null,
  done        boolean     not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.todos
  add column if not exists whatsapp_id text,
  add column if not exists text        text,
  add column if not exists done        boolean default false,
  add column if not exists done_at     timestamptz,
  add column if not exists created_at  timestamptz default now();
create index if not exists todos_whatsapp_id_idx  on public.todos(whatsapp_id);
create index if not exists todos_whatsapp_done_idx on public.todos(whatsapp_id, done);

-- ── CONTACT MEMORY ────────────────────────────────────────────────
create table if not exists public.contact_memory (
  id          uuid        primary key default gen_random_uuid(),
  whatsapp_id text        not null,
  name        text        not null,
  facts       jsonb       not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.contact_memory
  add column if not exists whatsapp_id text,
  add column if not exists name        text,
  add column if not exists facts       jsonb default '[]',
  add column if not exists created_at  timestamptz default now(),
  add column if not exists updated_at  timestamptz default now();
create index if not exists contact_memory_whatsapp_id_idx on public.contact_memory(whatsapp_id);

-- ── SMART FOLLOW-UPS ─────────────────────────────────────────────
create table if not exists public.followups (
  id           uuid        primary key default gen_random_uuid(),
  whatsapp_id  text        not null,
  contact_name text        not null,
  context      text,
  check_at     timestamptz not null,
  status       text        not null default 'pending',
  created_at   timestamptz not null default now()
);
alter table public.followups
  add column if not exists whatsapp_id  text,
  add column if not exists contact_name text,
  add column if not exists context      text,
  add column if not exists check_at     timestamptz,
  add column if not exists status       text default 'pending',
  add column if not exists created_at   timestamptz default now();
create index if not exists followups_status_check_idx on public.followups(status, check_at);
create index if not exists followups_whatsapp_id_idx  on public.followups(whatsapp_id);

-- ── BILL SPLITS ───────────────────────────────────────────────────
create table if not exists public.bill_splits (
  id           uuid        primary key default gen_random_uuid(),
  whatsapp_id  text        not null,
  total_amount numeric(10,2) not null,
  description  text,
  people       jsonb       not null default '[]',
  per_person   numeric(10,2) not null,
  paid_by      text,
  created_at   timestamptz not null default now()
);
alter table public.bill_splits
  add column if not exists whatsapp_id  text,
  add column if not exists total_amount numeric(10,2),
  add column if not exists description  text,
  add column if not exists people       jsonb default '[]',
  add column if not exists per_person   numeric(10,2),
  add column if not exists paid_by      text,
  add column if not exists created_at   timestamptz default now();
create index if not exists bill_splits_whatsapp_id_idx on public.bill_splits(whatsapp_id);

-- ── NEW COLUMNS ON USERS TABLE ───────────────────────────────────
alter table public.users
  add column if not exists briefing_enabled boolean      default false,
  add column if not exists news_topics      jsonb        default '["tech","markets"]',
  add column if not exists referral_code    text,
  add column if not exists referred_by      text;

create unique index if not exists users_referral_code_uidx
  on public.users(referral_code)
  where referral_code is not null;
