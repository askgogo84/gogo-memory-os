-- Rollback for 20261110090000_email_alias_forwarding_verified_address.sql. The app tolerates the column being absent
-- (forwarding is then always shown as not confirmed).
alter table public.email_aliases drop column if exists forwarding_verified_address;
