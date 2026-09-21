-- Supabase grants EXECUTE on new functions to anon/authenticated by default.
-- Brain user leases are a service-role-only serialization primitive.
-- Keep the SECURITY DEFINER RPCs unreachable from client roles.

revoke execute on function public.try_acquire_brain_user_lease(text,text,integer)
  from anon, authenticated;

revoke execute on function public.release_brain_user_lease(text,text)
  from anon, authenticated;

grant execute on function public.try_acquire_brain_user_lease(text,text,integer)
  to service_role;

grant execute on function public.release_brain_user_lease(text,text)
  to service_role;
