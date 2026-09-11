-- Universal Life Event Engine v1
-- Converts inbound tickets/documents/appointments into durable lifecycle objects.
-- No client-side access. Server routes use the service-role client and scope by telegram_id.

create table if not exists life_events (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  event_type text not null check (event_type in ('travel','event','appointment','reservation','purchase','delivery','bill','subscription','application','document','other')),
  subtype text not null default 'other',
  source text not null default 'unknown',
  title text not null check (char_length(title) between 1 and 240),
  provider text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text,
  location text,
  confirmation_ref text,
  lifecycle_state text not null default 'captured' check (lifecycle_state in ('captured','planned','watching','waiting_approval','in_progress','completed','cancelled','expired')),
  participants jsonb not null default '[]'::jsonb,
  preferences_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  dedupe_key text not null,
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_id, dedupe_key)
);

create index if not exists life_events_user_time_idx on life_events (telegram_id, start_at desc nulls last, updated_at desc);
create index if not exists life_events_due_idx on life_events (lifecycle_state, next_action_at) where next_action_at is not null;

create table if not exists life_event_actions (
  id uuid primary key default gen_random_uuid(),
  life_event_id uuid not null references life_events(id) on delete cascade,
  telegram_id text not null,
  action_key text not null,
  action_type text not null check (action_type in ('remember','prepare','monitor','notify','calendar_draft','browser_prepare','email_watch','approval','complete')),
  capability text not null check (capability in ('memory','files','email','calendar','browser','contacts','travel','payments')),
  title text not null,
  due_at timestamptz,
  requires_approval boolean not null default false,
  irreversible boolean not null default false,
  status text not null default 'queued' check (status in ('queued','ready','waiting_approval','running','completed','blocked','cancelled','skipped')),
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (life_event_id, action_key)
);

create index if not exists life_event_actions_due_idx on life_event_actions (status, due_at) where status in ('queued','ready');
create index if not exists life_event_actions_user_idx on life_event_actions (telegram_id, updated_at desc);

alter table life_events enable row level security;
alter table life_event_actions enable row level security;
