-- Reconstruct the two live agent tables that previously existed only in production.
-- Schema, checks and indexes were captured from qenhjcooyecmatwducpu on 19 Sep 2026.
-- Safe on production: CREATE TABLE/INDEX IF NOT EXISTS; existing data is untouched.

create table if not exists public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  title text not null,
  status text not null default 'active'
    check (status = any (array['active'::text,'archived'::text])),
  context_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_threads_user_updated_idx
  on public.agent_threads (telegram_id, updated_at desc);

create table if not exists public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  ordinal integer not null check (ordinal >= 1 and ordinal <= 100),
  tool_name text not null,
  title text not null,
  status text not null default 'queued'
    check (status = any (array[
      'queued'::text,'running'::text,'waiting_approval'::text,
      'completed'::text,'failed'::text,'cancelled'::text
    ])),
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (run_id, ordinal)
);

create index if not exists agent_steps_run_idx
  on public.agent_steps (run_id, ordinal);

create index if not exists agent_steps_user_created_idx
  on public.agent_steps (telegram_id, created_at desc);

alter table public.agent_threads enable row level security;
alter table public.agent_steps enable row level security;

-- Production's service-role server paths continue to bypass RLS. End-user reads
-- are owner-scoped using the same request identity helper as the other agent tables.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='agent_threads'
      and policyname='agent_threads_owner_select'
  ) then
    create policy agent_threads_owner_select on public.agent_threads
      for select to authenticated, anon
      using (telegram_id = public.app_current_telegram_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='agent_steps'
      and policyname='agent_steps_owner_select'
  ) then
    create policy agent_steps_owner_select on public.agent_steps
      for select to authenticated, anon
      using (telegram_id = public.app_current_telegram_id());
  end if;
end $$;
