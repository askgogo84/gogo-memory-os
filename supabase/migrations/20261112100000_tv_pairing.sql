create table public.tv_pairings (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  token_hash text not null unique,
  source_hash text not null,
  owner_id text,
  scope text not null default 'ask:read' check (scope = 'ask:read'),
  created_at timestamptz not null default now(),
  pair_expires_at timestamptz not null default (now() + interval '10 minutes'),
  approved_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  next_request_at timestamptz not null default now(),
  check ((owner_id is null and approved_at is null and expires_at is null)
      or (owner_id is not null and approved_at is not null and expires_at is not null))
);

alter table public.tv_pairings enable row level security;
revoke all on public.tv_pairings from public, anon, authenticated;
grant select, insert, update, delete on public.tv_pairings to service_role;
create index tv_pairings_source_created on public.tv_pairings (source_hash, created_at);
create index tv_pairings_owner on public.tv_pairings (owner_id, approved_at desc);

create function public.tv_start_pairing(p_source_hash text, p_code_hash text, p_token_hash text)
returns boolean language plpgsql set search_path = '' as $$
begin
  -- Serialize starts across replicas and bound storage and anonymous traffic.
  perform pg_catalog.pg_advisory_xact_lock(794103521);
  delete from public.tv_pairings
    where (owner_id is null and pair_expires_at < now() - interval '1 hour')
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
revoke all on function public.tv_start_pairing(text,text,text) from public, anon, authenticated;
grant execute on function public.tv_start_pairing(text,text,text) to service_role;

create function public.tv_approve_pairing(p_owner_id text, p_code_hash text)
returns boolean language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id, 537114291));
  if (select count(*) from public.tv_pairings where owner_id = p_owner_id
    and revoked_at is null and expires_at > now()) >= 8 then
    return false;
  end if;
  update public.tv_pairings
    set owner_id = p_owner_id, approved_at = now(), expires_at = now() + interval '30 days'
    where code_hash = p_code_hash and owner_id is null
      and revoked_at is null and pair_expires_at > now();
  return found;
end;
$$;
revoke all on function public.tv_approve_pairing(text,text) from public, anon, authenticated;
grant execute on function public.tv_approve_pairing(text,text) to service_role;
