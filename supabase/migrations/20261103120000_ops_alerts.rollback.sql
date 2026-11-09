-- Rollback for 20261103120000_ops_alerts.sql. Removes the alerts table and its history; nothing else depends on it.
-- The app keeps working without it: the ops-alerts job reports the table missing and sends nothing.
drop table if exists public.ops_alerts;
