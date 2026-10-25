-- Rollback for 20261023120000_invite_links.sql
drop function if exists public.redeem_invite(text, text, text);
drop table if exists public.invite_redemptions;
drop table if exists public.invite_codes;
