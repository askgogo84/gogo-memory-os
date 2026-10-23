-- Rollback for 20261023100000_secondbrain_workspaces.sql.
-- Drops every SecondBrain workspace, membership, invitation, audit row and share. The shared agent_artifacts
-- rows themselves are untouched (they stay with their owner).
begin;
drop table if exists public.workspace_invites;
drop table if exists public.workspace_artifacts;
drop table if exists public.workspace_audit_log;
drop table if exists public.workspace_members;
drop table if exists public.workspaces;
drop function if exists public.workspace_members_keep_owner();
drop function if exists public.workspace_audit_append_only();
commit;
