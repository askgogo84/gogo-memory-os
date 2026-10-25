-- AskGogo Split Receipts v1
-- Run this after supabase/splitwise-v1.sql.

create extension if not exists "pgcrypto";

create table if not exists split_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_phone text not null,
  group_id uuid not null references split_groups(id) on delete cascade,
  expense_id uuid references split_expenses(id) on delete set null,
  merchant text not null default 'Receipt',
  total_amount numeric(12,2) not null,
  currency text not null default 'INR',
  items_json jsonb not null default '[]'::jsonb,
  raw_caption text,
  status text not null default 'scanned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_split_receipts_owner_phone on split_receipts(owner_phone);
create index if not exists idx_split_receipts_group_id on split_receipts(group_id);
create index if not exists idx_split_receipts_expense_id on split_receipts(expense_id);
create index if not exists idx_split_receipts_created_at on split_receipts(created_at desc);

alter table split_receipts enable row level security;

-- Service-role backend access bypasses RLS. User-facing access should go through API routes.
