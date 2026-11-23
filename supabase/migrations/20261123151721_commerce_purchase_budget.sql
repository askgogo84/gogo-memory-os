alter table public.commerce_purchase_intents
  add column budget_paise bigint,
  add constraint commerce_purchase_budget_covers_total
    check (budget_paise is null or budget_paise between amount_paise and 5000000);

comment on column public.commerce_purchase_intents.budget_paise is
  'Optional customer-entered per-order INR spending limit in paise, included in the immutable quote fingerprint.';
