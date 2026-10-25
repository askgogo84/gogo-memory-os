begin;
set local lock_timeout='5s';
-- Cost decisions and per-owner usage are server-owned, never a client-editable API.
alter table public.gogo_cost_budgets enable row level security;
alter table public.gogo_cost_events enable row level security;
revoke all on public.gogo_cost_budgets,public.gogo_cost_events from public,anon,authenticated;
grant all on public.gogo_cost_budgets,public.gogo_cost_events to service_role;
create or replace function public.gogo_monthly_cost_paise(p_telegram_id text,p_since timestamptz)
returns bigint language sql stable security invoker set search_path='' as $$
  select coalesce(sum(estimated_cost_paise),0)::bigint from public.gogo_cost_events
  where telegram_id=p_telegram_id and created_at>=p_since;
$$;
revoke all on function public.gogo_monthly_cost_paise(text,timestamptz) from public,anon,authenticated;
grant execute on function public.gogo_monthly_cost_paise(text,timestamptz) to service_role;
commit;
