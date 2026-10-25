-- ============================================================
-- Asset Memory: documents-only semantic retrieval
-- Paste this whole file into the Supabase SQL editor and Run.
-- Safe to run more than once (idempotent).
-- Depends on sql/memory-embeddings.sql (memory_embeddings + vector ext).
-- ============================================================

-- Cosine top-k over ONLY the documents slice of memory_embeddings, for one user.
-- Mirrors match_memories but filters to source_table = 'documents' so a "show me
-- my passport" / "find the payment screenshot" retrieval can't be crowded out of
-- the top-k by ordinary memory rows. Returns source_id (= documents.id) so the
-- caller can fetch the row and hand back the original file.
create or replace function match_documents(
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
    and m.source_table = 'documents'
    and m.deleted_at is null
  order by m.embedding <=> p_query
  limit p_k;
$$;
