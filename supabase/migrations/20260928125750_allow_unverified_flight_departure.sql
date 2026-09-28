-- Retain flight identity when a printed local clock cannot be verified.
-- Existing rows and access policies are unchanged. Apply before deploying the writer.
alter table public.travel_tickets alter column depart_at drop not null;
alter table public.travel_tickets add constraint travel_ticket_departure_known_unless_flight
  check (depart_at is not null or type = 'flight');
