-- AskGogo Events v2 (10 Nov): fixes from the independent review of the guest flow.
--
-- STATUS: PREPARED, NOT APPLIED. Until this runs, answering through an event's share link reports "not available";
-- everything else keeps working on the first migration. Rollback: 20261110170000_gogo_events_v2.rollback.sql
--
-- What changes
--  * Share-link answers are ONE transaction (gogo_event_join_rsvp): a refused first answer (event full, closed)
--    leaves no guest row behind, and a retry with the same personal token lands on the same guest instead of
--    creating a second one.
--  * The share-link guest limit counts only live share-link guests, so the organizer's own list or revoked guests
--    can never switch the link off.
--  * An identical repeat answer changes nothing and is not counted; declining is always allowed.
--  * share_nonce: the share link can be rotated (the old link stops working for good).
--  * A revoked guest no longer blocks adding the same phone number again.
--  * gogo_event_rate_hit: a small fixed-window counter the public endpoint uses to bound requests.
--  * pending_action: a cancel or time change on a published event waits for the organizer's explicit yes.
begin;
set local lock_timeout = '5s';

alter table public.gogo_events add column if not exists share_nonce integer not null default 0 check (share_nonce >= 0);
-- A cancel or a time change on a published event waits here for the organizer's explicit yes.
alter table public.gogo_events add column if not exists pending_action jsonb;

drop index if exists public.gogo_event_guests_phone_once;
create unique index if not exists gogo_event_guests_phone_once on public.gogo_event_guests (event_id, phone) where phone is not null and token_revoked_at is null;

create table if not exists public.gogo_event_rate (
  bucket text primary key check (char_length(bucket) between 8 and 100),
  window_start timestamptz not null default now(),
  hits integer not null default 0
);
alter table public.gogo_event_rate enable row level security;
revoke all on public.gogo_event_rate from anon, authenticated;
grant select, insert, update, delete on public.gogo_event_rate to service_role;
create index if not exists gogo_event_rate_window_idx on public.gogo_event_rate (window_start);

-- True while the caller is within p_limit hits per p_window_seconds for this bucket.
create or replace function public.gogo_event_rate_hit(p_bucket text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_bucket is null or char_length(p_bucket) < 8 or p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then return false; end if;
  insert into public.gogo_event_rate as r (bucket, window_start, hits) values (left(p_bucket, 100), clock_timestamp(), 1)
  on conflict (bucket) do update set
    hits = case when r.window_start < clock_timestamp() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < clock_timestamp() - make_interval(secs => p_window_seconds) then clock_timestamp() else r.window_start end
  returning hits into n;
  -- Opportunistic cleanup so the table stays small.
  if random() < 0.02 then
    delete from public.gogo_event_rate where bucket in (select bucket from public.gogo_event_rate where window_start < clock_timestamp() - interval '1 day' limit 200 for update skip locked);
  end if;
  return n <= p_limit;
end $$;

create or replace function public.gogo_event_rsvp(
  p_token_hash text, p_status text, p_plus_ones integer default 0, p_dietary text default null, p_comment text default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare g public.gogo_event_guests; e public.gogo_events; taken integer; plus integer; d text; c text;
begin
  if p_status is null or p_status not in ('going','maybe','declined') then return jsonb_build_object('ok', false, 'error', 'invalid_status'); end if;
  select * into g from public.gogo_event_guests where token_hash = p_token_hash;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- Lock the event first, always, so concurrent answers queue up in one order.
  select * into e from public.gogo_events where id = g.event_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into g from public.gogo_event_guests where id = g.id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if g.token_revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  if e.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if e.status <> 'published' then return jsonb_build_object('ok', false, 'error', 'not_open'); end if;
  if clock_timestamp() >= coalesce(e.rsvp_closes_at, e.starts_at) then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  plus := case when p_status = 'going' then least(greatest(coalesce(p_plus_ones, 0), 0), e.max_plus_ones) else 0 end;
  d := nullif(left(btrim(coalesce(p_dietary, '')), 120), '');
  c := nullif(left(btrim(coalesce(p_comment, '')), 300), '');
  -- The same answer again (a retry on a poor connection) changes nothing and is not counted.
  if g.rsvp_status = p_status and g.plus_ones = plus and g.dietary is not distinct from d and g.comment is not distinct from c then
    return jsonb_build_object('ok', true, 'status', p_status, 'plus_ones', plus, 'changed', false);
  end if;
  -- Changes are bounded per link. Past the bound one thing is still allowed: moving to declined, which frees a
  -- place. It keeps the stored note and food preference, so it cannot be used to keep writing.
  if g.rsvp_changes >= 20 then
    if p_status <> 'declined' or g.rsvp_status = 'declined' then return jsonb_build_object('ok', false, 'error', 'too_many_changes'); end if;
    d := g.dietary; c := g.comment;
  end if;
  if p_status = 'going' and e.capacity is not null then
    select coalesce(count(*) + sum(o.plus_ones), 0) into taken from public.gogo_event_guests o
      where o.event_id = e.id and o.id <> g.id and o.rsvp_status = 'going' and o.token_revoked_at is null;
    if taken + 1 + plus > e.capacity then
      return jsonb_build_object('ok', false, 'error', 'full', 'places_left', greatest(e.capacity - taken, 0));
    end if;
  end if;
  update public.gogo_event_guests set rsvp_status = p_status, plus_ones = plus, dietary = d, comment = c,
    rsvp_at = clock_timestamp(), rsvp_changes = rsvp_changes + 1 where id = g.id;
  insert into public.gogo_event_rsvp_history (event_id, guest_id, rsvp_status, plus_ones) values (e.id, g.id, p_status, plus);
  return jsonb_build_object('ok', true, 'status', p_status, 'plus_ones', plus, 'changed', true);
end $$;

-- Share link: add the guest and record their answer together, or do neither.
create or replace function public.gogo_event_join_rsvp(
  p_share_hash text, p_name text, p_guest_token_hash text, p_status text, p_plus_ones integer default 0, p_dietary text default null, p_comment text default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare e public.gogo_events; n integer; clean text; limit_n integer; r jsonb; existing uuid; detail text;
begin
  if p_guest_token_hash is null or p_guest_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  if p_status is null or p_status not in ('going','maybe','declined') then return jsonb_build_object('ok', false, 'error', 'invalid_status'); end if;
  select * into e from public.gogo_events where share_token_hash = p_share_hash for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- A retry of the same first answer: the guest already exists under this personal token.
  select id into existing from public.gogo_event_guests where token_hash = p_guest_token_hash and event_id = e.id;
  if found then return public.gogo_event_rsvp(p_guest_token_hash, p_status, p_plus_ones, p_dietary, p_comment); end if;
  clean := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  if char_length(clean) < 1 then return jsonb_build_object('ok', false, 'error', 'name_required'); end if;
  if e.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if e.status <> 'published' then return jsonb_build_object('ok', false, 'error', 'not_open'); end if;
  if clock_timestamp() >= coalesce(e.rsvp_closes_at, e.starts_at) then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  -- Abuse bound: only live guests who came through the share link count, so the organizer's own list and revoked
  -- guests can never switch the link off.
  limit_n := least(greatest(coalesce(e.capacity, 100) * 3, 50), 1000);
  select count(*) into n from public.gogo_event_guests where event_id = e.id and source = 'share_link' and token_revoked_at is null;
  if n >= limit_n then return jsonb_build_object('ok', false, 'error', 'guest_limit'); end if;
  -- With no capacity set, people arriving through the share link are still bounded, so a leaked link cannot run
  -- the headcount up without limit.
  if e.capacity is null and p_status = 'going' then
    select coalesce(count(*) + sum(o.plus_ones), 0) into n from public.gogo_event_guests o
      where o.event_id = e.id and o.source = 'share_link' and o.rsvp_status = 'going' and o.token_revoked_at is null;
    if n + 1 + least(greatest(coalesce(p_plus_ones, 0), 0), e.max_plus_ones) > 300 then return jsonb_build_object('ok', false, 'error', 'guest_limit'); end if;
  end if;
  begin
    insert into public.gogo_event_guests (event_id, name, source, token_hash) values (e.id, clean, 'share_link', p_guest_token_hash);
    r := public.gogo_event_rsvp(p_guest_token_hash, p_status, p_plus_ones, p_dietary, p_comment);
    if not coalesce((r->>'ok')::boolean, false) then raise exception 'gogo_rsvp_refused' using detail = r::text; end if;
    return r;
  exception when raise_exception then
    get stacked diagnostics detail = pg_exception_detail;
    if sqlerrm = 'gogo_rsvp_refused' then return detail::jsonb; end if;
    raise;
  end;
end $$;

drop function if exists public.gogo_event_join(text, text, text);
revoke all on function public.gogo_event_join_rsvp(text, text, text, text, integer, text, text), public.gogo_event_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.gogo_event_join_rsvp(text, text, text, text, integer, text, text), public.gogo_event_rate_hit(text, integer, integer) to service_role;
commit;
