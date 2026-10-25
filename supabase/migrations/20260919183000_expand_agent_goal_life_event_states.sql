-- Align production CHECK constraints with states already emitted by the agent runtime.
-- D1: goal-engine.ts intentionally uses status='blocked' when a goal needs human review.
-- D4: life-event safety paths intentionally use lifecycle_state='needs_attention'
-- when an airline check-in outcome is uncertain and must not be retried automatically.

alter table public.agent_goals
  drop constraint if exists agent_goals_status_check;

alter table public.agent_goals
  add constraint agent_goals_status_check
  check (status = any (array[
    'active'::text,
    'paused'::text,
    'blocked'::text,
    'completed'::text,
    'cancelled'::text
  ]));

alter table public.life_events
  drop constraint if exists life_events_lifecycle_state_check;

alter table public.life_events
  add constraint life_events_lifecycle_state_check
  check (lifecycle_state = any (array[
    'captured'::text,
    'planned'::text,
    'watching'::text,
    'waiting_approval'::text,
    'in_progress'::text,
    'needs_attention'::text,
    'completed'::text,
    'cancelled'::text,
    'expired'::text
  ]));
