-- Restrict native-link SECURITY DEFINER RPCs to the AskGogo service-role server.
-- Applied to production Supabase on 2026-09-09 after advisor review.

revoke all on function public.mobile_verify_link(text,text) from public;
revoke all on function public.mobile_verify_link(text,text) from anon;
revoke all on function public.mobile_verify_link(text,text) from authenticated;
grant execute on function public.mobile_verify_link(text,text) to service_role;

revoke all on function public.mobile_exchange_link(text,text,text,text,text,timestamptz) from public;
revoke all on function public.mobile_exchange_link(text,text,text,text,text,timestamptz) from anon;
revoke all on function public.mobile_exchange_link(text,text,text,text,text,timestamptz) from authenticated;
grant execute on function public.mobile_exchange_link(text,text,text,text,text,timestamptz) to service_role;
