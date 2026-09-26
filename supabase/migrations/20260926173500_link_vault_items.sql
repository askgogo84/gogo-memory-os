-- T14 Gogo Link Vault: private owner-bound saved web memory.
create table if not exists public.link_vault_items (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  canonical_url text not null,
  original_url text not null,
  platform text not null default 'web',
  item_type text not null default 'link',
  title text not null default '',
  description text not null default '',
  source text not null default '',
  user_note text not null default '',
  note_history jsonb not null default '[]'::jsonb,
  saved_at timestamptz not null default now(),
  last_saved_at timestamptz not null default now(),
  topic text,
  tags text[] not null default '{}'::text[],
  shelf text,
  preview_image text,
  screenshot_url text,
  enrichment_status text not null default 'metadata_only',
  auth_required boolean not null default false,
  source_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint link_vault_owner_url_unique unique (telegram_id, canonical_url),
  constraint link_vault_enrichment_check check (enrichment_status in ('metadata_only','enriched','blocked','failed'))
);

create index if not exists link_vault_owner_saved_idx
  on public.link_vault_items (telegram_id, saved_at desc);
create index if not exists link_vault_owner_platform_idx
  on public.link_vault_items (telegram_id, platform, saved_at desc);
create index if not exists link_vault_tags_gin_idx
  on public.link_vault_items using gin (tags);

alter table public.link_vault_items enable row level security;

comment on table public.link_vault_items is
  'Private owner-bound saved-link index. Accessed server-side through AskGogo owner identity; no public read policy.';
