-- AskGogo: the person's chosen companion character (Gogo crew, 12 Nov 2026). Null = Gogo.
alter table public.user_experience_preferences add column if not exists companion text;
alter table public.user_experience_preferences drop constraint if exists user_experience_preferences_companion_check;
alter table public.user_experience_preferences add constraint user_experience_preferences_companion_check
  check (companion is null or companion in ('gogo','mishti','chai','tara','bolt','momo'));
