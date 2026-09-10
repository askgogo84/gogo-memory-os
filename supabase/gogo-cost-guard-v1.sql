-- Gogo Cost Guard v1
-- Public pricing target: ₹0 / ₹249 / ₹499 / ₹999.
-- This ledger protects contribution margin independently of user-facing action quotas.

create table if not exists public.gogo_cost_budgets (
  plan_code text primary key,
  monthly_budget_paise integer not null check (monthly_budget_paise >= 0),
  warning_percent integer not null default 80 check (warning_percent between 1 and 100),
  hard_stop_percent integer not null default 100 check (hard_stop_percent between 1 and 200),
  active_web_watchers_max integer not null default 0 check (active_web_watchers_max >= 0),
  base_watcher_cadence_minutes integer not null default 1440 check (base_watcher_cadence_minutes >= 15),
  max_watcher_cadence_minutes integer not null default 1440 check (max_watcher_cadence_minutes >= base_watcher_cadence_minutes),
  burst_watcher_cadence_minutes integer not null default 1440 check (burst_watcher_cadence_minutes >= 15),
  burst_hours integer not null default 0 check (burst_hours >= 0),
  updated_at timestamptz not null default now()
);

insert into public.gogo_cost_budgets
(plan_code, monthly_budget_paise, warning_percent, hard_stop_percent, active_web_watchers_max, base_watcher_cadence_minutes, max_watcher_cadence_minutes, burst_watcher_cadence_minutes, burst_hours)
values
  ('free',        2500, 80, 100, 0, 1440, 1440, 1440, 0),
  ('imported',    2500, 80, 100, 0, 1440, 1440, 1440, 0),
  ('essential',  12000, 80, 100, 1, 1440, 1440, 1440, 0),
  ('lite',       12000, 80, 100, 1, 1440, 1440, 1440, 0),
  ('plus',       24000, 80, 100, 3,  360, 1440,   60, 6),
  ('starter',    24000, 80, 100, 3,  360, 1440,   60, 6),
  ('pro',        48000, 80, 100, 6,  180,  720,   15, 24),
  ('pro_annual', 48000, 80, 100, 6,  180,  720,   15, 24),
  ('founder_pro',500000, 70, 100,20,   15,  180,   15, 48)
on conflict (plan_code) do update set
  monthly_budget_paise = excluded.monthly_budget_paise,
  warning_percent = excluded.warning_percent,
  hard_stop_percent = excluded.hard_stop_percent,
  active_web_watchers_max = excluded.active_web_watchers_max,
  base_watcher_cadence_minutes = excluded.base_watcher_cadence_minutes,
  max_watcher_cadence_minutes = excluded.max_watcher_cadence_minutes,
  burst_watcher_cadence_minutes = excluded.burst_watcher_cadence_minutes,
  burst_hours = excluded.burst_hours,
  updated_at = now();

create table if not exists public.gogo_cost_events (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null,
  plan_code text,
  category text not null,
  estimated_cost_paise integer not null check (estimated_cost_paise >= 0),
  units numeric(12,4) not null default 1,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gogo_cost_events_user_time_idx
  on public.gogo_cost_events (telegram_id, created_at desc);
create index if not exists gogo_cost_events_category_time_idx
  on public.gogo_cost_events (category, created_at desc);

create or replace function public.gogo_monthly_cost_paise(p_telegram_id text, p_since timestamptz)
returns bigint
language sql
stable
as $$
  select coalesce(sum(estimated_cost_paise), 0)::bigint
  from public.gogo_cost_events
  where telegram_id = p_telegram_id
    and created_at >= p_since;
$$;
