-- AskGogo Events (Addendum 4, 10 Nov): events, guests, RSVPs, notifications and an audit trail.
--
-- STATUS: PREPARED, NOT APPLIED. Until this runs, lib/events/store.ts reports events_not_enabled and nothing else
-- in the product changes. Apply only with the owner's authorization. Rollback: 20261110150000_gogo_events.rollback.sql
--
-- Model
--  * AskGogo's own tables are the source of truth. Nothing here reads or writes native WhatsApp Events.
--  * Owner ids are exact decimal strings (text), like the rest of the product; never numbers.
--  * A guest reaches an invitation with a random 256-bit token. Only its SHA-256 hash is stored, so a database
--    reader cannot open anyone's invitation. Tokens can be revoked per guest; the event's share link can be rotated.
--  * Two ways in: a personal link for a guest the organizer named, or the event's share link, where a guest adds
--    their own name and receives a personal link for later edits.
--  * RSVPs go through one function that locks the event row, so two answers at once cannot oversell capacity or
--    lose a change. Every answer is appended to the history.
--  * Headcount counts people: going invitations plus their plus-ones.
--  * Row level security is on with no policies: anon and authenticated are denied; only the service role (the app)
--    reaches these tables, and the app checks the organizer on every read and write (lib/events/store.ts).
--  * The audit trail is append-only.
--  * workspace_id is for later organization-scoped events; personal events leave it null and are never visible to a
--    workspace.
begin;
set local lock_timeout = '5s';

create table if not exists public.gogo_events (
  id uuid primary key default gen_random_uuid(),
  owner_telegram_id text not null check (owner_telegram_id ~ '^-?[0-9]{1,20}$'),
  workspace_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  kind text not null default 'other' check (kind in ('birthday','anniversary','dinner','outing','meeting','other')),
  status text not null default 'draft' check (status in ('draft','published','cancelled','completed')),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  venue_name text check (venue_name is null or char_length(venue_name) <= 160),
  venue_address text check (venue_address is null or char_length(venue_address) <= 300),
  address_visibility text not null default 'going' check (address_visibility in ('everyone','going')),
  online_url text check (online_url is null or (char_length(online_url) <= 500 and online_url ~ '^https://')),
  host_name text check (host_name is null or char_length(host_name) <= 80),
  description text check (description is null or char_length(description) <= 1000),
  dress_code text check (dress_code is null or char_length(dress_code) <= 120),
  capacity integer check (capacity is null or capacity between 1 and 5000),
  max_plus_ones smallint not null default 0 check (max_plus_ones between 0 and 10),
  rsvp_closes_at timestamptz,
  template smallint not null default 1 check (template between 1 and 12),
  share_token_hash text unique check (share_token_hash is null or share_token_hash ~ '^[0-9a-f]{64}$'),
  calendar_event_id text,
  calendar_status text not null default 'none' check (calendar_status in ('none','created','updated','cancelled','failed','unknown')),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  -- An event people can answer must say when it is.
  check (status = 'draft' or starts_at is not null)
);
create index if not exists gogo_events_owner_idx on public.gogo_events (owner_telegram_id, starts_at desc);

create table if not exists public.gogo_event_guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.gogo_events(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  phone text check (phone is null or phone ~ '^[0-9]{8,15}$'),
  source text not null default 'organizer' check (source in ('organizer','share_link')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_revoked_at timestamptz,
  invite_status text not null default 'not_sent' check (invite_status in ('not_sent','approved','sent','delivered','failed','unknown')),
  rsvp_status text not null default 'none' check (rsvp_status in ('none','going','maybe','declined')),
  plus_ones smallint not null default 0 check (plus_ones between 0 and 10),
  dietary text check (dietary is null or char_length(dietary) <= 120),
  comment text check (comment is null or char_length(comment) <= 300),
  rsvp_at timestamptz,
  rsvp_changes integer not null default 0,
  opted_out boolean not null default false,
  reminders_sent smallint not null default 0,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  -- Plus-ones only count for someone who is going.
  check (rsvp_status = 'going' or plus_ones = 0)
);
create unique index if not exists gogo_event_guests_phone_once on public.gogo_event_guests (event_id, phone) where phone is not null;
create index if not exists gogo_event_guests_event_idx on public.gogo_event_guests (event_id, rsvp_status);

create table if not exists public.gogo_event_rsvp_history (
  id bigserial primary key,
  event_id uuid not null references public.gogo_events(id) on delete cascade,
  guest_id uuid not null references public.gogo_event_guests(id) on delete cascade,
  rsvp_status text not null check (rsvp_status in ('going','maybe','declined')),
  plus_ones smallint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists gogo_event_rsvp_history_event_idx on public.gogo_event_rsvp_history (event_id, created_at desc);

-- One row per message Gogo plans to send or has sent about an event. dedupe_key makes a repeated scheduler run or a
-- retried request land on the same row instead of sending twice.
create table if not exists public.gogo_event_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.gogo_events(id) on delete cascade,
  guest_id uuid references public.gogo_event_guests(id) on delete cascade,
  kind text not null check (kind in ('invite','reminder','update','cancel')),
  channel text not null check (channel in ('whatsapp','organizer_forward')),
  status text not null default 'planned' check (status in ('planned','approved','sent','delivered','failed','unknown','skipped')),
  skip_reason text check (skip_reason is null or char_length(skip_reason) <= 80),
  approval_id uuid,
  provider_sid text,
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 200),
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gogo_event_notifications_event_idx on public.gogo_event_notifications (event_id, kind, status);
create index if not exists gogo_event_notifications_due_idx on public.gogo_event_notifications (scheduled_for) where status = 'approved';

create table if not exists public.gogo_event_audit (
  id bigserial primary key,
  event_id uuid not null references public.gogo_events(id) on delete cascade,
  actor text not null check (char_length(actor) <= 40),
  action text not null check (char_length(action) <= 60),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists gogo_event_audit_event_idx on public.gogo_event_audit (event_id, created_at desc);

create or replace function public.gogo_event_audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'gogo_event_audit is append-only';
end $$;
drop trigger if exists gogo_event_audit_no_update on public.gogo_event_audit;
create trigger gogo_event_audit_no_update before update on public.gogo_event_audit
  for each row execute function public.gogo_event_audit_append_only();

-- People, not invitations: going guests plus their plus-ones.
create or replace function public.gogo_event_headcount(p_event_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'invited', count(*),
    'going', count(*) filter (where g.rsvp_status = 'going'),
    'plus_ones', coalesce(sum(g.plus_ones) filter (where g.rsvp_status = 'going'), 0),
    'attendees', count(*) filter (where g.rsvp_status = 'going') + coalesce(sum(g.plus_ones) filter (where g.rsvp_status = 'going'), 0),
    'maybe', count(*) filter (where g.rsvp_status = 'maybe'),
    'declined', count(*) filter (where g.rsvp_status = 'declined'),
    'no_reply', count(*) filter (where g.rsvp_status = 'none'))
  from public.gogo_event_guests g
  where g.event_id = p_event_id and g.token_revoked_at is null
$$;

-- One guest's answer. Returns {ok:true,...} or {ok:false,error:<code>}; never raises for an ordinary refusal.
create or replace function public.gogo_event_rsvp(
  p_token_hash text, p_status text, p_plus_ones integer default 0, p_dietary text default null, p_comment text default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare g public.gogo_event_guests; e public.gogo_events; taken integer; wanted integer; plus integer;
begin
  if p_status is null or p_status not in ('going','maybe','declined') then return jsonb_build_object('ok', false, 'error', 'invalid_status'); end if;
  select * into g from public.gogo_event_guests where token_hash = p_token_hash;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- Lock the event first, always, so concurrent answers queue up in one order.
  select * into e from public.gogo_events where id = g.event_id for update;
  select * into g from public.gogo_event_guests where id = g.id for update;
  if g.token_revoked_at is not null then return jsonb_build_object('ok', false, 'error', 'revoked'); end if;
  if e.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if e.status <> 'published' then return jsonb_build_object('ok', false, 'error', 'not_open'); end if;
  if clock_timestamp() >= coalesce(e.rsvp_closes_at, e.starts_at) then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if g.rsvp_changes >= 20 then return jsonb_build_object('ok', false, 'error', 'too_many_changes'); end if;
  plus := case when p_status = 'going' then least(greatest(coalesce(p_plus_ones, 0), 0), e.max_plus_ones) else 0 end;
  if p_status = 'going' and e.capacity is not null then
    select coalesce(count(*) + sum(o.plus_ones), 0) into taken from public.gogo_event_guests o
      where o.event_id = e.id and o.id <> g.id and o.rsvp_status = 'going' and o.token_revoked_at is null;
    wanted := 1 + plus;
    if taken + wanted > e.capacity then
      return jsonb_build_object('ok', false, 'error', 'full', 'places_left', greatest(e.capacity - taken, 0));
    end if;
  end if;
  update public.gogo_event_guests set rsvp_status = p_status, plus_ones = plus,
    dietary = nullif(left(btrim(coalesce(p_dietary, '')), 120), ''), comment = nullif(left(btrim(coalesce(p_comment, '')), 300), ''),
    rsvp_at = clock_timestamp(), rsvp_changes = rsvp_changes + 1 where id = g.id;
  insert into public.gogo_event_rsvp_history (event_id, guest_id, rsvp_status, plus_ones) values (e.id, g.id, p_status, plus);
  return jsonb_build_object('ok', true, 'status', p_status, 'plus_ones', plus, 'changed', g.rsvp_status is distinct from p_status or g.plus_ones is distinct from plus);
end $$;

-- A guest who opened the event's share link adds themselves. The caller supplies the hash of a new personal token.
create or replace function public.gogo_event_join(p_share_hash text, p_name text, p_guest_token_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare e public.gogo_events; n integer; clean text; limit_n integer;
begin
  clean := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  if char_length(clean) < 1 then return jsonb_build_object('ok', false, 'error', 'name_required'); end if;
  if p_guest_token_hash is null or p_guest_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  select * into e from public.gogo_events where share_token_hash = p_share_hash for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if e.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if e.status <> 'published' then return jsonb_build_object('ok', false, 'error', 'not_open'); end if;
  if clock_timestamp() >= coalesce(e.rsvp_closes_at, e.starts_at) then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  -- Abuse bound: a share link cannot create guests without limit.
  limit_n := least(greatest(coalesce(e.capacity, 100) * 3, 50), 1000);
  select count(*) into n from public.gogo_event_guests where event_id = e.id;
  if n >= limit_n then return jsonb_build_object('ok', false, 'error', 'guest_limit'); end if;
  insert into public.gogo_event_guests (event_id, name, source, token_hash) values (e.id, clean, 'share_link', p_guest_token_hash);
  return jsonb_build_object('ok', true);
end $$;

alter table public.gogo_events enable row level security;
alter table public.gogo_event_guests enable row level security;
alter table public.gogo_event_rsvp_history enable row level security;
alter table public.gogo_event_notifications enable row level security;
alter table public.gogo_event_audit enable row level security;
revoke all on public.gogo_events, public.gogo_event_guests, public.gogo_event_rsvp_history, public.gogo_event_notifications, public.gogo_event_audit from anon, authenticated;
grant select, insert, update, delete on public.gogo_events, public.gogo_event_guests, public.gogo_event_rsvp_history, public.gogo_event_notifications to service_role;
grant select, insert, delete on public.gogo_event_audit to service_role;
grant usage, select on sequence public.gogo_event_rsvp_history_id_seq, public.gogo_event_audit_id_seq to service_role;
revoke all on function public.gogo_event_headcount(uuid), public.gogo_event_rsvp(text, text, integer, text, text), public.gogo_event_join(text, text, text), public.gogo_event_audit_append_only() from public, anon, authenticated;
grant execute on function public.gogo_event_headcount(uuid), public.gogo_event_rsvp(text, text, integer, text, text), public.gogo_event_join(text, text, text) to service_role;
commit;
