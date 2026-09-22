alter table public.agent_open_loops
  add column if not exists proactive_backoff_until timestamptz null;

create index if not exists agent_open_loops_proactive_backoff_idx
  on public.agent_open_loops (status, proactive_backoff_until)
  where status = 'active';