create table if not exists public.agent_open_loops (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  kind text not null check (kind in ('followup','waiting_on','commitment','approval','mission','life_event','meeting_action','other')),
  title text not null,
  summary text not null default '',
  status text not null default 'active' check (status in ('active','resolved','dismissed')),
  priority numeric not null default 0.7,
  due_at timestamptz null,
  next_check_at timestamptz null,
  source_type text not null,
  source_id text null,
  source_refs jsonb not null default '[]'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_id, fingerprint)
);

create index if not exists agent_open_loops_active_idx
  on public.agent_open_loops (telegram_id, status, priority desc, updated_at desc);

create index if not exists agent_open_loops_due_idx
  on public.agent_open_loops (status, next_check_at)
  where status = 'active';

alter table public.agent_open_loops enable row level security;
