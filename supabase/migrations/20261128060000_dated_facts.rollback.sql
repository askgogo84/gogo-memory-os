-- Owner rollback. Removes the dated facts and saved questions for both scopes.
begin;
drop view if exists public.dated_fact_export;
drop function if exists public.dated_fact_reminder(text,uuid,date);
drop function if exists public.write_dated_fact(text,uuid,text,text,uuid,uuid,date,text,text);
drop function if exists public.read_dated_facts(text,uuid,text,date,timestamptz);
drop function if exists public.dated_fact_access(text,uuid,boolean);
drop table if exists public.dated_fact_requests, public.dated_fact_questions, public.dated_fact_revisions, public.dated_fact_topics;
commit;
