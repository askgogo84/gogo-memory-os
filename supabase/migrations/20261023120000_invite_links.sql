-- Invite links (23 Oct 2026, Instinct-style invites, mock approved by Gogo).
-- Every user gets ONE private invite code (e.g. goverdhan-7k2m9x) that up to 10 new numbers can join with.
-- A friend opens app.askgogo.in/i/<code>, taps "Open WhatsApp" and sends the prefilled join message; the access gate
-- redeems the code, which lets that new number skip the waitlist. The inviter is told who joined.
--
-- redeem_invite() does the check-and-claim in one transaction with a row lock on the code, so two friends joining
-- at the same moment can never take invite 11. A number can join with only one invite (unique phone).
-- Grants: service_role only; anon/authenticated revoked (the app reads these server-side).

create table if not exists public.invite_codes (
  code text primary key check (code ~ '^[a-z0-9]{1,12}-[a-z0-9]{6}$'),
  inviter_telegram_id bigint not null unique,
  max_uses integer not null default 10 check (max_uses between 0 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.invite_codes(code) on delete cascade,
  inviter_telegram_id bigint not null,
  invitee_phone_e164 text not null unique check (invitee_phone_e164 ~ '^\+[0-9]{8,15}$'),
  invitee_telegram_id bigint,
  invitee_name text check (invitee_name is null or length(invitee_name) <= 80),
  created_at timestamptz not null default now()
);
create index if not exists invite_redemptions_inviter_idx on public.invite_redemptions (inviter_telegram_id, created_at desc);
create index if not exists invite_redemptions_code_idx on public.invite_redemptions (code);

alter table public.invite_codes enable row level security;
alter table public.invite_redemptions enable row level security;

create or replace function public.redeem_invite(p_code text, p_phone text, p_name text)
returns table (ok boolean, reason text, redemption_id uuid, inviter_telegram_id bigint, remaining integer)
language plpgsql security definer set search_path = public as $$
declare
  v_code public.invite_codes%rowtype;
  v_prior public.invite_redemptions%rowtype;
  v_used integer;
  v_id uuid;
begin
  select * into v_code from public.invite_codes c where c.code = lower(trim(p_code)) for update;
  if not found or not v_code.active then
    return query select false, 'invalid'::text, null::uuid, null::bigint, 0; return;
  end if;
  select count(*)::integer into v_used from public.invite_redemptions r where r.code = v_code.code;
  select * into v_prior from public.invite_redemptions r where r.invitee_phone_e164 = p_phone;
  if found then
    -- A retried message from the same number: same answer again, nothing new written.
    if v_prior.code = v_code.code then
      return query select true, 'already_joined'::text, v_prior.id, v_prior.inviter_telegram_id, greatest(v_code.max_uses - v_used, 0); return;
    end if;
    return query select false, 'used_other_invite'::text, null::uuid, null::bigint, 0; return;
  end if;
  if v_used >= v_code.max_uses then
    return query select false, 'used_up'::text, null::uuid, v_code.inviter_telegram_id, 0; return;
  end if;
  insert into public.invite_redemptions (code, inviter_telegram_id, invitee_phone_e164, invitee_name)
    values (v_code.code, v_code.inviter_telegram_id, p_phone, left(nullif(trim(p_name), ''), 80))
    returning id into v_id;
  return query select true, 'joined'::text, v_id, v_code.inviter_telegram_id, v_code.max_uses - v_used - 1;
end $$;

revoke all on table public.invite_codes, public.invite_redemptions from public, anon, authenticated;
grant select, insert, update on table public.invite_codes, public.invite_redemptions to service_role;
revoke all on function public.redeem_invite(text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_invite(text, text, text) to service_role;
