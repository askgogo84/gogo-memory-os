-- Rollback for 20261109200000_workspace_share_requires_member.sql.
-- Orphan shares deleted by the forward migration are not restored (they were shares by former members).
begin;
alter table public.workspace_artifacts drop constraint if exists workspace_artifacts_sharer_is_member;
drop index if exists public.workspace_artifacts_sharer_idx;
commit;
