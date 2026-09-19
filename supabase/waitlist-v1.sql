-- public.waitlist — askgogo.in waitlist (docs/waitlist/05-BACKEND-SCHEMA.md §1)
-- Already applied by hand in Supabase qenhjcooyecmatwducpu on 19 Sep 2026. Idempotent; safe to re-run.
create table if not exists public.waitlist (
  id               uuid primary key default gen_random_uuid(),
  phone_e164       text not null unique,
  email            text not null,
  country          text not null check (country in ('IN','AE')),
  whatsapp_opt_in  boolean not null default false,
  consent_version  text not null,
  source           text,
  created_at       timestamptz not null default now(),
  invited_at       timestamptz
);

alter table public.waitlist enable row level security;
-- NO policies. Service role bypasses RLS; anon/authenticated get nothing.
