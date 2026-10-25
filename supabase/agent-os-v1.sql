-- AskGogo Agent OS v1
-- Branch-only migration. Do not apply to production until QA is approved.
-- Identity deliberately follows the existing dashboard boundary: telegram_id TEXT.
-- The server always derives this value from the authenticated AskGogo session.

create extension if not exists pgcrypto;

create table if not exists agent_goals (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  title text not null check (char_length(title) between 1 and 160),
  outcome text not null check (char_length(outcome) between 1 and 2000),
  status text not null default 'active' check (status in ('active','paused','completed','cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  deadline timestamptz,
  next_action text,
  blockers jsonb not null default '[]'::jsonb,
  plan_json jsonb not null default '[]'::jsonb,
  context_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_goals_user_status_idx on agent_goals (telegram_id, status, updated_at desc);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  goal_id uuid references agent_goals(id) on delete set null,
  type text not null,
  capability text not null check (capability in ('memory','files','email','calendar','browser','contacts','travel','payments')),
  status text not null default 'queued' check (status in ('queued','running','watching','waiting_approval','completed','failed','paused')),
  title text not null,
  summary text not null default '',
  progress integer check (progress is null or progress between 0 and 100),
  why text,
  source text,
  metadata_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  next_check_at timestamptz,
  error text
);
create index if not exists agent_runs_user_status_idx on agent_runs (telegram_id, status, updated_at desc);
create index if not exists agent_runs_goal_idx on agent_runs (goal_id, updated_at desc);

create table if not exists agent_activity (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  run_id uuid references agent_runs(id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists agent_activity_user_created_idx on agent_activity (telegram_id, created_at desc);
create index if not exists agent_activity_run_created_idx on agent_activity (run_id, created_at desc);

create table if not exists agent_permissions (
  telegram_id text not null,
  capability text not null check (capability in ('memory','files','email','calendar','browser','contacts','travel','payments')),
  level text not null check (level in ('off','read','draft','ask','auto')),
  irreversible_always_ask boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (telegram_id, capability)
);

create table if not exists agent_approvals (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  run_id uuid references agent_runs(id) on delete cascade,
  action_type text not null check (action_type in ('send_email','submit_form','calendar_change','booking','purchase','share')),
  title text not null,
  description text not null default '',
  payload_preview jsonb not null default '[]'::jsonb,
  execution_payload jsonb not null default '{}'::jsonb,
  risk_level text not null check (risk_level in ('low','medium','high')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired','executed','failed')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  executed_at timestamptz,
  resolution_note text
);
create index if not exists agent_approvals_user_status_idx on agent_approvals (telegram_id, status, requested_at desc);

create table if not exists agent_ideas (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  title text not null,
  reason text not null,
  expected_value text not null default '',
  value_score numeric(6,3),
  action_label text not null default 'Review',
  source_refs jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new','accepted','dismissed','snoozed')),
  created_at timestamptz not null default now(),
  snoozed_until timestamptz
);
create index if not exists agent_ideas_user_status_idx on agent_ideas (telegram_id, status, created_at desc);

create table if not exists agent_artifacts (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  type text not null check (type in ('trip','application_tracker','meeting_brief','comparison','goal_plan','research_brief','reward_summary')),
  title text not null,
  subtitle text,
  schema_version integer not null default 1,
  content_json jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_artifacts_user_updated_idx on agent_artifacts (telegram_id, updated_at desc);

create table if not exists agent_watchers (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  goal_id uuid references agent_goals(id) on delete cascade,
  run_id uuid references agent_runs(id) on delete set null,
  type text not null check (type in ('price_threshold','deadline','calendar_change','email_reply','web_change','application_status','travel_disruption')),
  condition_json jsonb not null default '{}'::jsonb,
  cadence_minutes integer not null default 60 check (cadence_minutes >= 60),
  active boolean not null default true,
  last_checked_at timestamptz,
  last_state_json jsonb not null default '{}'::jsonb,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_watchers_due_idx on agent_watchers (active, next_check_at) where active = true;
create index if not exists agent_watchers_user_idx on agent_watchers (telegram_id, updated_at desc);

-- This application uses the service-role Supabase client behind server routes.
-- No client app may query these tables directly. The API layer must scope every
-- operation to the telegram_id derived from an authenticated AskGogo session.
-- RLS is enabled as defence in depth and there are intentionally no anon/authenticated policies.
alter table agent_goals enable row level security;
alter table agent_runs enable row level security;
alter table agent_activity enable row level security;
alter table agent_permissions enable row level security;
alter table agent_approvals enable row level security;
alter table agent_ideas enable row level security;
alter table agent_artifacts enable row level security;
alter table agent_watchers enable row level security;
