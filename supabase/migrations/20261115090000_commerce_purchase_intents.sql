-- Additive, review-only AskGogo purchase-handoff ledger. Never stores PAN, CVV, OTP,
-- UPI PIN, payment tokens, delivery addresses or provider OAuth credentials.
-- Applying this migration does NOT authorize any order, payment or provider action.
begin;
set local lock_timeout = '5s';

create table if not exists public.commerce_purchase_intents (
  id uuid primary key default gen_random_uuid(),
  owner_telegram_id text not null,
  source_run_id uuid not null references public.agent_runs(id) on delete restrict,
  provider text not null check (provider in ('swiggy','zepto')),
  cart_id text not null,
  address_id text not null,
  items_snapshot jsonb not null check (jsonb_typeof(items_snapshot) = 'array'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 5000000),
  currency text not null default 'INR' check (currency = 'INR'),
  checkout_url text,
  phone_cart_verified boolean not null default false,
  status text not null default 'awaiting_provider_handoff'
    check (status in ('awaiting_provider_handoff','pending_approval','approved','handoff_opened','cancelled','expired','verification_pending')),
  expires_at timestamptz not null,
  approved_at timestamptz,
  handoff_opened_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_telegram_id, source_run_id),
  constraint commerce_purchase_handoff_ready_check check (
    status in ('awaiting_provider_handoff','cancelled','expired') or
      (checkout_url is not null and phone_cart_verified = true)
  )
);

create index if not exists commerce_purchase_owner_created
  on public.commerce_purchase_intents(owner_telegram_id, created_at desc);

alter table public.commerce_purchase_intents enable row level security;
revoke all on public.commerce_purchase_intents from anon, authenticated;
grant select, insert, update, delete on public.commerce_purchase_intents to service_role;

comment on table public.commerce_purchase_intents is
 'Service-role-only checkout handoff; not a wallet or payment execution ledger. No paid status without provider-verified evidence.';
comment on column public.commerce_purchase_intents.snapshot_sha256 is
 'SHA-256 of the immutable exact cart/address/amount/checkout snapshot approved by the owner.';
comment on column public.commerce_purchase_intents.phone_cart_verified is
 'True only after authorized provider and on-device same-account cart check, never user-supplied API input.';

commit;
