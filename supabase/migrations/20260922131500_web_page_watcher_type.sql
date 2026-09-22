-- First-class persistent browser-backed page watcher.
alter table public.agent_watchers
  drop constraint if exists agent_watchers_type_check;

alter table public.agent_watchers
  add constraint agent_watchers_type_check
  check (
    type = any (
      array[
        'price_threshold'::text,
        'deadline'::text,
        'calendar_change'::text,
        'email_reply'::text,
        'web_change'::text,
        'application_status'::text,
        'travel_disruption'::text,
        'web_search'::text,
        'web_page'::text,
        'goal_review'::text,
        'product_stock'::text,
        'email_triage'::text
      ]
    )
  );
