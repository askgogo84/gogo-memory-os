-- Rollback for 20261110190000_wa_meta_inbox.sql. First set GOGO_WA_META_INBOX=drain and wait until
--   select count(*) from public.wa_meta_inbox where status in ('pending','processing');
-- returns 0 (the cron keeps handing messages over), then unset it. Anything still waiting when this runs is lost.
-- While draining, a new message goes straight to the pipeline and can be answered before that person's older stored one.
begin;
drop function if exists public.claim_wa_meta_inbox(integer, integer);
drop function if exists public.sweep_wa_meta_inbox();
drop table if exists public.wa_meta_inbox;
commit;
