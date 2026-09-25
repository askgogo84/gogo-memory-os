begin;
set local lock_timeout='5s';
alter table public.followups add column owner_id bigint,add column provider_sid text,
  add column delivery_status text not null default 'pending';
create index followup_owner_due on public.followups(check_at) where status='pending' and owner_id is not null;

create function public.due_followup_deliveries(p_limit integer default 50) returns setof public.followups
language sql security invoker set search_path='' as $$
  select f.* from public.followups f left join public.notification_deliveries j on j.delivery_key='followup/'||f.id::text
    where f.status='pending' and f.owner_id is not null and f.check_at<=clock_timestamp()
      and (j.delivery_key is null or (j.send_started_at is null and (j.retry_at is null or j.retry_at<=clock_timestamp())
        and (j.state='pending' or (j.state='claimed' and j.lease_until<clock_timestamp()))))
    order by f.check_at,f.id limit least(greatest(p_limit,1),50);
$$;
create function public.sync_followup_delivery_status() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.source='followup' then
    update public.followups set delivery_status=new.state,provider_sid=coalesce(new.provider_id,provider_sid)
      where id::text=split_part(new.delivery_key,'/',2) and owner_id=new.owner_id;
  end if;
  return new;
end $$;
create trigger notification_followup_status after update on public.notification_deliveries
for each row execute function public.sync_followup_delivery_status();
revoke all on function public.due_followup_deliveries(integer),public.sync_followup_delivery_status() from public,anon,authenticated;
grant execute on function public.due_followup_deliveries(integer) to service_role;
commit;
