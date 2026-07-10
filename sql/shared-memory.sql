-- Phase 1.5: Shared Memory (topic buckets shared with a contact)
alter table memory_embeddings add column if not exists topic text;
create index if not exists memory_embeddings_topic on memory_embeddings (telegram_id, topic);

create table if not exists memory_shares (
  owner_telegram_id bigint not null,
  recipient_telegram_id bigint not null,
  topic text not null,
  created_at timestamptz default now(),
  primary key (owner_telegram_id, recipient_telegram_id, topic)
);
create index if not exists memory_shares_recipient on memory_shares (recipient_telegram_id);

-- Cosine search across memories shared TO a recipient (read-only).
create or replace function match_shared_memories(
  p_recipient bigint,
  p_query vector(1536),
  p_k int default 5
) returns table (
  owner_telegram_id bigint, topic text, content text, created_at timestamptz, score float
) language sql stable as $$
  select m.telegram_id as owner_telegram_id, m.topic, m.content, m.created_at,
         1 - (m.embedding <=> p_query) as score
  from memory_shares s
  join memory_embeddings m
    on m.telegram_id = s.owner_telegram_id
   and lower(m.topic) = lower(s.topic)
  where s.recipient_telegram_id = p_recipient
    and m.deleted_at is null
  order by m.embedding <=> p_query
  limit p_k;
$$;
