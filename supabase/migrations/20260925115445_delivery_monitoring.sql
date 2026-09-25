begin;
set local lock_timeout='5s';
create table public.delivery_worker_runs(
  id uuid primary key default gen_random_uuid(),source text not null check(source in ('reminders','briefing','followup')),
  started_at timestamptz not null default clock_timestamp(),finished_at timestamptz,ok boolean,http_status integer
);
create index delivery_worker_recent on public.delivery_worker_runs(source,started_at desc);
alter table public.delivery_worker_runs enable row level security;
revoke all on public.delivery_worker_runs from public,anon,authenticated;
grant all on public.delivery_worker_runs to service_role;
create function public.start_delivery_worker(p_source text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
  delete from public.delivery_worker_runs where id in
    (select id from public.delivery_worker_runs where started_at<clock_timestamp()-interval '30 days' order by started_at limit 200);
  if p_source='briefing' then
    update public.notification_deliveries set state='cancelled',lease_until=null,updated_at=clock_timestamp()
      where source='briefing' and state in ('pending','claimed') and send_started_at is null
        and due_at < (date_trunc('day',clock_timestamp() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
  end if;
  insert into public.delivery_worker_runs(source) values(p_source) returning id into result;
  return result;
end $$;
create function public.finish_delivery_worker(p_id uuid,p_ok boolean,p_status integer) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  update public.delivery_worker_runs set finished_at=clock_timestamp(),ok=p_ok,http_status=p_status where id=p_id and finished_at is null;
  return found;
end $$;
create function public.delivery_health_report() returns jsonb
language sql security invoker set search_path='' as $$
with sources(source,max_age) as (values ('reminders',180),('briefing',1800),('followup',90000)),
beats as (select s.source,s.max_age,max(r.started_at) as last_started,max(r.finished_at) filter(where r.ok) as last_success,
  count(*) filter(where r.ok=false and r.started_at>clock_timestamp()-interval '24 hours') as failed_runs_24h
  from sources s left join public.delivery_worker_runs r on r.source=s.source group by s.source,s.max_age),
queue as (
  select 'reminders' as source,remind_at as due from public.reminders where not sent and delivery_state in ('pending','claimed')
  union all select 'briefing',due_at from public.notification_deliveries where source='briefing' and state in ('pending','claimed')
  union all select 'followup',f.check_at from public.followups f left join public.notification_deliveries j on j.delivery_key='followup/'||f.id::text
    where f.status='pending' and f.owner_id is not null and (j.delivery_key is null or j.state in ('pending','claimed'))),
states as (
  select delivery_state as state,send_started_at,coalesce(sent_at,send_started_at) as accepted_at from public.reminders
  union all select state,send_started_at,accepted_at from public.notification_deliveries),
duplicates as (select attempt_token,chunk from public.delivery_receipts where attempt_token is not null
  group by attempt_token,chunk having count(distinct provider_sid)>1)
select jsonb_build_object(
  'observed_at',clock_timestamp(),
  'scheduler',(select jsonb_agg(jsonb_build_object('source',source,'last_started',last_started,'last_success',last_success,
    'failed_runs_24h',failed_runs_24h,'status',case when last_started is null then 'not_observed'
      when last_success is null or extract(epoch from clock_timestamp()-last_success)>max_age then 'stale_or_failing' else 'healthy' end)) from beats),
  'queues',(select jsonb_agg(jsonb_build_object('source',s.source,'depth',(select count(*) from queue q where q.source=s.source),
    'overdue',(select count(*) from queue q where q.source=s.source and due<clock_timestamp()),
    'oldest_overdue_seconds',(select greatest(0,extract(epoch from clock_timestamp()-min(due))) from queue q where q.source=s.source and due<clock_timestamp()))) from sources s),
  'provider_accepted',(select count(*) from states where state='provider_accepted'),
  'oldest_acceptance_without_receipt_seconds',(select extract(epoch from clock_timestamp()-min(accepted_at)) from states where state='provider_accepted'),
  'new_outcome_unknown',(select count(*) from states where state='outcome_unknown' and send_started_at is not null),
  'historical_unconfirmed',(select count(*) from states where state='outcome_unknown' and send_started_at is null),
  'failed',(select count(*) from states where state='failed'),
  'duplicate_chunk_groups',(select count(*) from duplicates),
  'unmatched_callbacks',(select count(*) from public.delivery_callback_inbox where processed_at is null),
  'ownerless_followups',(select count(*) from public.followups where status='pending' and owner_id is null)
);
$$;
revoke all on function public.start_delivery_worker(text),public.finish_delivery_worker(uuid,boolean,integer),public.delivery_health_report() from public,anon,authenticated;
grant execute on function public.start_delivery_worker(text),public.finish_delivery_worker(uuid,boolean,integer),public.delivery_health_report() to service_role;
commit;
