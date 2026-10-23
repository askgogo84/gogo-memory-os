-- Make: real slides and sheets (24 Oct). Allows the slide_deck and spreadsheet artifact types, plus the
-- registered daily_brief and decision_summary kinds. Additive: existing rows are unaffected.
alter table public.agent_artifacts drop constraint if exists agent_artifacts_type_check;
alter table public.agent_artifacts add constraint agent_artifacts_type_check check (type in (
  'trip','application_tracker','meeting_brief','comparison','goal_plan','research_brief','reward_summary',
  'daily_brief','decision_summary','slide_deck','spreadsheet'
));
