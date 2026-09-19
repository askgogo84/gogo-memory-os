-- Rollback for 20260919000000_agent_rls_owner_policies.sql.
--
-- Drops the ten owner-scoped SELECT policies and the helper function, returning
-- the tables to RLS-enabled-with-no-policy (default deny for non-bypassing roles),
-- which is exactly the state they were in before that migration.
--
-- This rollback is safe to run while the application is live *as long as the app
-- is still using SUPABASE_SERVICE_ROLE_KEY*, because the service role bypasses RLS
-- and never depended on these policies. If any route has by then been moved to a
-- non-service role, running this WILL make that route return zero rows -- move it
-- back to the service role first.

begin;

drop policy if exists agent_goals_owner_select on public.agent_goals;
drop policy if exists agent_runs_owner_select on public.agent_runs;
drop policy if exists agent_activity_owner_select on public.agent_activity;
drop policy if exists agent_permissions_owner_select on public.agent_permissions;
drop policy if exists agent_approvals_owner_select on public.agent_approvals;
drop policy if exists agent_ideas_owner_select on public.agent_ideas;
drop policy if exists agent_artifacts_owner_select on public.agent_artifacts;
drop policy if exists agent_watchers_owner_select on public.agent_watchers;
drop policy if exists life_events_owner_select on public.life_events;
drop policy if exists life_event_actions_owner_select on public.life_event_actions;

drop function if exists public.app_current_telegram_id();

commit;

-- Verification after rollback (expect 0 rows):
--   select tablename, policyname from pg_policies
--    where schemaname = 'public'
--      and policyname like '%_owner_select';
