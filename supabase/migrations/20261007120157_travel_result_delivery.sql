begin;
set local lock_timeout = '5s';

alter table public.notification_deliveries drop constraint if exists notification_deliveries_source_check;
alter table public.notification_deliveries add constraint notification_deliveries_source_check
  check(source in ('briefing','followup','price_comparison','travel_research'));

create or replace function public.publish_web_travel_result(p_owner text,p_run_id uuid,p_content text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare task public.agent_runs%rowtype;
begin
  if p_owner is null or p_owner !~ '^-?[0-9]+$' or p_content is null
    or length(btrim(p_content))=0 or length(p_content)>30000 then raise exception 'invalid_travel_result'; end if;
  select * into task from public.agent_runs where id=p_run_id and telegram_id=p_owner
    and type='travel_research' and source='web' and status in ('completed','failed')
    and metadata_json->>'background_travel'='true' and metadata_json->>'notified' is null for update;
  if not found then return false; end if;
  insert into public.conversations(telegram_id,role,content,created_at)
    values(p_owner::bigint,'assistant',p_content,task.updated_at);
  update public.agent_runs set metadata_json=metadata_json||'{"notified":true}'::jsonb
    where id=p_run_id and telegram_id=p_owner;
  return true;
end $$;
revoke all on function public.publish_web_travel_result(text,uuid,text) from public,anon,authenticated;
grant execute on function public.publish_web_travel_result(text,uuid,text) to service_role;

create or replace function public.due_travel_research_deliveries(p_limit integer default 10)
returns table(id uuid,telegram_id text) language sql stable security invoker set search_path = '' as $$
  select r.id,r.telegram_id::text from public.agent_runs r
  left join public.notification_deliveries n on n.delivery_key='travel_research/'||r.id::text
  where r.type='travel_research' and r.source in ('web','whatsapp') and r.status in ('completed','failed')
    and r.metadata_json->>'background_travel'='true' and r.metadata_json->>'notified' is null
    and (r.source='web' or n.delivery_key is null or (
      n.source='travel_research' and n.channel='whatsapp' and n.owner_id::text=r.telegram_id::text
      and n.send_started_at is null and (n.retry_at is null or n.retry_at<=now())
      and (n.state='pending' or (n.state='claimed' and n.lease_until<now()))
    ))
  order by coalesce(n.retry_at,r.updated_at),r.id limit greatest(1,least(coalesce(p_limit,10),50));
$$;
revoke all on function public.due_travel_research_deliveries(integer) from public,anon,authenticated;
grant execute on function public.due_travel_research_deliveries(integer) to service_role;
commit;
