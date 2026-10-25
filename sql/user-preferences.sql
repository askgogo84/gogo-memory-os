-- Phase 1D: Personalization rules engine ("standing preferences")
create table if not exists user_preferences (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  rule_text text not null,
  created_at timestamptz default now()
);
create index if not exists user_preferences_tg on user_preferences (telegram_id);
