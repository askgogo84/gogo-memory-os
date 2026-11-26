-- Append-only merchant payment observations; deliberately no UPI launch or
-- confirm_order write authority. Disabled by default, never apply automatically.
begin;
set local lock_timeout='5s';
alter table public.commerce_native_checkout_attempts
  add column if not exists payment_paas_id text,
  add column if not exists payment_order_id text,
  add column if not exists payment_poll_interval_ms integer,
  add column if not exists payment_last_check_at timestamptz;
alter table public.commerce_native_checkout_attempts
  add constraint native_checkout_payment_poll_bound check(
    payment_poll_interval_ms is null or payment_poll_interval_ms between 5000 and 120000);
create table if not exists public.commerce_native_payment_readbacks (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.commerce_native_checkout_attempts(id) on delete restrict,
  purchase_id uuid not null references public.commerce_purchase_intents(id) on delete restrict,
  owner_telegram_id text not null,
  paas_id text not null,
  order_id text not null,
  evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null,
  terminal boolean not null,
  payment_verified boolean not null,
  order_verified boolean not null,
  payment_failed boolean not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(attempt_id,evidence_sha256),
  check(not(payment_verified and payment_failed)),
  check(not order_verified or payment_verified)
);
create index if not exists native_payment_readbacks_owner
  on public.commerce_native_payment_readbacks(owner_telegram_id,purchase_id,observed_at desc);
alter table public.commerce_native_payment_readbacks enable row level security;
revoke all on public.commerce_native_payment_readbacks from public,anon,authenticated;
grant select,insert on public.commerce_native_payment_readbacks to service_role;
create or replace function public.reject_native_payment_readback_mutation() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'native merchant payment evidence is append only'; end
$$;
drop trigger if exists native_payment_readbacks_immutable on public.commerce_native_payment_readbacks;
create trigger native_payment_readbacks_immutable before update or delete
 on public.commerce_native_payment_readbacks for each row
 execute function public.reject_native_payment_readback_mutation();
commit;
