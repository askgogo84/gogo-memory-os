-- Duet parity step 4 (22 Oct): chat channels. A conversation row may belong to one agent_threads channel; rows
-- without one are the single ongoing thread (WhatsApp included). Memory, tasks and approvals stay shared.
-- Adding a nullable column is metadata-only (no table rewrite). The index is built separately, CONCURRENTLY, in
-- 20261022110100_conversation_channels_index.sql so chat writes are never blocked while it builds.
begin;
set local lock_timeout = '5s';
alter table public.conversations add column if not exists thread_id uuid null references public.agent_threads(id) on delete set null;
commit;
