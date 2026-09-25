begin;
set local lock_timeout='5s';
create table public.delivery_callback_inbox (
  event_key text primary key, provider_sid text not null, status text not null,
  error_code text, attempt_token uuid, chunk integer, chunks integer,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz, retry_at timestamptz not null default clock_timestamp()
);
create index delivery_callback_retry on public.delivery_callback_inbox(retry_at) where processed_at is null;
create table public.delivery_receipts (
  provider_sid text primary key, attempt_token uuid, chunk integer, chunks integer,
  status text not null, receipt_verified boolean not null default false,
  accepted_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index delivery_receipts_attempt on public.delivery_receipts(attempt_token);
alter table public.delivery_callback_inbox enable row level security;
alter table public.delivery_receipts enable row level security;
revoke all on public.delivery_callback_inbox,public.delivery_receipts from public,anon,authenticated;
grant all on public.delivery_callback_inbox,public.delivery_receipts to service_role;

create function public.delivery_status_rank(s text) returns integer language sql immutable
security invoker set search_path='' as $$ select case s when 'read' then 100 when 'delivered' then 90
 when 'failed' then 80 when 'undelivered' then 80 when 'sent' then 30 when 'sending' then 25
 when 'queued' then 20 when 'accepted' then 10 else 0 end $$;

create function public.record_delivery_receipt(p_sid text,p_status text,p_verified boolean,
 p_token uuid default null,p_chunk integer default null,p_chunks integer default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if not p_verified and p_status<>'accepted' then raise exception 'acceptance_cannot_verify_delivery'; end if;
  if p_sid is null or length(p_sid)=0 then raise exception 'missing_provider_sid'; end if;
  insert into public.delivery_receipts(provider_sid,status,receipt_verified,attempt_token,chunk,chunks)
  values(p_sid,p_status,p_verified,p_token,p_chunk,p_chunks)
  on conflict(provider_sid) do update set
    status=case when public.delivery_status_rank(excluded.status)>public.delivery_status_rank(delivery_receipts.status)
      then excluded.status else delivery_receipts.status end,
    receipt_verified=delivery_receipts.receipt_verified or excluded.receipt_verified,
    attempt_token=coalesce(delivery_receipts.attempt_token,excluded.attempt_token),
    chunk=coalesce(delivery_receipts.chunk,excluded.chunk),chunks=coalesce(delivery_receipts.chunks,excluded.chunks),updated_at=clock_timestamp();
end $$;

-- Aggregate ALL expected chunks, never just the last returned SID. No receipt
-- changes sent/remind_at or creates/requeues an occurrence.
create function public.reconcile_reminder_receipt(p_sid text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare receipt public.delivery_receipts; r public.reminders; total integer; delivered integer; reads integer; failures integer; expected integer; state text;
begin
  select * into receipt from public.delivery_receipts where provider_sid=p_sid;
  if not found then return false; end if;
  select * into r from public.reminders where twilio_sid=p_sid or (receipt.attempt_token is not null and claim_token=receipt.attempt_token)
    order by id limit 1 for update;
  if not found then return false; end if;
  if receipt.attempt_token is not null then
    select count(distinct chunk),count(distinct chunk) filter(where receipt_verified and status in ('delivered','read')),
      count(distinct chunk) filter(where receipt_verified and status='read'),count(*) filter(where receipt_verified and status in ('failed','undelivered')),
      max(chunks) into total,delivered,reads,failures,expected
      from public.delivery_receipts where attempt_token=receipt.attempt_token;
    state:=case when expected>0 and reads=expected then 'read' when expected>0 and delivered=expected then 'delivered'
      when failures>0 then 'failed' when expected>0 and total=expected then 'provider_accepted' else 'outcome_unknown' end;
  else
    state:=case when receipt.receipt_verified and receipt.status in ('read','delivered') then receipt.status
      when receipt.receipt_verified and receipt.status in ('failed','undelivered') then 'failed' else 'provider_accepted' end;
  end if;
  -- Strong receipt evidence dominates delayed acceptance/failure events.
  if r.delivery_state='read' or (r.delivery_state='delivered' and state<>'read') then return true; end if;
  if r.delivery_state='failed' and state not in ('delivered','read') then return true; end if;
  if r.delivery_state in ('suppressed','cancelled') then return true; end if;
  update public.reminders set delivery_state=state,delivery_status=case when state='provider_accepted' then 'accepted' else state end,
    twilio_sid=coalesce(twilio_sid,p_sid) where id=r.id;
  return true;
end $$;

create or replace function public.finish_reminder_delivery(p_id uuid,p_token uuid,p_state text,p_sid text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_state not in ('provider_accepted','suppressed','failed','outcome_unknown') then raise exception 'invalid_delivery_finish'; end if;
  update public.reminders set sent=true,sent_at=case when p_state='provider_accepted' then clock_timestamp() else sent_at end,
    delivery_state=case when delivery_state in ('delivered','read','failed') then delivery_state else p_state end,
    twilio_sid=coalesce(p_sid,twilio_sid),
    delivery_status=case when delivery_status in ('delivered','read','failed','undelivered') then delivery_status
      when p_state='provider_accepted' then 'accepted' else p_state end,lease_until=null
    where id=p_id and claim_token=p_token and delivery_state in ('claimed','outcome_unknown','provider_accepted','delivered','read','failed');
  if not found then return false; end if;
  if p_sid is not null then perform public.reconcile_reminder_receipt(p_sid); end if;
  return true;
end $$;

create function public.ingest_delivery_callback(p_key text,p_sid text,p_status text,p_error text,
 p_token uuid default null,p_chunk integer default null,p_chunks integer default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
  insert into public.delivery_callback_inbox(event_key,provider_sid,status,error_code,attempt_token,chunk,chunks)
    values(p_key,p_sid,p_status,p_error,p_token,p_chunk,p_chunks) on conflict do nothing;
  perform public.record_delivery_receipt(p_sid,p_status,true,p_token,p_chunk,p_chunks);
end $$;

create function public.reconcile_delivery_callbacks(p_limit integer default 100) returns integer
language plpgsql security invoker set search_path='' as $$
declare item public.delivery_callback_inbox; n integer:=0;
begin
  for item in select * from public.delivery_callback_inbox where processed_at is null and retry_at<=clock_timestamp()
    order by retry_at limit least(greatest(p_limit,1),200) for update skip locked loop
    if public.reconcile_reminder_receipt(item.provider_sid) then
      update public.delivery_callback_inbox set processed_at=clock_timestamp() where event_key=item.event_key;
      n:=n+1;
    else
      update public.delivery_callback_inbox set retry_at=clock_timestamp()+interval '15 minutes' where event_key=item.event_key;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.delivery_status_rank(text),public.record_delivery_receipt(text,text,boolean,uuid,integer,integer),
 public.reconcile_reminder_receipt(text),public.ingest_delivery_callback(text,text,text,text,uuid,integer,integer),
 public.reconcile_delivery_callbacks(integer) from public,anon,authenticated;
grant execute on function public.delivery_status_rank(text),public.record_delivery_receipt(text,text,boolean,uuid,integer,integer),
 public.reconcile_reminder_receipt(text),public.ingest_delivery_callback(text,text,text,text,uuid,integer,integer),
 public.reconcile_delivery_callbacks(integer) to service_role;
commit;
