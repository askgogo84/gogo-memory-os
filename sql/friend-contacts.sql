-- Phase 1C: friend-to-friend reminder contacts
create table if not exists friend_contacts (
  owner_telegram_id bigint not null,
  name text not null,
  whatsapp_id text not null,
  created_at timestamptz default now(),
  primary key (owner_telegram_id, name)
);
