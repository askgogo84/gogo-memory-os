-- Gogo Cost Guard v2 — atomic margin wallet reservation
-- The application computes the effective hard ceiling from canonical public plan
-- economics. This RPC serializes spend per user/month before an external provider
-- call so concurrent requests cannot overshoot the contribution-margin wallet.

create or replace function public.gogo_reserve_cost_paise(
  p_telegram_id text,
  p_plan_code text,
  p_category text,
  p_estimated_cost_paise integer,
  p_units numeric,
  p_metadata jsonb,
  p_since timestamptz,
  p_hard_ceiling_paise integer
)
returns table(allowed boolean, spent_paise bigint, projected_paise bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent bigint := 0;
  v_cost integer := greatest(coalesce(p_estimated_cost_paise, 0), 0);
  v_ceiling integer := greatest(coalesce(p_hard_ceiling_paise, 0), 0);
begin
  if p_telegram_id is null or length(trim(p_telegram_id)) = 0 then
    return query select false, 0::bigint, v_cost::bigint;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gogo-cogs:' || p_telegram_id || ':' || to_char(p_since at time zone 'Asia/Kolkata','YYYY-MM'), 0));

  select coalesce(sum(estimated_cost_paise), 0)::bigint
  into v_spent
  from public.gogo_cost_events
  where telegram_id = p_telegram_id
    and created_at >= p_since;

  if v_spent + v_cost > v_ceiling then
    return query select false, v_spent, (v_spent + v_cost)::bigint;
    return;
  end if;

  insert into public.gogo_cost_events(
    telegram_id, plan_code, category, estimated_cost_paise, units, metadata_json
  ) values (
    p_telegram_id,
    nullif(trim(coalesce(p_plan_code,'')),''),
    coalesce(nullif(trim(p_category),''),'unknown'),
    v_cost,
    greatest(coalesce(p_units,1),0),
    coalesce(p_metadata,'{}'::jsonb)
  );

  return query select true, v_spent, (v_spent + v_cost)::bigint;
end;
$$;

revoke all on function public.gogo_reserve_cost_paise(text,text,text,integer,numeric,jsonb,timestamptz,integer) from public;
revoke all on function public.gogo_reserve_cost_paise(text,text,text,integer,numeric,jsonb,timestamptz,integer) from anon;
revoke all on function public.gogo_reserve_cost_paise(text,text,text,integer,numeric,jsonb,timestamptz,integer) from authenticated;
grant execute on function public.gogo_reserve_cost_paise(text,text,text,integer,numeric,jsonb,timestamptz,integer) to service_role;
