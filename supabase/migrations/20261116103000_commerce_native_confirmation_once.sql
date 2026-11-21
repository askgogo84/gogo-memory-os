-- Never activate without Swiggy approval and an independently verified
-- payment transaction; this is a one-shot confirmation claim, not a retry queue.
begin;
set local lock_timeout='5s';
alter table public.commerce_native_checkout_attempts
  add column if not exists confirmation_claimed_at timestamptz,
  add column if not exists confirmation_finished_at timestamptz,
  add column if not exists confirmation_result_status text;
comment on column public.commerce_native_checkout_attempts.confirmation_claimed_at is
 'Durable one-shot claim before outbound merchant confirm_order. Never retry if outcome is unknown.';
commit;
