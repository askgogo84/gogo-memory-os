-- AskGogo Razorpay v1
-- Run this in Supabase SQL Editor.
-- Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint,
  whatsapp_id text,
  user_id uuid,
  plan text not null,
  amount integer not null,
  currency text not null default 'INR',
  status text not null default 'created',
  razorpay_payment_link_id text unique,
  razorpay_payment_link_url text,
  razorpay_payment_id text,
  razorpay_order_id text,
  razorpay_signature text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.payment_records
  add column if not exists telegram_id bigint,
  add column if not exists whatsapp_id text,
  add column if not exists user_id uuid,
  add column if not exists plan text,
  add column if not exists amount integer,
  add column if not exists currency text default 'INR',
  add column if not exists status text default 'created',
  add column if not exists razorpay_payment_link_id text,
  add column if not exists razorpay_payment_link_url text,
  add column if not exists razorpay_payment_id text,
  add column if not exists razorpay_order_id text,
  add column if not exists razorpay_signature text,
  add column if not exists raw_payload jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists paid_at timestamptz,
  add column if not exists updated_at timestamptz default now();

create unique index if not exists payment_records_payment_link_id_uidx
on public.payment_records(razorpay_payment_link_id)
where razorpay_payment_link_id is not null;

create index if not exists payment_records_telegram_id_idx on public.payment_records(telegram_id);
create index if not exists payment_records_whatsapp_id_idx on public.payment_records(whatsapp_id);
create index if not exists payment_records_plan_idx on public.payment_records(plan);
create index if not exists payment_records_status_idx on public.payment_records(status);
create index if not exists payment_records_created_at_idx on public.payment_records(created_at desc);
