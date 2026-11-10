-- Rollback for 20261110190000_wa_meta_inbox.sql. Unset GOGO_WA_META_INBOX first; any message still waiting is lost.
begin;
drop function if exists public.claim_wa_meta_inbox(integer, integer);
drop table if exists public.wa_meta_inbox;
commit;
