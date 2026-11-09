-- Roll back only after reverting the code that writes reminders.snooze_key.
drop index if exists public.reminders_snooze_key_uniq;
alter table public.reminders drop column if exists snooze_key;
