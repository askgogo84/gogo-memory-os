-- AskGogo Brain v1.1 schema foundation.
-- Additive only: no existing rows are rewritten and no routing behavior changes.
-- This migration introduces the primitives required before Shadow Brain:
--   * inbound event idempotency
--   * per-user serialized processing lease
--   * exact approval action binding storage
--   * explicit outcome_unknown state for uncertain provider mutations

create table if not exists public.agent_inbound_events (
  id uuid primary key default gen_random_uuid(),
  surface text not null,
  event_key text not null,
  external_user_id text,
  telegram_id text,
  status text not null default 'claimed'
    check (status in ('claimed','completed','failed')),
  owner_token text,
  lease_until timestamptz,
  result_json jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (surface, event_key)
);

create index if not exists agent_inbound_events_user_created_idx
  on public.agent_inbound_events (telegram_id, created_at desc);

create index if not exists agent_inbound_events_lease_idx
  on public.agent_inbound_events (status, lease_until)
  where status = 'claimed';

alter table public.agent_inbound_events enable row level security;

comment on table public.agent_inbound_events is
  'Service-role-owned inbound idempotency ledger. One row per provider/surface event key.';

create table if not exists public.brain_user_leases (
  user_key text primary key,
  owner_token text not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.brain_user_leases enable row level security;

comment on table public.brain_user_leases is
  'Service-role-only short leases that serialize brain/mission mutation per canonical user.';

create or replace function public.try_acquire_brain_user_lease(
  p_user_key text,
  p_owner_token text,
  p_lease_seconds integer default 90
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acquired boolean := false;
begin
  if nullif(btrim(p_user_key),'') is null or nullif(btrim(p_owner_token),'') is null then
    return false;
  end if;

  insert into public.brain_user_leases(user_key,owner_token,lease_until,updated_at)
  values(
    p_user_key,
    p_owner_token,
    now() + make_interval(secs => greatest(5, least(coalesce(p_lease_seconds,90), 600))),
    now()
  )
  on conflict(user_key) do update
    set owner_token = excluded.owner_token,
        lease_until = excluded.lease_until,
        updated_at = now()
    where public.brain_user_leases.lease_until <= now()
       or public.brain_user_leases.owner_token = excluded.owner_token;

  get diagnostics acquired = row_count;
  return acquired;
end;
$$;

create or replace function public.release_brain_user_lease(
  p_user_key text,
  p_owner_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  released boolean := false;
begin
  delete from public.brain_user_leases
   where user_key = p_user_key
     and owner_token = p_owner_token;
  get diagnostics released = row_count;
  return released;
end;
$$;

revoke all on function public.try_acquire_brain_user_lease(text,text,integer) from public;
revoke all on function public.release_brain_user_lease(text,text) from public;
grant execute on function public.try_acquire_brain_user_lease(text,text,integer) to service_role;
grant execute on function public.release_brain_user_lease(text,text) to service_role;

alter table public.agent_approvals
  add column if not exists action_hash text,
  add column if not exists policy_version text,
  add column if not exists action_snapshot_json jsonb not null default '{}'::jsonb;

comment on column public.agent_approvals.action_hash is
  'SHA-256 fingerprint of the exact consequential action approved. Recomputed immediately before execution.';
comment on column public.agent_approvals.policy_version is
  'Policy contract version used to construct the approval fingerprint.';
comment on column public.agent_approvals.action_snapshot_json is
  'Non-secret normalized action fields used to explain/recompute the approval fingerprint.';

-- Existing rows remain valid. New runtime code will require action_hash for newly
-- created consequential approvals after the execution path is wired.
alter table public.agent_runs
  drop constraint if exists agent_runs_status_check;

alter table public.agent_runs
  add constraint agent_runs_status_check
  check (status = any (array[
    'queued'::text,
    'running'::text,
    'watching'::text,
    'waiting_approval'::text,
    'completed'::text,
    'failed'::text,
    'paused'::text,
    'outcome_unknown'::text
  ]));

alter table public.agent_steps
  drop constraint if exists agent_steps_status_check;

alter table public.agent_steps
  add constraint agent_steps_status_check
  check (status = any (array[
    'queued'::text,
    'running'::text,
    'waiting_approval'::text,
    'completed'::text,
    'failed'::text,
    'cancelled'::text,
    'outcome_unknown'::text
  ]));
