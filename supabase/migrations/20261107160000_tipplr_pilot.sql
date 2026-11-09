-- AskGogo Enterprise · Tipplr ops pilot (mock approved 7 Nov 2026). Prepared for owner review; not run by the agent.
-- Five tables keyed by workspace (tenant = public.workspaces row named Tipplr). Ids are text: Tipplr's own ids later,
-- never numeric. Same access pattern as 20261023100000_secondbrain_workspaces.sql: RLS on, service_role only,
-- the app filters through lib/workspaces/access.ts (requireWorkspaceRole) before every read or write.

create table if not exists public.merchant_outlets (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  phone_numbers text[] not null default '{}',
  pos_integrated boolean not null default false,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);
create index if not exists merchant_outlets_workspace_idx on public.merchant_outlets (workspace_id);

create table if not exists public.merchant_items (
  id text primary key,
  outlet_id text not null references public.merchant_outlets(id) on delete cascade,
  name text not null,
  category text not null check (category in ('breakfast','lunch','dinner','all_day')),
  available boolean not null default true,
  available_until timestamptz,
  updated_at timestamptz not null default now(),
  unique (outlet_id, name)
);

create table if not exists public.merchant_orders (
  id text primary key,
  outlet_id text not null references public.merchant_outlets(id) on delete cascade,
  source text not null check (source in ('flipkart','ondc')),
  items jsonb not null default '[]'::jsonb,
  amount_paise bigint not null check (amount_paise >= 0),
  customer_first_name text,
  area text,
  prepaid boolean not null default true,
  pickup_by timestamptz,
  state text not null check (state in ('new','accepted','rejected','cancelled','picked_up','delivered')),
  prep_minutes int,
  cancel_reason text check (cancel_reason in ('out_of_stock','no_response','rider_unavailable','customer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists merchant_orders_outlet_created_idx on public.merchant_orders (outlet_id, created_at desc);
create index if not exists merchant_orders_state_idx on public.merchant_orders (state);

create table if not exists public.merchant_order_events (
  id bigserial primary key,
  order_id text not null references public.merchant_orders(id) on delete cascade,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  actor text not null check (actor in ('merchant','ops','gogo','system')),
  action_record_id text,
  created_at timestamptz not null default now()
);
create index if not exists merchant_order_events_order_idx on public.merchant_order_events (order_id, created_at);

create table if not exists public.merchant_schedules (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null references public.merchant_outlets(id) on delete cascade,
  item_ids text[] not null default '{}',
  off_at time not null,
  on_at time not null,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_result jsonb
);
create index if not exists merchant_schedules_outlet_idx on public.merchant_schedules (outlet_id) where active;

alter table public.merchant_outlets enable row level security;
alter table public.merchant_items enable row level security;
alter table public.merchant_orders enable row level security;
alter table public.merchant_order_events enable row level security;
alter table public.merchant_schedules enable row level security;

grant all on public.merchant_outlets to service_role;
grant all on public.merchant_items to service_role;
grant all on public.merchant_orders to service_role;
grant all on public.merchant_order_events to service_role;
grant all on public.merchant_schedules to service_role;
grant usage, select on sequence public.merchant_order_events_id_seq to service_role;
