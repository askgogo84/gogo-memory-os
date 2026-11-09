-- Gogo Spaces (six docs approved 8 Nov 2026, section 5). Prepared for owner review; not run by the agent.
-- A Space is owner-edited JSON (lib/spaces/schema.ts validates it); every saved edit is a version row.
-- Owner = the user's telegram id as TEXT (ids can be negative or exceed 2^53), or a workspace for team Spaces.
-- Same access pattern as the pilot tables: RLS on, no client policies, service_role only; the app checks the owner
-- (dashboard session) or workspace membership before every read or write.

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  owner_telegram_id text,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z][a-z0-9_]{0,40}$'),
  template text not null check (template in ('my_day','trip_board','tipplr_exceptions','custom')),
  version integer not null default 1 check (version >= 1),
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_telegram_id is null) <> (workspace_id is null)),
  check (owner_telegram_id is null or owner_telegram_id ~ '^-?[0-9]{1,20}$')
);
create unique index if not exists spaces_owner_slug on public.spaces (owner_telegram_id, slug) where owner_telegram_id is not null;
create unique index if not exists spaces_workspace_slug on public.spaces (workspace_id, slug) where workspace_id is not null;

create table if not exists public.space_versions (
  space_id uuid not null references public.spaces(id) on delete cascade,
  version integer not null check (version >= 1),
  doc jsonb not null,
  changed_by text not null,
  change text not null check (char_length(change) <= 200),
  created_at timestamptz not null default now(),
  primary key (space_id, version)
);

alter table public.spaces enable row level security;
alter table public.space_versions enable row level security;
revoke all on public.spaces from anon, authenticated;
revoke all on public.space_versions from anon, authenticated;
grant select, insert, update, delete on public.spaces to service_role;
grant select, insert, update, delete on public.space_versions to service_role;
