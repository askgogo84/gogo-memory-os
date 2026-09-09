-- AskGogo Agent OS — visible multi-step execution ledger.
-- Additive migration. Every step belongs to one cross-surface agent run.

create table if not exists agent_steps (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  run_id uuid not null references agent_runs(id) on delete cascade,
  ordinal integer not null check (ordinal between 1 and 100),
  tool_name text not null,
  title text not null,
  status text not null default 'queued'
    check (status in ('queued','running','waiting_approval','completed','failed','cancelled')),
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique(run_id, ordinal)
);

create index if not exists agent_steps_run_idx on agent_steps(run_id, ordinal);
create index if not exists agent_steps_user_created_idx on agent_steps(telegram_id, created_at desc);

alter table agent_steps enable row level security;

comment on table agent_steps is 'Visible, auditable tool steps for one Gogo agent run. Read only through server-scoped Agent APIs.';
