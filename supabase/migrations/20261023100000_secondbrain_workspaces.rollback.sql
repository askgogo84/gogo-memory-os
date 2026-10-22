-- Rollback for 20261023100000_secondbrain_workspaces.sql.
-- Drops every SecondBrain workspace, membership, audit row and share. The shared agent_artifacts
-- rows themselves are untouched (they stay with their owner).
begin;
drop table if exists public.workspace_artifacts;
drop table if exists public.workspace_audit_log;
drop table if exists public.workspace_members;
drop table if exists public.workspaces;
commit;
