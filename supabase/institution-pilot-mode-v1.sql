-- AskGogo Institution Pilot Mode v1
-- Run this in Supabase SQL Editor.
-- Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'school',
  city text,
  contact_name text,
  contact_phone text,
  plan text not null default 'pilot',
  status text not null default 'pilot',
  pilot_start_date date,
  pilot_end_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.institutions
  add column if not exists name text,
  add column if not exists type text default 'school',
  add column if not exists city text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists plan text default 'pilot',
  add column if not exists status text default 'pilot',
  add column if not exists pilot_start_date date,
  add column if not exists pilot_end_date date,
  add column if not exists notes text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.users
  add column if not exists institution_id uuid references public.institutions(id) on delete set null,
  add column if not exists institution_name text,
  add column if not exists institution_type text,
  add column if not exists institution_role text,
  add column if not exists institution_segment text;

create index if not exists users_institution_id_idx on public.users(institution_id);
create index if not exists users_institution_name_idx on public.users(institution_name);
create index if not exists users_institution_role_idx on public.users(institution_role);
create index if not exists users_institution_segment_idx on public.users(institution_segment);

create table if not exists public.institution_broadcasts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete cascade,
  institution_name text,
  target_segment text,
  target_role text,
  message text not null,
  sent_count integer not null default 0,
  status text not null default 'draft',
  created_by text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists institution_broadcasts_institution_id_idx on public.institution_broadcasts(institution_id);
create index if not exists institution_broadcasts_status_idx on public.institution_broadcasts(status);

-- Optional sample institution. Edit/delete after testing.
insert into public.institutions (name, type, city, contact_name, contact_phone, plan, status, notes)
select 'AskGogo Demo Institution', 'school', 'Bengaluru', 'Demo Admin', null, 'pilot', 'pilot', 'Sample institution for dashboard testing'
where not exists (
  select 1 from public.institutions where name = 'AskGogo Demo Institution'
);
