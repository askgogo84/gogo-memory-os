-- Gmail consent reset + backfill (4 Nov 2026, P1 hotfix #1255). DO NOT RUN WITHOUT OWNER APPROVAL.
-- Project: qenhjcooyecmatwducpu. Run together with the #1255 deploy.
--
-- What production showed on 4 Nov: user_consent_settings.gmail_enabled = false on 138 rows, true on 1, null on none.
-- No code path has ever written false (repo search: the only writer is lib/agent/gmail-consent.ts, which writes true),
-- and the memory-twin setup inserts rows without the column, so every false is the column DEFAULT, not a person saying no.
-- Left as is, the hotfix would read those 138 defaults as "turned off" and connecting Gmail could never give a yes.
--
-- After this script:
--   null  = no answer yet (Gmail not read)            <- the old defaults, and every new row (default dropped)
--   true  = yes, saved when the person connected Gmail <- the existing true row, plus people already connected via Google
--   false = an explicit "off" (none exist today)
--
-- Rollback (exact): note the telegram_ids step 0b lists as true, then
--   alter table public.user_consent_settings alter column gmail_enabled set default false;
--   update public.user_consent_settings set gmail_enabled = false where telegram_id not in (<true ids from 0b>);
--   (rows step 3 inserted then read false, which is what the old default gave them anyway)

-- 0a. Look first (read-only): the column and its default.
select column_default, is_nullable, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'user_consent_settings' and column_name = 'gmail_enabled';
-- 0b. Who is true today (save this for rollback).
select telegram_id from public.user_consent_settings where gmail_enabled is true;
-- 0c. Counts now.
select gmail_enabled, count(*) from public.user_consent_settings group by gmail_enabled;

begin;
set local lock_timeout = '5s';
-- 1. New rows start with no answer.
alter table public.user_consent_settings alter column gmail_enabled drop default;
-- 2. Every existing false is the old default (see above): clear it to "no answer".
update public.user_consent_settings set gmail_enabled = null where gmail_enabled is false;
-- 3. People already connected through Google sign-in said yes by connecting (owner decision, 4 Nov).
update public.user_consent_settings c set gmail_enabled = true
from public.users u
where u.telegram_id = c.telegram_id and u.gmail_connected is true and c.gmail_enabled is null;
insert into public.user_consent_settings (telegram_id, gmail_enabled)
select u.telegram_id, true from public.users u
where u.gmail_connected is true
  and not exists (select 1 from public.user_consent_settings c where c.telegram_id = u.telegram_id)
on conflict (telegram_id) do nothing;
commit;

-- 4. Confirm (read-only): no false rows, connected users true, column default null.
select gmail_enabled, count(*) from public.user_consent_settings group by gmail_enabled;
select column_default from information_schema.columns
where table_schema = 'public' and table_name = 'user_consent_settings' and column_name = 'gmail_enabled';
select count(*) as connected_without_yes from public.users u left join public.user_consent_settings c on c.telegram_id = u.telegram_id
where u.gmail_connected is true and c.gmail_enabled is not true;
