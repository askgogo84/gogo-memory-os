-- Rollback for 20261106160000_gmail_accounts.sql. Drops only the extra-accounts table; public.users is untouched.
drop table if exists public.gmail_accounts;
