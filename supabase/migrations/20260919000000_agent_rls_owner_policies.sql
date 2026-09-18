-- Owner-scoped RLS policies for the agent and life-event tables.
--
-- STATUS: PREPARED, NOT APPLIED. Do not run this against production without
-- reading the two sections below. It was written from a static audit of the
-- repository, not from a live schema dump.
--
-- WHY THIS EXISTS
-- ---------------
-- supabase/agent-os-v1.sql:137-144 and supabase/life-events-v1.sql:143-144 turn
-- RLS ON for ten tables and then define no policy at all. RLS with zero policies
-- is default-deny, so today those tables are reachable only by roles that bypass
-- RLS -- which is exactly what the application uses: every server module goes
-- through SUPABASE_SERVICE_ROLE_KEY. The practical effect is that ALL tenant
-- isolation currently lives in application code, in the form of a
-- .eq('telegram_id', ...) predicate that must be present on every one of the
-- 99 API routes. One omission is a cross-tenant read, and nothing in the test
-- suite would catch it.
--
-- These policies do not change that on their own. The service role still bypasses
-- RLS. They are the precondition for reducing service-role usage: once a route
-- reads as a non-service role with app.telegram_id set, the database enforces the
-- tenant boundary underneath the application instead of trusting it.
--
-- IDENTITY MODEL
-- --------------
-- AskGogo does not use Supabase Auth for these users. Identity is the legacy
-- telegram_id (TEXT on all ten tables), carried by the app's own session rows
-- (lib/dashboard/session.ts) and by the WhatsApp number resolution in
-- lib/bot/resolve-user.ts. So the policies read a request-local GUC that the
-- application sets per transaction:
--
--   select set_config('app.telegram_id', '<telegram_id>', true);  -- true = tx-local
--
-- A JWT claim is accepted as a fallback so that a later move to Supabase Auth,
-- minting telegram_id into the token, needs no policy rewrite.
--
-- SCOPE OF THIS MIGRATION: SELECT ONLY
-- ------------------------------------
-- Owners get read access to their own rows. INSERT, UPDATE and DELETE are
-- deliberately NOT granted to end-user roles: every write in this codebase is
-- server-side and stays on the service role. Granting owner writes would let a
-- compromised client mark its own agent_approvals row 'approved', which is the
-- one transition the whole safety model rests on (lib/agent/policy.ts requires an
-- approved record before any irreversible action). Read isolation is the win
-- here; write isolation must stay server-side.
--
-- NOT COVERED, AND WHY
-- --------------------
-- agent_steps and agent_threads are written by 15+ modules but have no CREATE
-- TABLE anywhere in this repository, so their current RLS state is unknown.
-- Enabling RLS on a live table whose schema you cannot see is how you take an
-- agent offline at 2am. They need a live schema dump first; see the night report.

begin;

-- Resolve the acting user for the current request: the transaction-local GUC
-- first, then a JWT claim if one is ever introduced. Returns NULL when neither is
-- set, and a NULL owner matches no row, so the default stays deny.
create or replace function public.app_current_telegram_id()
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(current_setting('app.telegram_id', true), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'telegram_id', '')
  );
$$;

comment on function public.app_current_telegram_id() is
  'Acting user for RLS on the agent tables. Set per transaction with select set_config(''app.telegram_id'', <id>, true). NULL matches no row.';

-- agent_goals
create policy agent_goals_owner_select on public.agent_goals
  for select to authenticated, anon
  using (telegram_id = public.app_current_telegram_id());

-- agent_runs
create policy agent_runs_owner_select on public.agent_runs
  for select to authenticated, anon
  using (telegram_id = public.app_current_telegram_id());

-- agent_activity
create policy agent_activity_owner_select on public.agent_activity
  for select to authenticated, anon
  using (telegram_id = public.app_current_telegram_id());

-- agent_permissions
create policy agent_permissions_owner_select on public.agent_permissions
  for select to authenticated, anon
  using (telegram_id = public.app_current_telegram_id());

-- agent_approvals -- read only by design; the approve/reject transition stays
-- server-side on the service role (see SCOPE above).
create policy agent_approvals_owner_select on public.agent_approvals
  for select to authenticated, anon
  using (telegram_id = public.app_current_telegram_id());

-- agent_ideas
create policy agent_ideas_owner_select on public.agent_ideas
  for select to authenticated, anon
  using (telegram_id = public.app_current_telegram_id());

-- agent_artifacts
create policy agent_artifacts_owner_select on public.agent_artifacts
  for select to authenticated, anon
  using (telegram_id = public.app_current_telegram_id());

-- agent_watchers
create policy agent_watchers_owner_select on public.agent_watchers
  for select to authenticated, anon
  using (telegram_id = public.app_current_telegram_id());

-- life_events
create policy life_events_owner_select on public.life_events
  for select to authenticated, anon
  using (telegram_id = public.app_current_telegram_id());

-- life_event_actions
create policy life_event_actions_owner_select on public.life_event_actions
  for select to authenticated, anon
  using (telegram_id = public.app_current_telegram_id());

commit;

-- Verification after applying (expect 10 rows, one per table):
--   select tablename, policyname, cmd
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('agent_goals','agent_runs','agent_activity','agent_permissions',
--                        'agent_approvals','agent_ideas','agent_artifacts','agent_watchers',
--                        'life_events','life_event_actions')
--    order by tablename;
--
-- Smoke test that the boundary actually holds, as a non-service role:
--   select set_config('app.telegram_id', '<a real telegram_id>', true);
--   select count(*) from agent_runs;                       -- only that user's runs
--   select set_config('app.telegram_id', '', true);
--   select count(*) from agent_runs;                       -- must be 0
