-- Owner-approved 9 Nov 2026 (run by the owner in the Supabase SQL editor; rollback: 20261102092000_autonomy_email_atomic_claim.rollback.sql).
-- Atomic per-owner proactive Gmail attention notification reservation.
-- A reservation is deliberately permanent even if a worker crashes before the provider
-- call or receives an unknown outcome: reconciliation is manual, never blind-retry.
begin;
set local lock_timeout='5s';

create table public.autonomy_email_daily_budget (
  owner_id bigint not null,
  local_day date not null,
  reserved_items integer not null default 0 check (reserved_items between 0 and 2),
  primary key (owner_id, local_day)
);

create table public.autonomy_email_claims (
  owner_id bigint not null,
  thread_key text not null check (char_length(thread_key) between 7 and 200),
  local_day date not null,
  claim_token uuid not null,
  state text not null default 'outcome_unknown'
    check (state in ('outcome_unknown', 'provider_accepted')),
  provider_id text,
  reserved_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  primary key (owner_id, thread_key)
);
create index autonomy_email_claim_token_idx on public.autonomy_email_claims(owner_id, claim_token);

alter table public.autonomy_email_daily_budget enable row level security;
alter table public.autonomy_email_claims enable row level security;
revoke all on public.autonomy_email_daily_budget, public.autonomy_email_claims from public, anon, authenticated;
grant select, insert, update on public.autonomy_email_daily_budget, public.autonomy_email_claims to service_role;

create function public.claim_autonomy_email_card(
  p_owner bigint, p_day date, p_threads text[], p_token uuid, p_prior_count integer
) returns boolean language plpgsql security invoker set search_path='' as $$
declare
  n integer;
  distinct_n integer;
  wrote integer;
begin
  n := coalesce(cardinality(p_threads), 0);
  if p_owner is null or p_owner = 0 or p_day is null or p_token is null
      or p_prior_count is null or p_prior_count < 0 or p_prior_count > 2
      or n < 1 or n > 2 then
    return false;
  end if;
  if exists (select 1 from unnest(p_threads) k where
      k is null or char_length(k) > 200 or k !~ '^email:[A-Za-z0-9:_-]{1,190}$') then
    return false;
  end if;
  select count(distinct k) into distinct_n from unnest(p_threads) k;
  if distinct_n <> n then return false; end if;

  -- The row UPDATE serializes all same-owner/local-day workers, including
  -- different thread lists; the 2-item cap is checked and reserved atomically.
  insert into public.autonomy_email_daily_budget(owner_id, local_day, reserved_items)
    values (p_owner, p_day, 0) on conflict do nothing;
  update public.autonomy_email_daily_budget
    set reserved_items = greatest(reserved_items, p_prior_count) + n
    where owner_id = p_owner and local_day = p_day
      and greatest(reserved_items, p_prior_count) + n <= 2;
  if not found then return false; end if;

  -- One thread, one owner, ever. On conflict, roll back the daily budget
  -- reservation as well: a partial reservation must never be committed.
  insert into public.autonomy_email_claims(owner_id, thread_key, local_day, claim_token)
    select p_owner, k, p_day, p_token from unnest(p_threads) k
    on conflict do nothing;
  get diagnostics wrote = row_count;
  if wrote <> n then
    raise exception 'autonomy_email_duplicate_claim';
  end if;
  return true;
end $$;

create function public.finish_autonomy_email_card(
  p_owner bigint, p_token uuid, p_provider_id text
) returns boolean language plpgsql security invoker set search_path='' as $$
declare wrote integer;
begin
  if p_owner is null or p_owner = 0 or p_token is null
      or p_provider_id is null or char_length(trim(p_provider_id)) < 1
      or char_length(p_provider_id) > 200 then return false; end if;
  update public.autonomy_email_claims
    set state = 'provider_accepted', provider_id = p_provider_id,
        accepted_at = clock_timestamp()
    where owner_id = p_owner and claim_token = p_token and state = 'outcome_unknown';
  get diagnostics wrote = row_count;
  return wrote > 0;
end $$;

revoke all on function public.claim_autonomy_email_card(bigint,date,text[],uuid,integer),
  public.finish_autonomy_email_card(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_autonomy_email_card(bigint,date,text[],uuid,integer),
  public.finish_autonomy_email_card(bigint,uuid,text) to service_role;
commit;
