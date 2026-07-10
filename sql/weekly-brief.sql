-- Phase 1E: weekly (Sunday) week-ahead brief toggle
alter table users add column if not exists weekly_brief boolean default false;
