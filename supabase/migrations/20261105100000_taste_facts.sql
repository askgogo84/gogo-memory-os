-- "Remember and suggest" Phase 1 (approved build docs, 5 Nov): food taste a person told Gogo.
-- DO NOT RUN WITHOUT OWNER APPROVAL. Project: qenhjcooyecmatwducpu.
-- Code treats a missing table as "not ready" and falls through to normal chat, so deploying code first is safe.
-- telegram_id is text (WhatsApp ids are 64-bit; they never pass through a JS Number).
-- Forget is soft (forgotten_at) so a forgotten line never comes back from a later dedupe; the dashboard hides it.
--
-- Rollback (exact; drops only this table, nothing else references it):
--   drop table if exists public.taste_facts;
begin;
set local lock_timeout = '5s';

create table if not exists public.taste_facts (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  domain text not null default 'food' check (domain in ('food')),
  kind text not null check (kind in ('likes', 'avoids', 'budget', 'when', 'place', 'diet_stated')),
  value text not null check (char_length(value) between 1 and 160),
  context text null check (context is null or char_length(context) <= 60),
  source text not null default 'said' check (source in ('said', 'order_confirmed', 'pick_accepted', 'rating')),
  evidence_count integer not null default 1 check (evidence_count >= 1),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  forgotten_at timestamptz null
);

-- One live line per owner, kind, value and context; forgotten lines don't block saying it again.
create unique index if not exists taste_facts_live_unique
  on public.taste_facts (telegram_id, domain, kind, lower(value), coalesce(context, ''))
  where forgotten_at is null;
create index if not exists taste_facts_owner_idx on public.taste_facts (telegram_id, domain, last_seen desc) where forgotten_at is null;

alter table public.taste_facts enable row level security;
revoke all on table public.taste_facts from public, anon, authenticated;
grant select, insert, update, delete on table public.taste_facts to service_role;

commit;

-- Confirm (read-only):
-- select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='taste_facts' order by ordinal_position;
-- select relrowsecurity from pg_class where oid = 'public.taste_facts'::regclass;
