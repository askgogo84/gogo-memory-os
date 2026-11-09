-- Daily AI-action caps aligned with the margin-based monthly allowances (4 Nov 2026). DO NOT RUN WITHOUT OWNER APPROVAL.
-- Project: qenhjcooyecmatwducpu. Monthly allowance lives in code (lib/data/limits.ts); the daily cap is read from this
-- table by the meter, so the two must agree: Free 5, Essential (lite) 20, Plus (pro) 55, Pro (founder_pro) 125.
-- Rollback: step 0's output (save it first), re-applied with the same UPDATE shape.

-- 0. Look first (read-only): current caps.
select plan_code, ai_actions_per_day from public.plan_limits order by plan_code;

begin;
set local lock_timeout = '5s';
update public.plan_limits set ai_actions_per_day = 5,   updated_at = now() where plan_code = 'free';
update public.plan_limits set ai_actions_per_day = 20,  updated_at = now() where plan_code in ('lite', 'starter');
update public.plan_limits set ai_actions_per_day = 55,  updated_at = now() where plan_code in ('pro', 'pro_annual');
-- Gogo Pro: add its row if missing (unmapped plan codes fall back to Free's caps), else update it.
insert into public.plan_limits (plan_code, ai_actions_per_day, documents_per_month, friend_contacts_max, reminders_per_day_fair_use, calendars_max)
values ('founder_pro', 125, 200, 20, 50, 9)
on conflict (plan_code) do update set ai_actions_per_day = excluded.ai_actions_per_day, updated_at = now();
commit;

-- 1. Confirm (read-only).
select plan_code, ai_actions_per_day from public.plan_limits order by plan_code;
