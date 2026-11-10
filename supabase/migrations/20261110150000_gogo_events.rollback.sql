-- Rollback for 20261110150000_gogo_events.sql: drops only the AskGogo Events objects. Event and RSVP data is lost.
begin;
drop function if exists public.gogo_event_join(text, text, text);
drop function if exists public.gogo_event_rsvp(text, text, integer, text, text);
drop function if exists public.gogo_event_headcount(uuid);
drop table if exists public.gogo_event_audit;
drop function if exists public.gogo_event_audit_append_only();
drop table if exists public.gogo_event_notifications;
drop table if exists public.gogo_event_rsvp_history;
drop table if exists public.gogo_event_guests;
drop table if exists public.gogo_events;
commit;
