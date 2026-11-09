-- SecondBrain: a workspace share exists only while its sharer is a member of that workspace.
-- STATUS: PREPARED, NOT APPLIED — needs the owner to run it.
--
-- Why: removeMember() deletes the departing member's shares and then the membership in two separate
-- statements. A failure between them, or a share inserted concurrently, leaves either a removed share for a
-- still-present member or a live share from a former member. A composite foreign key makes the database do
-- it in one statement: deleting the membership cascades that member's shares in the same transaction, and a
-- share can never be inserted for someone who is not (or no longer) a member.
begin;

-- Pre-existing orphans (sharer no longer a member) are exactly the leak this closes.
delete from public.workspace_artifacts a
 where not exists (select 1 from public.workspace_members m
                    where m.workspace_id = a.workspace_id and m.telegram_id = a.shared_by);

alter table public.workspace_artifacts drop constraint if exists workspace_artifacts_sharer_is_member;
alter table public.workspace_artifacts
  add constraint workspace_artifacts_sharer_is_member
  foreign key (workspace_id, shared_by) references public.workspace_members (workspace_id, telegram_id)
  on delete cascade;

create index if not exists workspace_artifacts_sharer_idx on public.workspace_artifacts (workspace_id, shared_by);

commit;
