-- Phase 1B: Throwback — track when a memory was last resurfaced.
alter table memory_embeddings add column if not exists resurfaced_at timestamptz;
create index if not exists memory_embeddings_resurfaced on memory_embeddings (telegram_id, resurfaced_at);
