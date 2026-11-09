drop index if exists public.agent_watchers_paused_idx;
alter table public.agent_watchers drop column if exists paused_at;
