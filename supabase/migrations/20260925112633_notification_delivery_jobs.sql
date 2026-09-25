begin;
set local lock_timeout='5s';
create table public.notification_deliveries (
  delivery_key text primary key, source text not null check(source in ('briefing','followup')),
  owner_id bigint not null, channel text not null check(channel in ('whatsapp','email')),
  due_at timestamptz not null, state text not null default 'pending' check(state in
    ('pending','claimed','provider_accepted','delivered','read','failed','suppressed','cancelled','outcome_unknown')),
  claim_token uuid, lease_until timestamptz, send_started_at timestamptz,
  attempts integer not null default 0,retry_at timestamptz,provider_id text,
  accepted_at timestamptz,updated_at timestamptz not null default clock_timestamp(),
  receipt_checked_at timestamptz
);
create index notification_attempt on public.notification_deliveries(claim_token);
create index notification_receipt_due on public.notification_deliveries(receipt_checked_at) where state='provider_accepted';
create table public.delivery_scan_cursors(source text primary key,cursor_value bigint not null default -9007199254740991);
alter table public.notification_deliveries enable row level security;
alter table public.delivery_scan_cursors enable row level security;
revoke all on public.notification_deliveries,public.delivery_scan_cursors from public,anon,authenticated;
grant all on public.notification_deliveries,public.delivery_scan_cursors to service_role;

create function public.claim_notification_delivery(p_key text,p_source text,p_owner bigint,p_channel text,p_due timestamptz,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  insert into public.notification_deliveries(delivery_key,source,owner_id,channel,due_at)
    values(p_key,p_source,p_owner,p_channel,p_due) on conflict do nothing;
  update public.notification_deliveries set state='claimed',claim_token=p_token,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
    where delivery_key=p_key and owner_id=p_owner and channel=p_channel and source=p_source
    and due_at<=clock_timestamp() and (retry_at is null or retry_at<=clock_timestamp()) and send_started_at is null
    and (state='pending' or (state='claimed' and lease_until<clock_timestamp()));
  return found;
end $$;
create function public.begin_notification_delivery(p_key text,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  update public.notification_deliveries set state='outcome_unknown',send_started_at=clock_timestamp(),updated_at=clock_timestamp()
    where delivery_key=p_key and claim_token=p_token and state='claimed' and lease_until>clock_timestamp();
  return found;
end $$;
create function public.finish_notification_delivery(p_key text,p_token uuid,p_state text,p_provider_id text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if p_state not in ('provider_accepted','suppressed','cancelled') then raise exception 'invalid_finish'; end if;
  update public.notification_deliveries set state=case when state in ('read','delivered','failed') then state else p_state end,
    provider_id=coalesce(p_provider_id,provider_id),lease_until=null,
    accepted_at=case when p_state='provider_accepted' then coalesce(accepted_at,clock_timestamp()) else accepted_at end,updated_at=clock_timestamp()
    where delivery_key=p_key and claim_token=p_token and state in ('claimed','outcome_unknown','provider_accepted','read','delivered','failed');
  return found;
end $$;
create function public.retry_notification_delivery(p_key text,p_token uuid,p_definite boolean default false) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  update public.notification_deliveries set state=case when p_definite and attempts>=2 then 'failed' else 'pending' end,
    attempts=attempts+1,retry_at=clock_timestamp()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::int),
    send_started_at=null,claim_token=null,lease_until=null,updated_at=clock_timestamp()
    where delivery_key=p_key and claim_token=p_token and (state='claimed' or (state='outcome_unknown' and p_definite));
  return found;
end $$;

create function public.reconcile_delivery_receipt(p_sid text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare receipt public.delivery_receipts; job public.notification_deliveries; total integer; delivered integer; reads integer; failures integer; expected integer; outcome text;
begin
  if public.reconcile_reminder_receipt(p_sid) then return true; end if;
  select * into receipt from public.delivery_receipts where provider_sid=p_sid;
  if not found then return false; end if;
  select * into job from public.notification_deliveries where claim_token=receipt.attempt_token or provider_id=p_sid limit 1 for update;
  if not found then return false; end if;
  select count(distinct chunk),count(distinct chunk) filter(where receipt_verified and status in ('delivered','read')),
    count(distinct chunk) filter(where receipt_verified and status='read'),count(*) filter(where receipt_verified and status in ('failed','undelivered')),
    max(chunks) into total,delivered,reads,failures,expected from public.delivery_receipts where attempt_token=job.claim_token;
  outcome:=case when expected>0 and reads=expected then 'read' when expected>0 and delivered=expected then 'delivered'
    when failures>0 then 'failed' when expected>0 and total=expected then 'provider_accepted' else 'outcome_unknown' end;
  if job.state in ('cancelled','suppressed','read') or (job.state='delivered' and outcome<>'read')
    or (job.state='failed' and outcome not in ('delivered','read')) then return true; end if;
  update public.notification_deliveries set state=outcome,provider_id=coalesce(provider_id,p_sid),
    accepted_at=coalesce(accepted_at,receipt.accepted_at),updated_at=clock_timestamp() where delivery_key=job.delivery_key;
  return true;
end $$;

create or replace function public.reconcile_delivery_callbacks(p_limit integer default 100) returns integer
language plpgsql security invoker set search_path='' as $$
declare item public.delivery_callback_inbox; n integer:=0;
begin
  for item in select * from public.delivery_callback_inbox where processed_at is null and retry_at<=clock_timestamp()
    order by retry_at limit least(greatest(p_limit,1),200) for update skip locked loop
    if public.reconcile_delivery_receipt(item.provider_sid) then
      update public.delivery_callback_inbox set processed_at=clock_timestamp() where event_key=item.event_key;n:=n+1;
    else
      update public.delivery_callback_inbox set retry_at=clock_timestamp()+interval '15 minutes' where event_key=item.event_key;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.claim_notification_delivery(text,text,bigint,text,timestamptz,uuid),
 public.begin_notification_delivery(text,uuid),public.finish_notification_delivery(text,uuid,text,text),
 public.retry_notification_delivery(text,uuid,boolean),public.reconcile_delivery_receipt(text) from public,anon,authenticated;
grant execute on function public.claim_notification_delivery(text,text,bigint,text,timestamptz,uuid),
 public.begin_notification_delivery(text,uuid),public.finish_notification_delivery(text,uuid,text,text),
 public.retry_notification_delivery(text,uuid,boolean),public.reconcile_delivery_receipt(text) to service_role;
commit;
