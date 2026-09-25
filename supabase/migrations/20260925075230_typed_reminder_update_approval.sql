-- Add the explicit reminder approval action without changing permissions or RLS.
begin;
set local lock_timeout = '5s';
alter table public.agent_approvals drop constraint agent_approvals_action_type_check;
alter table public.agent_approvals add constraint agent_approvals_action_type_check
  check (action_type in ('send_email','submit_form','calendar_change','booking','purchase','share','reminder_change'));
commit;
