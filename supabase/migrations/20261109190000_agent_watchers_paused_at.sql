-- G5 (dot parity): a watch can be paused and resumed without losing its rule or history.
-- paused_at set  → the watch is active but not polled (next_check_at is null while paused).
-- paused_at null → normal. Owner-run; code tolerates the column being absent (PATCH returns 409 migration_required).
alter table public.agent_watchers add column if not exists paused_at timestamptz;
create index if not exists agent_watchers_paused_idx on public.agent_watchers (telegram_id) where paused_at is not null;
