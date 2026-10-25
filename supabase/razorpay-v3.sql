-- AskGogo Razorpay v3 — recurring subscriptions (auto-debit). Safe to re-run.
-- Run this in Supabase SQL Editor before deploying the subscription code.

-- Users: track which Razorpay subscription a user is on, and its live status.
alter table public.users
  add column if not exists razorpay_subscription_id text,
  add column if not exists subscription_status text;

create index if not exists users_subscription_id_idx
  on public.users(razorpay_subscription_id);

-- Payment records: append a row per subscription event (activation, each charge).
alter table public.payment_records
  add column if not exists razorpay_subscription_id text,
  add column if not exists subscription_status text;

create index if not exists payment_records_subscription_id_idx
  on public.payment_records(razorpay_subscription_id);
