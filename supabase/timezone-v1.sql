-- AskGogo Timezone Support - safe to re-run
-- Adds timezone column to users table

alter table public.users
  add column if not exists timezone text default 'Asia/Kolkata';

-- Index for timezone-based queries
create index if not exists users_timezone_idx on public.users(timezone);

-- Update existing users based on their phone number prefix
update public.users set timezone = 'Asia/Kolkata'   where whatsapp_id like '+91%'  and (timezone is null or timezone = 'Asia/Kolkata');
update public.users set timezone = 'Asia/Dubai'      where whatsapp_id like '+971%' and (timezone is null or timezone = 'Asia/Kolkata');
update public.users set timezone = 'Europe/London'   where whatsapp_id like '+44%'  and (timezone is null or [timezone = 'Asia/Kolkata');
update public.users set timezone = 'Asia/Singapore'  where whatsapp_id like '+65%'  and (timezone is null or [timezone = 'Asia/Kolkata');
update public.users set timezone = 'Asia/Kuala_Lumpur' where whatsapp_id like '+60%' and (timezone is null or timezone = 'Asia/Kolkata');
update public.users set timezone = 'Australia/Sydney' where whatsapp_id like '+61%' and (timezone is null or [timezone = 'Asia/Kolkata');
update public.users set timezone = 'Asia/Tokyo'      where whatsapp_id like '+81%'  and (timezone is null or [timezone = 'Asia/Kolkata');
update public.users set timezone = 'America/New_York' where whatsapp_id like '+1%'  and (timezone is null or [timezone = 'Asia/Kolkata');
