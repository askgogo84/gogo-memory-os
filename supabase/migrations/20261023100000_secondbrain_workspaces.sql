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
-- Membership is consent-based: an admin creates a pending invitation (workspace_invites); the invitee joins only
-- by accepting it. Admins can revoke a pending invitation; invitations expire after 14 days.
--
-- Database-level guards (defence in depth for races the app cannot fully prevent):
--  * a workspace can never be left without an owner (trigger on workspace_members);
--  * the audit log is append-only (no UPDATE; DELETE only when its workspace is deleted).
--
-- Grants: Supabase no longer grants new public tables to the Data API automatically, so service_role is granted
-- explicitly and anon/authenticated are revoked.
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

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  telegram_id text not null,
  role text not null check (role in ('admin','member','viewer')),
  invited_by text not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  responded_at timestamptz
);
create unique index if not exists workspace_invites_one_pending on public.workspace_invites (workspace_id, telegram_id) where status = 'pending';
create index if not exists workspace_invites_invitee_idx on public.workspace_invites (telegram_id, status);

-- Never leave a workspace without an owner (concurrent demotions/removals included). A cascade from deleting
-- the workspace itself is allowed: by then the workspace row is gone.
create or replace function public.workspace_members_keep_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner' or new.workspace_id <> old.workspace_id) then
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id)
       and not exists (select 1 from public.workspace_members m where m.workspace_id = old.workspace_id and m.role = 'owner' and m.telegram_id <> old.telegram_id) then
      raise exception 'last_owner' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists workspace_members_keep_owner on public.workspace_members;
create trigger workspace_members_keep_owner before update or delete on public.workspace_members
  for each row execute function public.workspace_members_keep_owner();

-- Append-only audit trail.
create or replace function public.workspace_audit_append_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then raise exception 'workspace_audit_log is append-only' using errcode = 'P0001'; end if;
  if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    raise exception 'workspace_audit_log is append-only' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists workspace_audit_append_only on public.workspace_audit_log;
create trigger workspace_audit_append_only before update or delete on public.workspace_audit_log
  for each row execute function public.workspace_audit_append_only();
revoke all on function public.workspace_members_keep_owner() from public, anon, authenticated;
revoke all on function public.workspace_audit_append_only() from public, anon, authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_audit_log enable row level security;
alter table public.workspace_artifacts enable row level security;
alter table public.workspace_invites enable row level security;

revoke all on table public.workspaces, public.workspace_members, public.workspace_audit_log, public.workspace_artifacts, public.workspace_invites from public, anon, authenticated;
grant select, insert, update, delete on table public.workspaces, public.workspace_members, public.workspace_artifacts, public.workspace_invites to service_role;
grant select, insert on table public.workspace_audit_log to service_role;
revoke all on sequence public.workspace_audit_log_id_seq from public, anon, authenticated;
grant usage, select on sequence public.workspace_audit_log_id_seq to service_role;

commit;
