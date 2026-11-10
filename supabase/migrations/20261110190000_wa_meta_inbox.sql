-- WhatsApp on Meta Cloud API: a durable inbox for inbound messages (10 Nov).
--
-- STATUS: PREPARED, NOT APPLIED. Nothing uses it until GOGO_WA_META_INBOX=1 is set after this has been applied.
-- Rollback: 20261110190000_wa_meta_inbox.rollback.sql
--
-- Why: Meta expects a quick answer to each webhook. Today the webhook waits while the assistant replies, so a slow
-- turn makes Meta deliver the message again. With the inbox, the webhook stores each signed message here and
-- answers at once; a worker hands the messages to the existing pipeline in order, one at a time per person.
--  * message_id is Meta's id: a redelivery lands on the same row and is not stored twice.
--  * The form fields are kept only until the message is handed over; a finished row keeps no message text.
--  * claim_wa_meta_inbox gives a worker at most one message per person, never one whose earlier message is still
--    being handled, with a lease so a crashed worker's message is picked up again.
begin;
set local lock_timeout = '5s';

create table if not exists public.wa_meta_inbox (
  message_id text primary key check (message_id ~ '^wamid\.[A-Za-z0-9+/=_-]{8,}$'),
  sender text not null check (sender ~ '^[0-9]{8,15}$'),
  params jsonb,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  attempts smallint not null default 0,
  lease_until timestamptz,
  last_status integer,
  received_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists wa_meta_inbox_open_idx on public.wa_meta_inbox (received_at) where status in ('pending','processing');
create index if not exists wa_meta_inbox_sender_idx on public.wa_meta_inbox (sender, received_at) where status in ('pending','processing');

create or replace function public.claim_wa_meta_inbox(p_limit integer default 10, p_lease_seconds integer default 150)
returns setof public.wa_meta_inbox
language sql security invoker set search_path = '' as $$
  with live as (
    select distinct sender from public.wa_meta_inbox where status = 'processing' and lease_until > clock_timestamp()
  ), oldest as (
    select distinct on (i.sender) i.message_id from public.wa_meta_inbox i
    where (i.status = 'pending' or (i.status = 'processing' and i.lease_until <= clock_timestamp())) and i.attempts < 5
      and not exists (select 1 from live where live.sender = i.sender)
    order by i.sender, i.received_at
  ), picked as (
    select i.message_id from public.wa_meta_inbox i join oldest using (message_id)
    order by i.received_at limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update of i skip locked
  )
  update public.wa_meta_inbox w set status = 'processing', attempts = w.attempts + 1,
    lease_until = clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 150), 30), 600))
  from picked where w.message_id = picked.message_id
  returning w.*
$$;

alter table public.wa_meta_inbox enable row level security;
revoke all on public.wa_meta_inbox from anon, authenticated;
grant select, insert, update, delete on public.wa_meta_inbox to service_role;
revoke all on function public.claim_wa_meta_inbox(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_wa_meta_inbox(integer, integer) to service_role;
commit;
