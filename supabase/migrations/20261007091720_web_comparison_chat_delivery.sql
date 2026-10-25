begin;
set local lock_timeout = '5s';

-- Called only by the trusted completion worker; user sessions cannot publish.
create or replace function public.publish_web_comparison_result(p_owner text,p_run_id uuid,p_content text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  comparison public.agent_runs%rowtype;
begin
  if p_owner is null or p_owner !~ '^-?[0-9]+$' or p_content is null
    or length(btrim(p_content))=0 or length(p_content)>30000 then
    raise exception 'invalid_comparison_result';
  end if;
  select * into comparison from public.agent_runs
    where id=p_run_id and telegram_id=p_owner and type='price_comparison'
      and source='web' and status in ('completed','paused')
      and metadata_json->>'notified' is null
    for update;
  if not found then return false; end if;
  insert into public.conversations(telegram_id,role,content,created_at)
    values(p_owner::bigint,'assistant',p_content,comparison.updated_at);
  update public.agent_runs set metadata_json=metadata_json||'{"notified":true}'::jsonb
    where id=p_run_id and telegram_id=p_owner;
  return true;
end;
$$;
revoke all on function public.publish_web_comparison_result(text,uuid,text) from public,anon,authenticated;
grant execute on function public.publish_web_comparison_result(text,uuid,text) to service_role;
commit;
