-- Rollback for 20261110170000_gogo_events_v2.sql. No event data is removed.
-- It leaves the v2 gogo_event_rsvp in place (it is a strict improvement and works without the other v2 objects).
-- Share-link answers stop working until v2 is applied again, because gogo_event_join_rsvp is removed.
begin;
drop function if exists public.gogo_event_join_rsvp(text, text, text, text, integer, text, text);
drop function if exists public.gogo_event_rate_hit(text, integer, integer);
drop table if exists public.gogo_event_rate;
drop index if exists public.gogo_event_guests_phone_once;
create unique index if not exists gogo_event_guests_phone_once on public.gogo_event_guests (event_id, phone) where phone is not null;
alter table public.gogo_events drop column if exists pending_action;
-- share_nonce is kept: dropping it would bring back share links that were switched off or replaced.
commit;
