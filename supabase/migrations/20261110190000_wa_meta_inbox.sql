-- WhatsApp on Meta Cloud API: a durable inbox for inbound messages (10 Nov).
--
-- STATUS: PREPARED, NOT APPLIED. Nothing uses it until GOGO_WA_META_INBOX=1 is set after this has been applied.
-- Rollback: 20261110190000_wa_meta_inbox.rollback.sql
--
-- Why: Meta expects a quick answer to each webhook. Today the webhook waits while the assistant replies, so a slow
-- turn makes Meta deliver the message again. With the inbox, the webhook stores each signed message here and
-- answers at once; a worker hands the messages to the existing pipeline in order, one at a time per person.
--  * message_id is Meta's id: a redelivery lands on the same row and is not stored twice.
--  * seq keeps the order of messages stored in the same instant (one webhook can carry several).
--  * claim_wa_meta_inbox gives a worker at most one message per person, never one whose earlier message is still
--    being handled or still waiting, with a lease and a lease id so a stale worker cannot overwrite a newer claim.
--  * A failed hand-over waits (next_attempt_at, growing) instead of being retried at once, and a message is given up
--    only after six hours, not after a burst of quick failures.
--  * The form fields are kept only until the message is handed over or given up; finished rows are deleted after
--    three days (sweep_wa_meta_inbox).
begin;
set local lock_timeout = '5s';

create table if not exists public.wa_meta_inbox (
  message_id text primary key check (message_id ~ '^wamid\.[A-Za-z0-9+/=_-]{8,}$'),
  seq bigint generated always as identity,
  sender text not null check (sender ~ '^[0-9]{8,15}$'),
  params jsonb,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  attempts integer not null default 0,
  no_notice boolean not null default false, -- a STOP message: never answered with a resend notice
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  last_status integer,
  received_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists wa_meta_inbox_open_idx on public.wa_meta_inbox (received_at, seq) where status in ('pending','processing');
create index if not exists wa_meta_inbox_sender_idx on public.wa_meta_inbox (sender, received_at, seq) where status in ('pending','processing');
create index if not exists wa_meta_inbox_finished_idx on public.wa_meta_inbox (finished_at) where status in ('done','failed');

create or replace function public.claim_wa_meta_inbox(p_limit integer default 10, p_lease_seconds integer default 150)
returns setof public.wa_meta_inbox
language sql security invoker set search_path = '' as $$
  with live as (
    select distinct sender from public.wa_meta_inbox where status = 'processing' and lease_until > clock_timestamp()
  ), first_open as (
    -- Each person's earliest unfinished message, whether or not it is due yet: a later message never overtakes it.
    select distinct on (i.sender) i.message_id, i.sender from public.wa_meta_inbox i
    where i.status in ('pending','processing')
    order by i.sender, i.received_at, i.seq
  ), due as (
    select f.message_id from first_open f join public.wa_meta_inbox i using (message_id)
    where not exists (select 1 from live where live.sender = f.sender)
      and i.next_attempt_at <= clock_timestamp() and i.received_at > clock_timestamp() - interval '6 hours'
  ), picked as (
    select i.message_id from public.wa_meta_inbox i join due using (message_id)
    -- Checked again on the locked row: a row another worker claimed after this statement's snapshot is not taken.
    where (i.status = 'pending' and i.next_attempt_at <= clock_timestamp()) or (i.status = 'processing' and i.lease_until <= clock_timestamp())
    order by i.received_at, i.seq limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update of i skip locked
  )
  update public.wa_meta_inbox w set status = 'processing', attempts = w.attempts + 1, lease_id = gen_random_uuid(),
    lease_until = clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 150), 30), 600))
  from picked where w.message_id = picked.message_id
  returning w.*
$$;

-- Gives up messages older than six hours that were never handed over (their text is cleared), and deletes finished
-- rows after three days. Returns the senders whose message was given up, so they can be asked to send it again.
create or replace function public.sweep_wa_meta_inbox() returns table (sender text)
language sql security invoker set search_path = '' as $$
  with gave_up as (
    update public.wa_meta_inbox w set status = 'failed', params = null, lease_id = null, lease_until = null, finished_at = clock_timestamp()
    where w.status in ('pending','processing') and w.received_at <= clock_timestamp() - interval '6 hours'
      and (w.status = 'pending' or w.lease_until <= clock_timestamp())
    returning w.sender, w.received_at
  ), purged as (
    delete from public.wa_meta_inbox where status in ('done','failed') and finished_at < clock_timestamp() - interval '3 days'
  )
  -- Who to ask to send it again: at most once a day per person, only inside Meta's 24-hour reply window, and never
  -- someone who sent STOP in that time. (The CTE reads the table as it was before this statement, so the rows given up
  -- just now are not yet 'failed' there; an earlier give-up in the last day is, and suppresses a second notice.)
  select distinct g.sender from gave_up g
  where g.received_at > clock_timestamp() - interval '24 hours'
    and not exists (select 1 from public.wa_meta_inbox f where f.sender = g.sender and f.status = 'failed' and f.finished_at > clock_timestamp() - interval '24 hours')
    and not exists (select 1 from public.wa_meta_inbox x where x.sender = g.sender and x.no_notice and x.received_at > clock_timestamp() - interval '24 hours')
$$;

alter table public.wa_meta_inbox enable row level security;
revoke all on public.wa_meta_inbox from anon, authenticated;
grant select, insert, update, delete on public.wa_meta_inbox to service_role;
grant usage, select on sequence public.wa_meta_inbox_seq_seq to service_role;
revoke all on function public.claim_wa_meta_inbox(integer, integer), public.sweep_wa_meta_inbox() from public, anon, authenticated;
grant execute on function public.claim_wa_meta_inbox(integer, integer), public.sweep_wa_meta_inbox() to service_role;
commit;
