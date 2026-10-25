alter table public.users
add column if not exists gmail_access_token text,
add column if not exists gmail_refresh_token text,
add column if not exists gmail_email text,
add column if not exists gmail_connected boolean default false,
add column if not exists gmail_connected_at timestamptz;
