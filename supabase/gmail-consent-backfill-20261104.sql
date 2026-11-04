-- Gmail consent backfill (4 Nov 2026, P1 hotfix). DO NOT RUN WITHOUT OWNER APPROVAL. Project: qenhjcooyecmatwducpu.
-- Owner decision: connecting Gmail counts as the person's yes to reading it. From the hotfix on, Gmail is read only when
-- user_consent_settings.gmail_enabled is true; this records that yes for people who ALREADY connected Gmail through
-- Google sign-in (users.gmail_connected). It never overrides an explicit false. People connected only through the
-- Composio link get it recorded the next time they open Settings -> Email after reconnecting.
-- Rollback: 20261104 rollback block at the bottom (only rows this backfill touched, by its marker).

-- 0. Look first (read-only): who would change.
select u.telegram_id, c.gmail_enabled as current_value
from public.users u left join public.user_consent_settings c on c.telegram_id = u.telegram_id
where u.gmail_connected is true and c.gmail_enabled is distinct from false and c.gmail_enabled is distinct from true;

begin;
set local lock_timeout = '5s';
-- 1. Rows that exist with gmail_enabled null.
update public.user_consent_settings c set gmail_enabled = true
from public.users u
where u.telegram_id = c.telegram_id and u.gmail_connected is true and c.gmail_enabled is null;
-- 2. People with no consent row yet.
insert into public.user_consent_settings (telegram_id, gmail_enabled)
select u.telegram_id, true from public.users u
where u.gmail_connected is true
  and not exists (select 1 from public.user_consent_settings c where c.telegram_id = u.telegram_id)
on conflict (telegram_id) do nothing;
commit;

-- 3. Confirm (read-only): expect zero rows.
select u.telegram_id from public.users u left join public.user_consent_settings c on c.telegram_id = u.telegram_id
where u.gmail_connected is true and c.gmail_enabled is null;

-- Rollback (only if needed, before any new consent is saved): note the telegram_ids from step 0 and run
-- update public.user_consent_settings set gmail_enabled = null where telegram_id in (<ids from step 0>);
