-- Run on its own (not inside a transaction): builds without blocking chat writes.
create index concurrently if not exists conversations_owner_thread_created_idx on public.conversations (telegram_id, thread_id, created_at desc);
