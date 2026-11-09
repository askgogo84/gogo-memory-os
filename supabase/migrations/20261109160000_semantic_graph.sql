-- Same Brain 3.0, Phase 1: the semantic spine. Relational graph storage (no Neo4j): entities, sources, assertions.
-- Owner-run only. Behind GOGO_SEMANTIC; nothing reads these tables until the flag is on.
-- Scope: every row belongs to one verified user ('user', telegram id as text) or one workspace ('workspace', uuid).

create table if not exists public.semantic_entities (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('user','workspace')),
  scope_id text not null,
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  canonical_key text not null check (char_length(canonical_key) between 1 and 300),
  attributes_json jsonb not null default '{}'::jsonb,
  sensitivity text not null default 'normal' check (sensitivity in ('normal','sensitive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  check ((scope_type = 'user' and scope_id ~ '^-?[0-9]{1,20}$') or (scope_type = 'workspace' and scope_id ~ '^[0-9a-f-]{36}$')),
  unique (scope_type, scope_id, entity_type, canonical_key)
);
create index if not exists semantic_entities_scope_type_idx on public.semantic_entities (scope_type, scope_id, entity_type) where retired_at is null;

create table if not exists public.semantic_sources (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('user','workspace')),
  scope_id text not null,
  source_type text not null check (source_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  source_object_ref text not null check (char_length(source_object_ref) between 1 and 300),
  observed_at timestamptz,
  ingested_at timestamptz not null default now(),
  verification_status text not null check (verification_status in ('verified_provider','user_stated','user_preference','inferred','unverified')),
  sensitivity text not null default 'normal' check (sensitivity in ('normal','sensitive')),
  metadata_json jsonb not null default '{}'::jsonb,
  check ((scope_type = 'user' and scope_id ~ '^-?[0-9]{1,20}$') or (scope_type = 'workspace' and scope_id ~ '^[0-9a-f-]{36}$')),
  unique (scope_type, scope_id, source_type, source_object_ref)
);

create table if not exists public.semantic_assertions (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('user','workspace')),
  scope_id text not null,
  subject_entity_id uuid not null references public.semantic_entities(id) on delete cascade,
  predicate text not null check (predicate ~ '^[a-z][a-z0-9_]{1,60}$'),
  object_entity_id uuid references public.semantic_entities(id) on delete cascade,
  literal_value_json jsonb,
  source_id uuid not null references public.semantic_sources(id) on delete cascade,
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  assertion_status text not null default 'current' check (assertion_status in ('current','superseded','retracted')),
  valid_from timestamptz,
  valid_until timestamptz,
  recorded_at timestamptz not null default now(),
  supersedes_assertion_id uuid references public.semantic_assertions(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  -- exactly one object representation: a related entity or a literal value
  check ((object_entity_id is not null) <> (literal_value_json is not null)),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  check ((scope_type = 'user' and scope_id ~ '^-?[0-9]{1,20}$') or (scope_type = 'workspace' and scope_id ~ '^[0-9a-f-]{36}$'))
);
create index if not exists semantic_assertions_subject_idx on public.semantic_assertions (scope_type, scope_id, subject_entity_id, predicate) where assertion_status = 'current';
create index if not exists semantic_assertions_object_idx on public.semantic_assertions (scope_type, scope_id, object_entity_id) where object_entity_id is not null and assertion_status = 'current';
create index if not exists semantic_assertions_source_idx on public.semantic_assertions (source_id);
create index if not exists semantic_assertions_valid_idx on public.semantic_assertions (scope_type, scope_id, valid_from, valid_until);
-- one current scalar value per subject+predicate (relationships to entities may have several objects)
create unique index if not exists semantic_assertions_one_current_scalar on public.semantic_assertions (scope_type, scope_id, subject_entity_id, predicate) where assertion_status = 'current' and literal_value_json is not null;

alter table public.semantic_entities enable row level security;
alter table public.semantic_sources enable row level security;
alter table public.semantic_assertions enable row level security;
revoke all on public.semantic_entities, public.semantic_sources, public.semantic_assertions from anon, authenticated;
grant select, insert, update, delete on public.semantic_entities, public.semantic_sources, public.semantic_assertions to service_role;
