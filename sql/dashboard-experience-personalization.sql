-- AskGogo dashboard experience personalization + learning progress.
-- Safe to run repeatedly.

create table if not exists public.user_experience_preferences (
  telegram_id bigint primary key,
  personality text not null default 'calm_companion',
  comfort_drink text not null default 'coffee',
  updated_at timestamptz not null default now(),
  constraint user_experience_personality_check check (
    personality in ('calm_companion','sharp_professional','straight_talking_coach','quiet_minimalist')
  ),
  constraint user_experience_drink_check check (
    comfort_drink in ('coffee','tea','matcha','water','hot_chocolate','coconut_water')
  )
);

alter table public.user_experience_preferences enable row level security;

create table if not exists public.learning_progress (
  telegram_id bigint not null,
  lesson_key text not null,
  watched_at timestamptz not null default now(),
  completed boolean not null default true,
  primary key (telegram_id, lesson_key)
);

create index if not exists learning_progress_user_idx
  on public.learning_progress (telegram_id, watched_at desc);

alter table public.learning_progress enable row level security;

-- No client policies on purpose. Dashboard APIs use the server-side service role.
