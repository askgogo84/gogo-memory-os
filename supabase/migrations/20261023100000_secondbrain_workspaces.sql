-- SecondBrain for Business (23 Oct pilot): shared team workspaces.
--
-- STATUS: PREPARED, NOT APPLIED. Until this runs, every /api/workspaces route answers
-- 503 {error:'workspaces_not_enabled'} and /dashboard/business shows "SecondBrain is being set up".
--
-- Tenant isolation lives in application code (lib/workspaces/access.ts): every read and write
-- goes through a membership check keyed by telegram_id. RLS is enabled on all four tables with
-- NO policies, so anon/authenticated roles are denied outright and only the service role (which
-- the app uses) can reach them -- defence in depth, same default-deny model as agent-os-v1.sql.
--
-- Workspace code never reads personal memory, Vault or conversations. A workspace sees only
-- agent_artifacts rows that their owner explicitly shared into it (workspace_artifacts).
begin;
set local lock_timeout = '5s';

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by text not null,
  pilot_read_only boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  telegram_id text not null,
  role text not null check (role in ('owner','admin','member','viewer')),
  invited_by text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, telegram_id)
);
create index if not exists workspace_members_telegram_idx on public.workspace_members (telegram_id);

create table if not exists public.workspace_audit_log (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor text not null,
  action text not null,
  target text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists workspace_audit_log_workspace_idx on public.workspace_audit_log (workspace_id, created_at desc);

create table if not exists public.workspace_artifacts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  artifact_id uuid not null references public.agent_artifacts(id) on delete cascade,
  shared_by text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, artifact_id)
);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_audit_log enable row level security;
alter table public.workspace_artifacts enable row level security;

commit;
