begin;
set local lock_timeout='5s';
create index delivery_callback_latency on public.delivery_callback_inbox(provider_sid,received_at)
  where status in ('delivered','read');
-- Aggregate only. No owner IDs, destinations, provider IDs or payloads leave this RPC.
create function public.delivery_health_details() returns jsonb
language sql security invoker set search_path='' as $$
with ledger as (
 select 'reminders' as source,delivery_state as state,lease_until,send_started_at,
   coalesce(fail_attempts,0) as attempts,claim_token,sent_at as accepted_at from public.reminders
 union all select source,state,lease_until,send_started_at,attempts,claim_token,accepted_at from public.notification_deliveries
), sources(source) as (values ('reminders'),('briefing'),('followup')),
first_receipt as (
 select r.attempt_token,r.chunk,r.chunks,r.provider_sid,min(i.received_at) as delivered_at
 from public.delivery_receipts r join public.delivery_callback_inbox i on i.provider_sid=r.provider_sid
   and i.status in ('delivered','read')
 where r.receipt_verified and r.status in ('delivered','read') and r.attempt_token is not null
 group by r.attempt_token,r.chunk,r.chunks,r.provider_sid
), complete_receipt as (
 select attempt_token,max(delivered_at) as delivered_at from first_receipt
 group by attempt_token having max(chunks)>0 and count(*)=max(chunks) and count(distinct chunk)=max(chunks)
), measured as (
 select extract(epoch from c.delivered_at-l.accepted_at) as seconds
 from ledger l join complete_receipt c on c.attempt_token=l.claim_token
 where l.state in ('delivered','read') and l.accepted_at>=clock_timestamp()-interval '7 days'
)
select jsonb_build_object(
 'state_counts',(select jsonb_agg(jsonb_build_object('source',s.source,'states',coalesce(
   (select jsonb_object_agg(state,n) from (select state,count(*) as n from ledger where source=s.source group by state) x),'{}'::jsonb))) from sources s),
 'claims',(select jsonb_agg(jsonb_build_object('source',s.source,
   'active',(select count(*) from ledger where source=s.source and state='claimed' and send_started_at is null and lease_until>clock_timestamp()),
   'expired',(select count(*) from ledger where source=s.source and state='claimed' and send_started_at is null and lease_until<=clock_timestamp()),
   'dead_letters',(select count(*) from ledger where source=s.source and state='failed' and attempts>=3))) from sources s),
 'reconciliation_oldest_unmatched_seconds',(select extract(epoch from clock_timestamp()-min(received_at)) from public.delivery_callback_inbox where processed_at is null),
 'acceptance_to_delivery_observed',jsonb_build_object(
   'window_days',7,'channel','whatsapp','definition','persisted acceptance to arrival of signed delivery/read receipts for every chunk; not handset delivery time',
   'samples',(select count(*) from measured where seconds>=0),
   'excluded_early_receipts',(select count(*) from measured where seconds<0),
   'median_seconds',(select percentile_cont(0.5) within group(order by seconds) from measured where seconds>=0),
   'p95_seconds',(select percentile_cont(0.95) within group(order by seconds) from measured where seconds>=0))
);
$$;
create or replace function public.delivery_health_report() returns jsonb
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
) || public.delivery_health_details();
$$;
revoke all on function public.delivery_health_details(),public.delivery_health_report() from public,anon,authenticated;
grant execute on function public.delivery_health_details(),public.delivery_health_report() to service_role;
commit;
