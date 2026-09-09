-- AskGogo native app linking via WhatsApp.
-- Branch-only migration. Do not apply to production until QA is approved.
-- Canonical identity is users.id. No Telegram product flow is introduced.

create extension if not exists pgcrypto;

create table if not exists mobile_link_requests (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  poll_token_hash text not null unique,
  platform text not null check (platform in ('ios','android')),
  device_id text,
  device_name text,
  status text not null default 'pending' check (status in ('pending','approved','exchanged','expired')),
  user_id uuid references users(id) on delete cascade,
  whatsapp_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  exchanged_at timestamptz
);

create index if not exists mobile_link_requests_status_expiry_idx
  on mobile_link_requests(status, expires_at);
create index if not exists mobile_link_requests_user_idx
  on mobile_link_requests(user_id, created_at desc);

create table if not exists mobile_sessions (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  platform text not null check (platform in ('ios','android')),
  device_id text,
  device_name text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists mobile_sessions_user_active_idx
  on mobile_sessions(user_id, expires_at desc)
  where revoked_at is null;

-- One atomic exchange: the server generates a random raw bearer token, passes
-- only its SHA-256 hash here, and receives success/failure. The raw token is
-- returned to the app once and is never stored in plaintext.
create or replace function mobile_exchange_link(
  p_poll_token_hash text,
  p_session_token_hash text,
  p_platform text,
  p_device_id text,
  p_device_name text,
  p_session_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link mobile_link_requests%rowtype;
  v_session_id uuid;
begin
  select * into v_link
  from mobile_link_requests
  where poll_token_hash = p_poll_token_hash
    and status = 'approved'
    and expires_at > now()
    and user_id is not null
  for update;

  if not found then return null; end if;
  if p_platform not in ('ios','android') then return null; end if;

  insert into mobile_sessions (
    session_token_hash, user_id, platform, device_id, device_name, expires_at
  ) values (
    p_session_token_hash, v_link.user_id, p_platform,
    nullif(left(coalesce(p_device_id,''), 160),''),
    nullif(left(coalesce(p_device_name,''), 160),''),
    p_session_expires_at
  ) returning id into v_session_id;

  update mobile_link_requests
  set status = 'exchanged', exchanged_at = now()
  where id = v_link.id;

  return v_session_id;
end;
$$;

revoke all on function mobile_exchange_link(text,text,text,text,text,timestamptz) from public;

alter table mobile_link_requests enable row level security;
alter table mobile_sessions enable row level security;

comment on table mobile_link_requests is 'Short-lived native app pairing requests approved from the user’s AskGogo WhatsApp identity.';
comment on table mobile_sessions is 'Revocable native app bearer sessions tied to canonical users.id.';
