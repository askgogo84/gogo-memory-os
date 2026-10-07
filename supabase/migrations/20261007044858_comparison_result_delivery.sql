begin;
set local lock_timeout = '5s';

-- Reuse the delivery receipt outbox for completed retailer reads. The result
-- remains in agent_runs; this row only tracks whether WhatsApp accepted it.
alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_source_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_source_check
  check (source in ('briefing', 'followup', 'price_comparison'));

-- A definite provider rejection is safe to retry. Allow a longer bounded
-- recovery window for comparison results so a temporary Twilio account outage
-- does not consume all attempts before the account is restored. Ambiguous
-- network outcomes still remain outcome_unknown and are never resent blindly.
create or replace function public.retry_notification_delivery(
  p_key text, p_token uuid, p_definite boolean default false
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.notification_deliveries%rowtype;
begin
  select * into job from public.notification_deliveries
    where delivery_key = p_key and claim_token = p_token
      and (state = 'claimed' or (state = 'outcome_unknown' and p_definite))
    for update;
  if not found then return false; end if;

  update public.notification_deliveries
    set state = case when attempts + 1 >= case when job.source = 'price_comparison' then 72 else 3 end
      then 'failed' else 'pending' end,
      attempts = attempts + 1,
      retry_at = clock_timestamp() + make_interval(secs => least(3600, 60 * power(2, least(attempts, 6)))::int),
      send_started_at = null, claim_token = null, lease_until = null,
      updated_at = clock_timestamp()
    where delivery_key = p_key and claim_token = p_token;
  return found;
end $$;

revoke all on function public.retry_notification_delivery(text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.retry_notification_delivery(text, uuid, boolean)
  to service_role;
commit;
