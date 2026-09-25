begin;
set local lock_timeout = '5s';

alter table public.reminders
  add column delivery_state text not null default 'pending'
    check (delivery_state in ('pending','claimed','provider_accepted','delivered','read','failed','suppressed','cancelled','outcome_unknown')),
  add column claim_token uuid,
  add column lease_until timestamptz,
  add column send_started_at timestamptz,
  add column retry_at timestamptz,
  add column recurrence_parent_id uuid,
  add column next_occurrence_id uuid;
create unique index reminders_recurrence_parent on public.reminders(recurrence_parent_id) where recurrence_parent_id is not null;
create index reminders_delivery_queue on public.reminders(remind_at) where not sent and delivery_state in ('pending','claimed');
update public.reminders set delivery_state = case
  when delivery_status in ('delivered','read') then delivery_status
  when delivery_status in ('failed','undelivered','abandoned') then 'failed'
  when delivery_status = 'suppressed' then 'suppressed'
  when twilio_sid is not null then 'provider_accepted'
  when sent then 'outcome_unknown' else 'pending' end;

-- Legacy cancel/move writers still use sent/remind_at. Fence stale claims without
-- asking every UI writer to understand worker leases. Never reopen an unknown send.
create function public.reminder_delivery_compat() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.send_started_at is not null and new.remind_at is distinct from old.remind_at
    and old.delivery_state = 'outcome_unknown' then
    raise exception 'unknown_delivery_requires_reconciliation';
  end if;
  if new.sent and not old.sent and new.delivery_state = old.delivery_state
    and old.send_started_at is null then
    new.delivery_state := 'cancelled'; new.claim_token := null; new.lease_until := null;
  elsif (new.remind_at is distinct from old.remind_at or new.message is distinct from old.message
    or new.whatsapp_to is distinct from old.whatsapp_to or new.telegram_id is distinct from old.telegram_id
    or new.recurring_pattern is distinct from old.recurring_pattern)
    and new.delivery_state = old.delivery_state and old.send_started_at is null then
    new.delivery_state := 'pending'; new.claim_token := null; new.lease_until := null;
    new.send_started_at := null; new.retry_at := null;
  end if;
  return new;
end $$;
create trigger reminders_delivery_compat before update on public.reminders
for each row execute function public.reminder_delivery_compat();

create function public.claim_reminder_delivery(p_id uuid, p_token uuid) returns setof public.reminders
language sql security invoker set search_path = '' as $$
  update public.reminders set delivery_state='claimed', claim_token=p_token,
    lease_until=clock_timestamp()+interval '90 seconds'
  where id=p_id and not sent and remind_at<=clock_timestamp()
    and (retry_at is null or retry_at<=clock_timestamp())
    and send_started_at is null
    and (delivery_state='pending' or (delivery_state='claimed' and lease_until<clock_timestamp()))
  returning *;
$$;

-- A durable intent is written BEFORE any network send. A crash after this point
-- is ambiguous and cannot be reclaimed. The next recurrence is in this SAME
-- transaction, so an insert error prevents the send, never terminates the series.
create function public.begin_reminder_delivery(p_id uuid, p_token uuid, p_due timestamptz,
  p_next timestamptz, p_timezone text, p_target text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare r public.reminders; child uuid;
begin
  select * into r from public.reminders where id=p_id for update;
  if not found or r.sent or r.delivery_state<>'claimed' or r.claim_token is distinct from p_token
    or r.lease_until<=clock_timestamp() or r.remind_at is distinct from p_due then return false; end if;
  if p_next is not null and r.is_recurring and r.recurring_pattern is not null and r.next_occurrence_id is null then
    if p_next<=clock_timestamp() or p_next<=r.remind_at then raise exception 'next_occurrence_must_be_future'; end if;
    insert into public.reminders(telegram_id,chat_id,whatsapp_to,message,remind_at,sent,
      is_recurring,recurring_pattern,timezone,nudge_count,followup_started_at,recurrence_parent_id)
    values(r.telegram_id,r.chat_id,coalesce(r.whatsapp_to,p_target),r.message,p_next,false,
      true,r.recurring_pattern,coalesce(r.timezone,p_timezone),coalesce(r.nudge_count,0)+1,
      case when r.recurring_pattern like 'followup:%' then coalesce(r.followup_started_at,clock_timestamp()) else r.followup_started_at end,r.id)
    on conflict (recurrence_parent_id) where recurrence_parent_id is not null do nothing
    returning id into child;
    if child is null then
      -- Existing insert-dedup trigger can suppress an identical pending row.
      select id into child from public.reminders where recurrence_parent_id=r.id
        or (not sent and telegram_id is not distinct from r.telegram_id
          and coalesce(whatsapp_to,'')=coalesce(r.whatsapp_to,p_target,'')
          and lower(trim(message))=lower(trim(r.message)) and remind_at=p_next)
      order by created_at limit 1;
    end if;
    if child is null then raise exception 'recurrence_insert_unconfirmed'; end if;
    update public.reminders set next_occurrence_id=child where id=r.id;
  end if;
  update public.reminders set delivery_state='outcome_unknown',send_started_at=clock_timestamp()
    where id=r.id;
  return true;
end $$;

create function public.finish_reminder_delivery(p_id uuid,p_token uuid,p_state text,p_sid text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_state not in ('provider_accepted','suppressed','failed','outcome_unknown') then raise exception 'invalid_delivery_finish'; end if;
  update public.reminders set sent=true,sent_at=case when p_state='provider_accepted' then clock_timestamp() else sent_at end,
    delivery_state=case when delivery_state in ('delivered','read') then delivery_state else p_state end,
    twilio_sid=coalesce(p_sid,twilio_sid),
    delivery_status=case when delivery_status in ('delivered','read') then delivery_status
      when p_state='provider_accepted' then 'accepted' else p_state end,
    lease_until=null
    where id=p_id and claim_token=p_token and delivery_state in ('claimed','outcome_unknown','delivered','read');
  return found;
end $$;

-- Called only for a failure before the network boundary or a definite 4xx rejection.
create function public.retry_reminder_delivery(p_id uuid,p_token uuid,p_definite_rejection boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.reminders set fail_attempts=coalesce(fail_attempts,0)+1,last_failed_at=clock_timestamp(),
    sent=p_definite_rejection and coalesce(fail_attempts,0)+1>=3,
    delivery_state=case when p_definite_rejection and coalesce(fail_attempts,0)+1>=3 then 'failed' else 'pending' end,
    retry_at=clock_timestamp()+ make_interval(secs=>least(3600,60*power(2,least(6,coalesce(fail_attempts,0))))::int),
    claim_token=null,lease_until=null,send_started_at=null
    where id=p_id and claim_token=p_token and not sent
    and (delivery_state='claimed' or (delivery_state='outcome_unknown' and p_definite_rejection));
  return found;
end $$;

revoke all on function public.reminder_delivery_compat() from public,anon,authenticated;
revoke all on function public.claim_reminder_delivery(uuid,uuid) from public,anon,authenticated;
revoke all on function public.begin_reminder_delivery(uuid,uuid,timestamptz,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.finish_reminder_delivery(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.retry_reminder_delivery(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_reminder_delivery(uuid,uuid),
  public.begin_reminder_delivery(uuid,uuid,timestamptz,timestamptz,text,text),
  public.finish_reminder_delivery(uuid,uuid,text,text),public.retry_reminder_delivery(uuid,uuid,boolean) to service_role;
commit;
