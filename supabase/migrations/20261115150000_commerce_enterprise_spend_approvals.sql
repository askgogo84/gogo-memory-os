-- Enterprise purchase approvals are an internal tenant-IAM-only ledger.
-- Votes are immutable and scoped to a particular tenant and exact purchase.
-- Neither approval nor a budget green light can spend company money.
begin;
set local lock_timeout='5s';
create table if not exists public.commerce_enterprise_spend_requests (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.commerce_purchase_intents(id) on delete restrict,
  tenant_id text not null,employee_id text not null,department_id text not null,
  policy_version text not null,snapshot_sha256 text not null check(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  amount_paise bigint not null check(amount_paise>0 and amount_paise<=5000000),
  required_approvers text[] not null check(cardinality(required_approvers) between 1 and 5),
  approval_sha256 text not null check(approval_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(id,tenant_id)
);
create index if not exists commerce_enterprise_spend_tenant_recent
 on public.commerce_enterprise_spend_requests(tenant_id,created_at desc);
create table if not exists public.commerce_enterprise_spend_votes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,tenant_id text not null,
  actor_id text not null,decision text not null check(decision in ('approve','reject')),
  created_at timestamptz not null default now(),
  foreign key(request_id,tenant_id) references public.commerce_enterprise_spend_requests(id,tenant_id) on delete restrict,
  unique(request_id,actor_id)
);
create index if not exists commerce_enterprise_votes_tenant_request
 on public.commerce_enterprise_spend_votes(tenant_id,request_id);
alter table public.commerce_enterprise_spend_requests enable row level security;
alter table public.commerce_enterprise_spend_votes enable row level security;
revoke all on public.commerce_enterprise_spend_requests from public,anon,authenticated;
revoke all on public.commerce_enterprise_spend_votes from public,anon,authenticated;
grant select,insert on public.commerce_enterprise_spend_requests to service_role;
grant select,insert on public.commerce_enterprise_spend_votes to service_role;
create or replace function public.reject_commerce_enterprise_approval_mutation() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'enterprise commerce approval history is immutable'; end
$$;
drop trigger if exists commerce_spend_requests_immutable on public.commerce_enterprise_spend_requests;
create trigger commerce_spend_requests_immutable before update or delete
 on public.commerce_enterprise_spend_requests for each row execute function public.reject_commerce_enterprise_approval_mutation();
drop trigger if exists commerce_spend_votes_immutable on public.commerce_enterprise_spend_votes;
create trigger commerce_spend_votes_immutable before update or delete
 on public.commerce_enterprise_spend_votes for each row execute function public.reject_commerce_enterprise_approval_mutation();
comment on table public.commerce_enterprise_spend_votes is 'Tenant verified, immutable manager decisions; cannot itself execute purchase.';
commit;
