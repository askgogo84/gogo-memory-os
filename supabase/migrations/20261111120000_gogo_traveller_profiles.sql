-- AskGogo: a person's own flight-booking details, kept so they are not asked every time (owner, 11 Nov 2026:
-- "it should remember everything about me, should not ask every time").
--
-- One row per owner (telegram_id, exact). Only the server (service role) reads or writes it; no browser or anon
-- access. Saved only for owners listed in GOGO_TRAVELLER_PROFILE and only from details the person typed for a
-- one-traveller booking. "forget my travel details" deletes the row. Passwords, card or UPI details, passport
-- numbers and dates of birth are never stored here.
create table if not exists public.gogo_traveller_profiles (
  telegram_id bigint primary key,
  user_id uuid,
  title text not null check (title in ('Mr','Ms','Mrs','Miss','Master')),
  full_name text not null check (char_length(full_name) between 3 and 80),
  email text not null check (char_length(email) between 6 and 254 and email like '%_@_%._%'),
  mobile text not null check (mobile ~ '^[6-9][0-9]{9}$'),
  seat text not null check (seat in ('free','window','aisle','paid')),
  updated_at timestamptz not null default now()
);
alter table public.gogo_traveller_profiles enable row level security;
revoke all on table public.gogo_traveller_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.gogo_traveller_profiles to service_role;
