alter table if exists public.users
  add column if not exists gmail_send_connected boolean not null default false,
  add column if not exists gmail_send_connected_at timestamptz;
