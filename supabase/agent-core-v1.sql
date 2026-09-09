-- AskGogo Agent Core v1
-- One Gogo brain, two primary product surfaces: WhatsApp + native app.
-- Web remains a supported internal/product surface. Telegram is intentionally
-- not a new agent surface; legacy telegram_id remains only as a compatibility key.

create extension if not exists pgcrypto;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  legacy_telegram_id bigint not null,
  source_surface text not null check (source_surface in ('whatsapp','ios','android','web')),
  input_text text not null,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'planned' check (status in ('planned','awaiting_confirmation','running','completed','failed','cancelled')),
  risk_level text not null default 'green' check (risk_level in ('green','amber','red')),
  summary text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists agent_runs_user_created_idx
  on public.agent_runs(user_id, created_at desc);
create index if not exists agent_runs_legacy_user_created_idx
  on public.agent_runs(legacy_telegram_id, created_at desc);
create index if not exists agent_runs_status_idx
  on public.agent_runs(status, created_at desc);

create table if not exists public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  tool_name text not null,
  title text not null,
  status text not null default 'pending' check (status in ('pending','awaiting_confirmation','running','completed','failed','cancelled')),
  input jsonb,
  output jsonb,
  confirmation_required boolean not null default false,
  reversible boolean not null default false,
  undo_payload jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique(run_id, ordinal)
);

create index if not exists agent_steps_run_ordinal_idx
  on public.agent_steps(run_id, ordinal);

-- Agent activity is server-owned. The existing AskGogo backend uses the service
-- role for trusted writes/reads; no public RLS policy is intentionally granted.
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;

comment on table public.agent_runs is 'Cross-surface Gogo agent activity owned by one canonical AskGogo user.';
comment on table public.agent_steps is 'Visible execution trace for a Gogo agent run, including confirmation and future undo metadata.';
comment on column public.agent_runs.legacy_telegram_id is 'Compatibility key for existing AskGogo tables; not a product surface.';
