-- ============================================================
-- Phase 1A: Semantic memory search
-- Paste this whole file into the Supabase SQL editor and Run.
-- Safe to run more than once (idempotent).
-- Embedding model: OpenAI text-embedding-3-small  ->  vector dim 1536
-- ============================================================

create extension if not exists vector;

create table if not exists memory_embeddings (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  source_table text not null default 'memories',  -- 'memories' | 'media_memory' | ...
  source_id text not null,                          -- the memories.id it mirrors
  content text not null,                            -- embedded text (truncated ~2000 chars)
  embedding vector(1536),
  deleted_at timestamptz,                           -- soft-delete (mirrors "forget")
  created_at timestamptz default now(),
  unique (source_table, source_id)
);

create index if not exists memory_embeddings_tg on memory_embeddings (telegram_id);
create index if not exists memory_embeddings_ivf
  on memory_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Cosine top-k for one user. Excludes soft-deleted rows.
create or replace function match_memories(
  p_telegram_id bigint,
  p_query vector(1536),
  p_k int default 5
) returns table (
  source_id text, content text, created_at timestamptz, score float
) language sql stable as $$
  select m.source_id, m.content, m.created_at,
         1 - (m.embedding <=> p_query) as score
  from memory_embeddings m
  where m.telegram_id = p_telegram_id
    and m.deleted_at is null
  order by m.embedding <=> p_query
  limit p_k;
$$;
