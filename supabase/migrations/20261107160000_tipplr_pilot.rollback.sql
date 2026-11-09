-- Rollback for 20261107160000_tipplr_pilot.sql: reverse order, nothing outside these tables is touched.
drop table if exists public.merchant_schedules;
drop table if exists public.merchant_order_events;
drop table if exists public.merchant_orders;
drop table if exists public.merchant_items;
drop table if exists public.merchant_outlets;
