begin;
set local lock_timeout='5s';
-- Legacy helpers are optional on fresh installations. Exact signatures only.
-- Preserve owners, function bodies and SECURITY mode; triggers still run normally.
do $$
declare name text; target regprocedure;
begin
 foreach name in array array['public.ensure_memory_twin_user(bigint)',
   'public.memory_twin_log_conversation_event()','public.memory_twin_log_reminder_event()',
   'public.gogo_enrich_life_event_checkin_url()'] loop
   target:=to_regprocedure(name);
   if target is not null then
     execute format('revoke all privileges on function %s from public, anon, authenticated',target);
     execute format('grant execute on function %s to service_role',target);
   end if;
 end loop;
 -- These memory bodies already qualify every application table/helper reference.
 foreach name in array array['public.ensure_memory_twin_user(bigint)',
   'public.memory_twin_log_conversation_event()','public.memory_twin_log_reminder_event()'] loop
   target:=to_regprocedure(name);
   if target is not null then execute format('alter function %s set search_path = %L',target,''); end if;
 end loop;
end $$;
commit;
