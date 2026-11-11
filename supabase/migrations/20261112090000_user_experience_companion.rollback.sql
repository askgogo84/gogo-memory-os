-- Rollback for 20261112090000_user_experience_companion.sql. Everyone goes back to Gogo; nothing else changes.
alter table public.user_experience_preferences drop constraint if exists user_experience_preferences_companion_check;
alter table public.user_experience_preferences drop column if exists companion;
