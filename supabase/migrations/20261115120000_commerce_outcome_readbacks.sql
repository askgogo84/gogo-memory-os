-- Append-only merchant order evidence. Only trusted provider backend adapters
-- can INSERT; customer/anonymous roles cannot read, create or mutate.
-- No provider tokens, customer credentials, PAN, CVV or UPI secrets.
begin;
set local lock_timeout = '5s';
create table if not exists public.commerce_purchase_outcome_readbacks (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.commerce_purchase_intents(id) on delete restrict,
  owner_telegram_id text not null,
  provider text not null check(provider in ('swiggy','zepto')),
  cart_id text not null,
  evidence_ref text not null check(length(evidence_ref) between 1 and 160),
  evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
  merchant_order_id text,
  merchant_payment_id text,
  merchant_refund_id text,
  order_status text not null check(order_status in ('not_reported','pending','placed','delivered','cancelled')),
  payment_status text not null check(payment_status in ('not_reported','pending','failed','captured','partially_refunded','refunded')),
  gross_paid_paise bigint check(gross_paid_paise is null or (gross_paid_paise > 0 and gross_paid_paise <= 5000000)),
  refunded_paise bigint not null default 0 check(refunded_paise >= 0 and refunded_paise <= 5000000),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(provider,evidence_ref),
  constraint commerce_outcome_amounts check(
    (payment_status in ('not_reported','pending','failed') and gross_paid_paise is null and refunded_paise=0 and merchant_refund_id is null)
    or (payment_status='captured' and gross_paid_paise>0 and refunded_paise=0 and merchant_payment_id is not null)
    or (payment_status='partially_refunded' and gross_paid_paise>refunded_paise and refunded_paise>0 and merchant_payment_id is not null and merchant_refund_id is not null)
    or (payment_status='refunded' and gross_paid_paise=refunded_paise and refunded_paise>0 and merchant_payment_id is not null and merchant_refund_id is not null)
  )
);
create index if not exists commerce_outcome_purchase_observed
 on public.commerce_purchase_outcome_readbacks(purchase_id,owner_telegram_id,observed_at desc,created_at desc);
alter table public.commerce_purchase_outcome_readbacks enable row level security;
revoke all on public.commerce_purchase_outcome_readbacks from public, anon, authenticated;
grant select, insert on public.commerce_purchase_outcome_readbacks to service_role;
create or replace function public.reject_commerce_outcome_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'commerce_purchase_outcome_readbacks is append-only'; end
$$;
drop trigger if exists commerce_purchase_outcome_immutable on public.commerce_purchase_outcome_readbacks;
create trigger commerce_purchase_outcome_immutable before update or delete
 on public.commerce_purchase_outcome_readbacks for each row
 execute function public.reject_commerce_outcome_mutation();
comment on table public.commerce_purchase_outcome_readbacks is
 'Append-only merchant order/payment readbacks from authenticated provider backend, not a user payment claim.';
commit;
