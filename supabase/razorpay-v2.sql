-- AskGogo Razorpay v2 — safe to re-run
-- Adds missing plan columns to users table to match webhook handler

alter table public.users
  add column if not exists plan text default 'free',
  add column if not exists plan_name text,
  add column if not exists plan_active boolean default false,
  add column if not exists plan_started_at timestamptz,
  add column if not exists plan_expires_at timestamptz;

create index if not exists users_plan_idx on public.users(plan);
create index if not exists users_plan_active_idx on public.users(plan_active);

-- Confirm payment_records table exists (should from v1, but safe to ensure)
create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint,
  whatsapp_id text,
  user_id uuid,
  plan text not null,
  amount integer not null,
  currency text not null default 'INR',
  status text not null default 'created',
  razorpay_payment_link_id text,
  razorpay_payment_id text,
  razorpay_order_id text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists payment_records_link_id_uidx
  on public.payment_records(razorpay_payment_link_id)
  where razorpay_payment_link_id is not null;
