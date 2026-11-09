-- Red #1174: a recurring reminder's snooze creates a one-off copy. The copy carries snooze_key
-- ("snooze:<fired reminder id>:<sent_at>") so a replayed, concurrent or retried snooze of the same fired occurrence
-- cannot insert a second copy. Owner-run. Must be applied BEFORE deploying the code that writes snooze_key,
-- otherwise recurring snooze inserts fail (unknown column) and the user is told the snooze could not be saved.
alter table public.reminders add column if not exists snooze_key text;
create unique index if not exists reminders_snooze_key_uniq on public.reminders (snooze_key) where snooze_key is not null;
