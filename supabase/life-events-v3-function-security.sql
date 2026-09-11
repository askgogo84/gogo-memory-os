-- Harden Life Event v2 helper functions after Supabase database-linter review.
-- These functions are internal to server-side ticket promotion; they are not public RPCs.

alter function public.gogo_verified_checkin_url(text)
  set search_path = public;

alter function public.gogo_enrich_life_event_checkin_url()
  security invoker;

alter function public.gogo_enrich_life_event_checkin_url()
  set search_path = public;

revoke execute on function public.gogo_verified_checkin_url(text) from public, anon, authenticated;
revoke execute on function public.gogo_enrich_life_event_checkin_url() from public, anon, authenticated;

grant execute on function public.gogo_verified_checkin_url(text) to service_role;
grant execute on function public.gogo_enrich_life_event_checkin_url() to service_role;
