-- AskGogo Agent OS v2 — WhatsApp + native Phase 2 capabilities.
-- Branch-only migration. Apply after QA; additive to supabase/agent-os-v1.sql.

-- agent_runs capability check
alter table agent_runs drop constraint if exists agent_runs_capability_check;
alter table agent_runs add constraint agent_runs_capability_check
  check (capability in (
    'memory','files','reminders','lists','tasks','email','calendar','browser','contacts','travel','payments'
  ));

-- agent_permissions capability check
alter table agent_permissions drop constraint if exists agent_permissions_capability_check;
alter table agent_permissions add constraint agent_permissions_capability_check
  check (capability in (
    'memory','files','reminders','lists','tasks','email','calendar','browser','contacts','travel','payments'
  ));

comment on table agent_runs is 'Cross-surface Gogo runs shared by WhatsApp, web and native app. Phase 2 includes memory, files, reminders, lists, tasks and calendar.';
