-- Rollback for 20261102092000_autonomy_email_atomic_claim.sql. Run only after reverting the code that calls these
-- functions (lib/agent/autonomy-pulse.ts), otherwise proactive email cards stop until the migration is re-applied.
begin;
drop function if exists public.finish_autonomy_email_card(bigint, uuid, text);
drop function if exists public.claim_autonomy_email_card(bigint, date, text[], uuid, integer);
drop table if exists public.autonomy_email_claims;
drop table if exists public.autonomy_email_daily_budget;
commit;
