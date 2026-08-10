-- Reminder opt-out: a recipient suppresses reminders from ONE specific sender.
-- Keyed per sender-recipient PAIR, never global — blocking one owner must not
-- affect reminders from any other owner. Follows the house style of
-- sql/friend-contacts.sql: owner_telegram_id bigint, whatsapp id as text,
-- created_at timestamptz default now(), composite primary key.
create table if not exists reminder_optout (
  owner_telegram_id bigint not null,
  recipient_whatsapp_id text not null,
  created_at timestamptz default now(),
  primary key (owner_telegram_id, recipient_whatsapp_id)
);
