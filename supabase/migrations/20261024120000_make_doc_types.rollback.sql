-- Rollback: only safe when no slide_deck/spreadsheet/daily_brief/decision_summary rows exist.
alter table public.agent_artifacts drop constraint if exists agent_artifacts_type_check;
alter table public.agent_artifacts add constraint agent_artifacts_type_check check (type in (
  'trip','application_tracker','meeting_brief','comparison','goal_plan','research_brief','reward_summary'
));
