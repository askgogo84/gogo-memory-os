begin;
set local lock_timeout = '5s';

-- Selection is separate from the claim/send RPCs. Terminal sends with backoff,
-- unknown outcomes or a final verdict cannot obscure other eligible results.
create or replace function public.due_price_comparison_deliveries(p_limit integer default 20)
returns table(id uuid, telegram_id text)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.telegram_id::text
  from public.agent_runs r
  left join public.notification_deliveries n
    on n.delivery_key = 'price_comparison/' || r.id::text
  where r.type = 'price_comparison' and r.source = 'whatsapp'
    and r.status in ('completed', 'paused')
    and r.metadata_json->>'notified' is null
    and (n.delivery_key is null or (
      n.source = 'price_comparison' and n.channel = 'whatsapp'
      and n.owner_id::text = r.telegram_id::text
      and n.send_started_at is null
      and (n.retry_at is null or n.retry_at <= now())
      and (n.state = 'pending' or (n.state = 'claimed' and n.lease_until < now()))
    ))
  order by coalesce(n.retry_at, r.updated_at), r.id
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.due_price_comparison_deliveries(integer) from public, anon, authenticated;
grant execute on function public.due_price_comparison_deliveries(integer) to service_role;
commit;
