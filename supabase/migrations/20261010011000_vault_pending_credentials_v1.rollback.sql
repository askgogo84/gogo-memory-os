-- Rollback for 20261010011000_vault_pending_credentials_v1.sql.
-- Run only when no pending sign-up credential is still needed for recovery.
drop table if exists public.vault_pending_credentials;
