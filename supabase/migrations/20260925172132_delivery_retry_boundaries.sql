begin;
set local lock_timeout='5s';
-- Bound both preflight failures and definite provider rejections. Ambiguous
-- network outcomes are excluded by the existing predicate and never retried.
create or replace function public.retry_reminder_delivery(p_id uuid,p_token uuid,p_definite_rejection boolean default false)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.reminders set fail_attempts=coalesce(fail_attempts,0)+1,last_failed_at=clock_timestamp(),
    sent=coalesce(fail_attempts,0)+1>=3,
    delivery_state=case when coalesce(fail_attempts,0)+1>=3 then 'failed' else 'pending' end,
    retry_at=clock_timestamp()+make_interval(secs=>least(3600,60*power(2,least(6,coalesce(fail_attempts,0))))::int),
    claim_token=null,lease_until=null,send_started_at=null
    where id=p_id and claim_token=p_token and not sent
      and (delivery_state='claimed' or (delivery_state='outcome_unknown' and p_definite_rejection));
  return found;
end $$;
create or replace function public.retry_notification_delivery(p_key text,p_token uuid,p_definite boolean default false) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  update public.notification_deliveries set state=case when attempts>=2 then 'failed' else 'pending' end,
    attempts=attempts+1,retry_at=clock_timestamp()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::int),
    send_started_at=null,claim_token=null,lease_until=null,updated_at=clock_timestamp()
    where delivery_key=p_key and claim_token=p_token and (state='claimed' or (state='outcome_unknown' and p_definite));
  return found;
end $$;
create or replace function public.begin_notification_delivery(p_key text,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare job public.notification_deliveries; source_row public.followups;
begin
  select * into job from public.notification_deliveries where delivery_key=p_key and claim_token=p_token
    and state='claimed' and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  if job.source='followup' then
    select * into source_row from public.followups where id::text=split_part(p_key,'/',2) for update;
    if not found or source_row.owner_id is distinct from job.owner_id or source_row.status<>'pending'
      or source_row.check_at>clock_timestamp() then
      update public.notification_deliveries set state='cancelled',lease_until=null,updated_at=clock_timestamp() where delivery_key=p_key;
      return false;
    end if;
  end if;
  update public.notification_deliveries set state='outcome_unknown',send_started_at=clock_timestamp(),updated_at=clock_timestamp()
    where delivery_key=p_key;
  return true;
end $$;
revoke all on function public.retry_reminder_delivery(uuid,uuid,boolean),public.retry_notification_delivery(text,uuid,boolean),
  public.begin_notification_delivery(text,uuid) from public,anon,authenticated;
grant execute on function public.retry_reminder_delivery(uuid,uuid,boolean),public.retry_notification_delivery(text,uuid,boolean),
  public.begin_notification_delivery(text,uuid) to service_role;
commit;
