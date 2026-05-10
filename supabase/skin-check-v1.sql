create extension if not exists pgcrypto;

create table if not exists public.skin_check_reports (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  source_platform text not null default 'whatsapp',
  image_url text,
  summary text,
  lighting_quality text,
  face_visibility text,
  confidence_level text,
  skin_type text,
  observations_json jsonb not null default '[]'::jsonb,
  scores_json jsonb not null default '{}'::jsonb,
  face_zones_json jsonb not null default '{}'::jsonb,
  am_routine_json jsonb not null default '[]'::jsonb,
  pm_routine_json jsonb not null default '[]'::jsonb,
  cautions_json jsonb not null default '[]'::jsonb,
  progress_tip text,
  raw_report text,
  created_at timestamptz not null default now()
);

create index if not exists idx_skin_check_reports_telegram_created
on public.skin_check_reports (telegram_id, created_at desc);

alter table public.skin_check_reports enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'skin_check_reports'
      and policyname = 'Service role can manage skin check reports'
  ) then
    create policy "Service role can manage skin check reports"
    on public.skin_check_reports
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
  end if;
end $$;
