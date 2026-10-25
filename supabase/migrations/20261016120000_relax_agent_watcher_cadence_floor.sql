-- Bring agent_watchers CHECK constraints in line with what the code actually
-- emits. Two drifts of the same class live on this table; both are fixed here.
--
-- 1) cadence_minutes: DDL (supabase/agent-os-v1.sql) declares `>= 60`, but
--    lib/agent/watchers.ts emits an adaptive floor of Math.max(15, ...) for
--    product_stock and web_search. On a clean schema a 15-minute watcher is
--    rejected with agent_watcher_create_failed.
-- 2) type: DDL allows only ('price_threshold','deadline','calendar_change',
--    'email_reply','web_change','application_status','travel_disruption'), but
--    the code inserts type IN ('deadline','email_triage','product_stock',
--    'web_page','web_search'). On a clean schema every non-deadline watcher
--    create is rejected.
--
-- Production was hand-patched (docs/askgogo-handover-next-session.md), so prod
-- works today; this migration brings the repo/staging/any-new-env in line.
--
-- Safety: idempotent and name-safe. Both original CHECKs were declared inline and
-- unnamed, so their generated names are environment-dependent. We discover the
-- constraint by the COLUMN it covers (pg_constraint.conkey -> pg_attribute),
-- never by an assumed name, drop whatever is there, then re-add a stably-named
-- constraint only if absent. Re-running is a no-op.
--
-- The new type list is the UNION of the legacy allowed types and the types the
-- code emits, so existing rows (which may carry a legacy type) stay valid while
-- all current code output is accepted.

-- (1) cadence_minutes floor: >= 60  ->  >= 15
do $$
declare
  conname text;
begin
  for conname in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attname = 'cadence_minutes'
    where t.relname = 'agent_watchers'
      and n.nspname = 'public'
      and c.contype = 'c'
      and a.attnum = any (c.conkey)
  loop
    execute format('alter table public.agent_watchers drop constraint %I', conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where t.relname = 'agent_watchers'
      and n.nspname = 'public'
      and c.conname = 'agent_watchers_cadence_minutes_check'
  ) then
    alter table public.agent_watchers
      add constraint agent_watchers_cadence_minutes_check check (cadence_minutes >= 15);
  end if;
end $$;

-- (2) type allow-list: legacy list  ->  legacy UNION code-emitted list
do $$
declare
  conname text;
begin
  for conname in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attname = 'type'
    where t.relname = 'agent_watchers'
      and n.nspname = 'public'
      and c.contype = 'c'
      and a.attnum = any (c.conkey)
  loop
    execute format('alter table public.agent_watchers drop constraint %I', conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where t.relname = 'agent_watchers'
      and n.nspname = 'public'
      and c.conname = 'agent_watchers_type_check'
  ) then
    alter table public.agent_watchers
      add constraint agent_watchers_type_check check (type in (
        -- legacy allowed types (from supabase/agent-os-v1.sql)
        'price_threshold','deadline','calendar_change','email_reply',
        'web_change','application_status','travel_disruption',
        -- types the code emits (from lib/agent/watchers.ts inserts)
        'email_triage','product_stock','web_page','web_search'
      ));
  end if;
end $$;
