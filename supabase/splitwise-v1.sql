-- AskGogo Splitwise v1
-- Run this once in Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists split_groups (
  id uuid primary key default gen_random_uuid(),
  owner_phone text not null,
  name text not null,
  currency text not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_split_groups_owner_phone on split_groups(owner_phone);
create index if not exists idx_split_groups_name on split_groups(name);

create table if not exists split_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references split_groups(id) on delete cascade,
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  unique(group_id, name)
);

create index if not exists idx_split_group_members_group_id on split_group_members(group_id);

create table if not exists split_expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references split_groups(id) on delete cascade,
  description text not null default 'Expense',
  total_amount numeric(12,2) not null,
  paid_by text not null,
  category text not null default 'general',
  currency text not null default 'INR',
  raw_text text,
  created_at timestamptz not null default now()
);

create index if not exists idx_split_expenses_group_id on split_expenses(group_id);
create index if not exists idx_split_expenses_created_at on split_expenses(created_at desc);

create table if not exists split_expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references split_expenses(id) on delete cascade,
  group_id uuid not null references split_groups(id) on delete cascade,
  member_name text not null,
  owed_amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_split_expense_shares_expense_id on split_expense_shares(expense_id);
create index if not exists idx_split_expense_shares_group_id on split_expense_shares(group_id);

create table if not exists split_settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references split_groups(id) on delete cascade,
  from_member text not null,
  to_member text not null,
  amount numeric(12,2) not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_split_settlements_group_id on split_settlements(group_id);

create table if not exists split_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references split_groups(id) on delete cascade,
  invited_name text not null,
  invited_phone text,
  invite_code text not null unique default encode(gen_random_bytes(8), 'hex'),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists idx_split_invites_group_id on split_invites(group_id);

alter table split_groups enable row level security;
alter table split_group_members enable row level security;
alter table split_expenses enable row level security;
alter table split_expense_shares enable row level security;
alter table split_settlements enable row level security;
alter table split_invites enable row level security;

-- Service-role backend access bypasses RLS. User-facing access should go through API routes.
