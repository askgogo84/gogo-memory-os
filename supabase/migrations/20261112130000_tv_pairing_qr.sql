
alter table public.tv_pairings
  add column device_name text,
  add column qr_hash text unique,
  add column poll_hash text unique,
  add column consent_at timestamptz,
  add column denied_at timestamptz,
  add column denied_by text,
  add column next_poll_at timestamptz;

create table public.tv_pairing_review_limits (
  owner_id text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
alter table public.tv_pairing_review_limits enable row level security;
revoke all on public.tv_pairing_review_limits from public, anon, authenticated;
grant select, insert, update, delete on public.tv_pairing_review_limits to service_role;

create function public.tv_start_qr_pairing(
  p_source_hash text, p_code_hash text, p_token_hash text,
  p_qr_hash text, p_poll_hash text, p_device_name text
) returns boolean language plpgsql set search_path = '' as $$
begin
  if not public.tv_start_pairing(p_source_hash, p_code_hash, p_token_hash) then
    return false;
  end if;
  update public.tv_pairings
    set qr_hash = p_qr_hash, poll_hash = p_poll_hash, device_name = p_device_name,
        pair_expires_at = now() + interval '5 minutes'
    where code_hash = p_code_hash;
  delete from public.tv_pairing_review_limits where window_start < now() - interval '1 day';
  return true;
exception when unique_violation then
  return false;
end;
$$;

create function public.tv_review_qr_pairing(
  p_owner_id text, p_code_hash text, p_qr_hash text
) returns table(id uuid, device_name text, scope text)
language plpgsql set search_path = '' as $$
declare
  attempt_count integer;
begin
  insert into public.tv_pairing_review_limits as limits (owner_id, window_start, attempts)
    values (p_owner_id, now(), 1)
    on conflict (owner_id) do update set
      attempts = case when limits.window_start <= now() - interval '5 minutes' then 1
                      else least(limits.attempts + 1, 21) end,
      window_start = case when limits.window_start <= now() - interval '5 minutes' then now()
                          else limits.window_start end
    returning attempts into attempt_count;
  if attempt_count > 20 then return; end if;
  return query select pairing.id, pairing.device_name, pairing.scope
    from public.tv_pairings pairing
    where pairing.code_hash = p_code_hash and pairing.qr_hash is not null
      and (p_qr_hash is null or pairing.qr_hash = p_qr_hash)
      and pairing.pair_expires_at > now() and pairing.revoked_at is null
      and pairing.denied_at is null and pairing.owner_id is null;
end;
$$;

create function public.tv_decide_qr_pairing(
  p_owner_id text, p_id uuid, p_code_hash text, p_qr_hash text, p_approve boolean
) returns boolean language plpgsql set search_path = '' as $$
begin
  -- The per-owner lock serializes quota checks. The row update serializes different owners and the TV.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id, 537114291));
  if p_approve and (select count(*) from public.tv_pairings where owner_id = p_owner_id
    and revoked_at is null and (expires_at > now() or (approved_at is null and pair_expires_at > now()))) >= 8 then
    return false;
  end if;
  update public.tv_pairings set
    owner_id = case when p_approve then p_owner_id end,
    consent_at = case when p_approve then now() end,
    denied_at = case when not p_approve then now() end,
    denied_by = case when not p_approve then p_owner_id end
  where id = p_id and code_hash = p_code_hash and qr_hash is not null
    and (p_qr_hash is null or qr_hash = p_qr_hash)
    and scope = 'ask:read' and owner_id is null and denied_at is null and revoked_at is null
    and pair_expires_at > clock_timestamp();
  return found;
end;
$$;

alter table public.tv_pairings drop constraint tv_pairings_check;
alter table public.tv_pairings add constraint tv_pairings_lifecycle check (
  (owner_id is null and approved_at is null and expires_at is null and consent_at is null)
  or (owner_id is not null and approved_at is not null and expires_at is not null)
  or (owner_id is not null and consent_at is not null and approved_at is null and expires_at is null)
);

create function public.tv_poll_qr_pairing(p_poll_hash text)
returns text language plpgsql set search_path = '' as $$
declare
  pairing public.tv_pairings%rowtype;
begin
  select * into pairing from public.tv_pairings where poll_hash = p_poll_hash for update;
  if not found then return 'invalid'; end if;
  if pairing.pair_expires_at <= clock_timestamp() then return 'expired'; end if;
  if pairing.revoked_at is not null then return 'cancelled'; end if;
  if pairing.denied_at is not null then return 'denied'; end if;
  if pairing.approved_at is not null then return 'paired'; end if;
  if pairing.next_poll_at > now() then return 'slow_down'; end if;
  if pairing.consent_at is null then
    update public.tv_pairings set next_poll_at = now() + interval '3 seconds' where id = pairing.id;
    return 'pending';
  end if;
  -- Only the original, pre-bound session digest becomes active. A retried poll never issues a new credential.
  update public.tv_pairings set approved_at = now(), expires_at = now() + interval '12 hours'
    where id = pairing.id;
  return 'paired';
end;
$$;

-- Clean up abandoned approvals using the same retention rules as the existing start limiter.
create or replace function public.tv_start_pairing(p_source_hash text, p_code_hash text, p_token_hash text)
returns boolean language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(794103521);
  delete from public.tv_pairings
    where (approved_at is null and pair_expires_at < now() - interval '1 hour')
      or expires_at < now() - interval '7 days';
  if (select count(*) from public.tv_pairings where created_at > now() - interval '1 hour') >= 1000
    or (select count(*) from public.tv_pairings where source_hash = p_source_hash
          and created_at > now() - interval '1 hour') >= 12 then
    return false;
  end if;
  insert into public.tv_pairings(source_hash, code_hash, token_hash)
    values (p_source_hash, p_code_hash, p_token_hash);
  return true;
end;
$$;

revoke all on function public.tv_start_qr_pairing(text,text,text,text,text,text),
  public.tv_review_qr_pairing(text,text,text), public.tv_decide_qr_pairing(text,uuid,text,text,boolean),
  public.tv_poll_qr_pairing(text) from public, anon, authenticated;
grant execute on function public.tv_start_qr_pairing(text,text,text,text,text,text),
  public.tv_review_qr_pairing(text,text,text), public.tv_decide_qr_pairing(text,uuid,text,text,boolean),
  public.tv_poll_qr_pairing(text) to service_role;
