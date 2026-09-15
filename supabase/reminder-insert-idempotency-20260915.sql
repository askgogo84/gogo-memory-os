-- Prevent duplicate pending reminders from being inserted for the same user, target,
-- message and scheduled instant. This is deliberately enforced in Postgres so every
-- writer (WhatsApp, dashboard, planner, follow-up flows) gets the same guarantee.
--
-- The advisory transaction lock serializes concurrent inserts for the same dedupe
-- key. Returning NULL from a BEFORE INSERT trigger silently skips the duplicate,
-- which preserves existing callers that use plain .insert(...) without SELECT/RETURNING.

create or replace function public.prevent_duplicate_pending_reminder()
returns trigger
language plpgsql
as $$
declare
  lock_key bigint;
begin
  lock_key := hashtextextended(
    concat_ws('|',
      coalesce(new.telegram_id::text, ''),
      coalesce(new.whatsapp_to, ''),
      lower(trim(coalesce(new.message, ''))),
      coalesce(new.remind_at::text, '')
    ),
    0
  );

  perform pg_advisory_xact_lock(lock_key);

  if new.sent = false and exists (
    select 1
    from public.reminders r
    where r.sent = false
      and r.telegram_id is not distinct from new.telegram_id
      and coalesce(r.whatsapp_to, '') = coalesce(new.whatsapp_to, '')
      and lower(trim(coalesce(r.message, ''))) = lower(trim(coalesce(new.message, '')))
      and r.remind_at = new.remind_at
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists reminders_prevent_duplicate_pending_insert on public.reminders;

create trigger reminders_prevent_duplicate_pending_insert
before insert on public.reminders
for each row
execute function public.prevent_duplicate_pending_reminder();
