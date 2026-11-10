-- Rollback for 20261110170000_gogo_events_v2.sql. Restores the first migration's objects; no event data is removed.
-- After this, re-run the function definitions from 20261110150000_gogo_events.sql (gogo_event_rsvp, gogo_event_join)
-- to return to the first version's behaviour.
begin;
drop function if exists public.gogo_event_join_rsvp(text, text, text, text, integer, text, text);
drop function if exists public.gogo_event_rate_hit(text, integer, integer);
drop table if exists public.gogo_event_rate;
drop index if exists public.gogo_event_guests_phone_once;
create unique index if not exists gogo_event_guests_phone_once on public.gogo_event_guests (event_id, phone) where phone is not null;
alter table public.gogo_events drop column if exists share_nonce;
commit;
