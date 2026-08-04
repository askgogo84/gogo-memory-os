-- travel_tickets: structured, per-leg store for parsed flight/train/event tickets.
-- One row per leg (round-trips = multiple rows sharing booking_group). Powers the
-- morning-brief "Today's flight" section and T-3h / T-24h reminders.
-- Apply in Supabase project qenhjcooyecmatwducpu BEFORE deploying the code.

create table if not exists travel_tickets (
  id             uuid primary key default gen_random_uuid(),
  telegram_id    bigint not null,
  whatsapp_to    text,                        -- delivery target for reminders/brief
  type           text not null check (type in ('flight','train','event')),
  booking_group  text,                        -- groups multi-leg round-trips (pnr or generated)
  leg_index      int  not null default 0,     -- 0 = outbound, 1 = return, ...
  from_city      text,
  to_city        text,
  depart_at      timestamptz not null,        -- UTC instant (computed from date+time+tz)
  arrive_at      timestamptz,
  depart_tz      text not null default 'Asia/Kolkata',
  date_label     text,                        -- original "24 Jul 2026" for display
  depart_local   text,                        -- original "10:15" wall-clock for display
  airline        text,
  flight_no      text,
  train_no       text,
  train_name     text,
  event_name     text,
  venue          text,
  pnr            text,
  seat           text,
  passengers     text[],
  source         text not null check (source in ('pdf','image','text')),
  raw            jsonb,                        -- full parsed leg, no truncation
  created_at     timestamptz not null default now()
);

create index if not exists travel_tickets_tid_depart_idx
  on travel_tickets (telegram_id, depart_at);

-- Idempotency backstop: re-forwarding the same ticket shouldn't duplicate legs.
-- (The app also does an explicit existence check before insert.)
create unique index if not exists travel_tickets_dedupe_idx
  on travel_tickets (telegram_id, type, coalesce(pnr,''), coalesce(flight_no,''), depart_at);
