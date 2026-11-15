-- Native checkout requires a distinct, explicitly enabled, user-confirmed executor.
-- No production activation by applying schema; COMMERCE_NATIVE_CHECKOUT_ENABLED defaults OFF.
begin;
set local lock_timeout='5s';
create table if not exists public.commerce_native_checkout_reviews (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.commerce_purchase_intents(id) on delete restrict,
  owner_telegram_id text not null,
  review_sha256 text not null check(review_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_sha256 text not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  address_sha256 text not null check(address_sha256 ~ '^[0-9a-f]{64}$'),
  amount_paise bigint not null check(amount_paise>0 and amount_paise<=5000000),
  choices_snapshot jsonb not null check(jsonb_typeof(choices_snapshot)='array'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists commerce_native_reviews_owner_purchase
 on public.commerce_native_checkout_reviews(owner_telegram_id,purchase_id,created_at desc);
create table if not exists public.commerce_native_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.commerce_purchase_intents(id) on delete restrict,
  review_id uuid not null references public.commerce_native_checkout_reviews(id) on delete restrict,
  owner_telegram_id text not null,
  snapshot_sha256 text not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  review_sha256 text not null check(review_sha256 ~ '^[0-9a-f]{64}$'),
  payment_mode text not null check(payment_mode in ('cash_on_delivery','swiggy_money','upi_intent','upi_qr')),
  payment_method_id text not null,
  status text not null default 'outcome_unknown'
    check(status in ('outcome_unknown','response_received')),
  provider_order_refs jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commerce_native_attempts_owner
 on public.commerce_native_checkout_attempts(owner_telegram_id,created_at desc);
alter table public.commerce_native_checkout_reviews enable row level security;
alter table public.commerce_native_checkout_attempts enable row level security;
revoke all on public.commerce_native_checkout_reviews from public,anon,authenticated;
revoke all on public.commerce_native_checkout_attempts from public,anon,authenticated;
grant select,insert on public.commerce_native_checkout_reviews to service_role;
grant select,insert,update on public.commerce_native_checkout_attempts to service_role;
create or replace function public.reject_native_checkout_review_mutation() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'native checkout review is immutable'; end
$$;
drop trigger if exists commerce_native_reviews_immutable on public.commerce_native_checkout_reviews;
create trigger commerce_native_reviews_immutable before update or delete
 on public.commerce_native_checkout_reviews for each row execute function public.reject_native_checkout_review_mutation();
comment on table public.commerce_native_checkout_attempts is
 'Unique one-attempt-per-purchase claim; outcome_unknown on network timeout; never blindly retry checkout.';
commit;
