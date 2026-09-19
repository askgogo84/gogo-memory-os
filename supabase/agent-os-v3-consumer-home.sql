-- AskGogo Agent OS v3 — consumer home + native device reproducibility.
-- Additive/idempotent. Server-side service-role access only; RLS stays enabled.

create table if not exists public.agent_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  telegram_id text not null,
  installation_id text not null,
  platform text not null check (platform in ('android','ios')),
  expo_push_token text null,
  native_push_token text null,
  permission_status text not null default 'undetermined',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists agent_devices_telegram_installation_uidx
  on public.agent_devices (telegram_id, installation_id);
create index if not exists agent_devices_telegram_enabled_idx
  on public.agent_devices (telegram_id, enabled);

alter table public.agent_devices enable row level security;
comment on table public.agent_devices is
  'Native AskGogo installations. Mutated only by authenticated server routes using the service role; no permissive client RLS policies.';

create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  event_type text not null check (event_type in (
    'run_started','run_updated','run_completed','run_failed',
    'watch_started','watch_triggered','watch_stopped',
    'approval_requested','approval_resolved',
    'idea_created','idea_dismissed',
    'memory_saved','memory_recalled',
    'artifact_created','notification_sent','system'
  )),
  source_type text null,
  source_id text null,
  title text not null,
  body text null,
  payload_json jsonb not null default '{}'::jsonb,
  importance smallint not null default 1 check (importance between 0 and 3),
  surface text null check (surface is null or surface in ('whatsapp','web','android','ios','system')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists agent_events_user_time_idx
  on public.agent_events (telegram_id, occurred_at desc);
create index if not exists agent_events_source_idx
  on public.agent_events (telegram_id, source_type, source_id)
  where source_id is not null;
create index if not exists agent_events_importance_idx
  on public.agent_events (telegram_id, importance desc, occurred_at desc);

alter table public.agent_events enable row level security;
comment on table public.agent_events is
  'Append-only cross-surface AskGogo event ledger for Today feed, auditability and proactive delivery. Written by trusted server executors/service role.';
