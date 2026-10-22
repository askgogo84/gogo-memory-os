-- Duet parity step 2 (22 Oct): what each person hears about and how often.
-- One row per owner; workspace_id is reserved for team/enterprise workspaces (nullable, unused today).
-- Code reads defaults when the row (or this table) is missing, so deploying code first is safe.
begin;
set local lock_timeout = '5s';

create table if not exists public.user_alert_preferences (
  telegram_id text primary key,
  workspace_id uuid null,
  check_every_minutes integer not null default 60 check (check_every_minutes in (60, 120, 240, 480)),
  topics jsonb not null default '{"bills": true, "replies": true, "calendar": true, "watches": true, "travel": true, "tasks": true, "ideas": true}'::jsonb
    check (jsonb_typeof(topics) = 'object'),
  quiet_start smallint not null default 22 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 7 check (quiet_end between 0 and 23),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_alert_preferences_workspace_idx on public.user_alert_preferences (workspace_id) where workspace_id is not null;

alter table public.user_alert_preferences enable row level security;
revoke all on table public.user_alert_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.user_alert_preferences to service_role;

commit;
