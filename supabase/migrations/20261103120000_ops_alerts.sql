-- Gogo Ops Alerts (3 Nov 2026, approved mockup): one place for every operational signal — billing, error spikes,
-- failed tasks, providers — grouped by fingerprint into incidents with a count. Read and written only by the server
-- (service role); no client policies. Rollback: 20261103120000_ops_alerts.rollback.sql.

create table if not exists public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  no bigint generated always as identity unique,
  fingerprint text not null check (char_length(fingerprint) between 1 and 200),
  source text not null check (source in ('billing','errors','tasks','provider','jobs','security','whatsapp','code','quality')),
  severity text not null check (severity in ('P1','P2','P3')),
  title text not null check (char_length(title) between 1 and 200),
  detail text not null default '' check (char_length(detail) <= 2000),
  occurrences integer not null default 1 check (occurrences >= 1),
  status text not null default 'open' check (status in ('open','acked','muted','resolved')),
  muted_until timestamptz,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  notified_at timestamptz,
  acked_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live incident per fingerprint; a resolved one can recur as a new incident.
create unique index if not exists ops_alerts_one_live_per_fingerprint on public.ops_alerts (fingerprint) where status <> 'resolved';
create index if not exists ops_alerts_status_last_seen on public.ops_alerts (status, last_seen desc);

alter table public.ops_alerts enable row level security;

-- Supabase (30 Oct 2026): new public tables get no Data API grants by default. Server only: grant the service role,
-- keep anon and signed-in clients out.
revoke all on public.ops_alerts from anon, authenticated;
grant select, insert, update, delete on public.ops_alerts to service_role;
