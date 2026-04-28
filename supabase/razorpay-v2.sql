-- AskGogo Razorpay v2 - safe to re-run
-- Adds plan columns to users table

alter table public.users
  add column if not exists plan text default 'free',
  add column if not exists plan_name text,
  add column if not exists plan_active boolean default false,
  add column if not exists plan_started_at timestamptz,
  add column if not exists plan_expires_at timestamptz;

create index if not exists users_plan_idx on public.users(plan);
create index if not exists users_plan_active_idx on public.users(plan_active);

create table if not exists public.payment_records (
    id uuid primary key default gen_random_uuid(),
    telegram_id bigint,
    whatsapp_id text,
    plan 
