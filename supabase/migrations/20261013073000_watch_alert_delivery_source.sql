-- 13 Oct: every Background Gogo watch alert (trip flight status, weather, disruption, price/stock
-- watches, live flight tracking) was sent with source 'followup'. begin_notification_delivery
-- treats 'followup' as a scheduled followups row and cancels the delivery when none matches, so
-- these alerts were cancelled before sending. Give them their own source.
begin;
set local lock_timeout = '5s';
alter table public.notification_deliveries drop constraint if exists notification_deliveries_source_check;
alter table public.notification_deliveries add constraint notification_deliveries_source_check
  check(source in ('briefing','followup','price_comparison','travel_research','watch_alert'));
commit;
