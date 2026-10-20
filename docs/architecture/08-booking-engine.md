# 08 · Booking engine

Approved mock (20 Oct 2026, "AskGogo Booking Engine" design board): one engine for every online booking — restaurant tables, movies, events — that searches the person's connected booking apps, picks the best option, books only after their yes, and records the booking.

## 1. PRD — what and why

- **Problem.** "Book a table at District 6" ended with "couldn't read the live tables" after 3 minutes. District, Zomato, Swiggy Dineout, EazyDiner and BookMyShow only show or book for a signed-in account (phone + one-time code), and the dashboard waited in the chat.
- **Goal.** Search every connected app, show the best option with price and offers, book on one yes, save it to My bookings with a reminder.
- **Non-negotiables.** The person approves every booking and every payment. The person signs in and types codes themselves; Gogo never bypasses a sign-in, never solves CAPTCHAs, never exports cookies and never handles card numbers. "Booked" only after the provider confirms. No blind retry of a submit (unknown outcome stays unknown).
- **Success.** A table request either shows bookable options or asks to connect the app — in under a minute — and never claims a booking without a provider confirmation.

## 2. TRD — how

- **Reuse, don't rebuild.** Per-user Vercel Sandbox + per-host Browserbase context (`lib/agent/managed-browser.ts`), sign-in hand-off (`lib/dashboard/site-sessions.ts` `startSiteSignIn`), `vault_sessions` connection records, approval binding (`approval-binding.ts`), booking worker (`restaurant-reservation-worker.ts`), life events (`life-event-engine.ts`).
- **New module.** `lib/agent/booking-engine.ts`: which booking apps need sign-in, whether the person connected them, the connect-once reply, the confirmation reference parser.
- **Connect first.** Before any browser time on a signed-in app, check `listSiteConnections`; not connected → connect-once reply (no browser run). A sign-in wall during a read → the same reply (the saved sign-in ended).
- **Background on every surface.** The dashboard queues reservation research like WhatsApp (`queueRestaurantReservationResearch`); the cron delivers the result.
- **Record.** On a verified provider confirmation the worker writes `start_at`, `end_at`, `confirmation_ref` on the same life event and a 2-hour reminder, so My bookings and reminders pick it up.

## 3. App flow

1. Request → parse (venue, party, date, time).
2. Venue's booking apps found (first-party / ReserveGo feed first; aggregators next).
3. For each signed-in app: connected? → read live slots and offers; not connected → connect-once card.
4. Compare → best pick (time match, discount, fees) + alternatives.
5. Person says yes → approval bound to the exact slot → worker books once → provider confirmation → record + reminder.
6. Online blocked everywhere → offer a call (needs a separate yes; voice provider not chosen yet).

## 4. UI/UX brief

Matches the approved board: compare card with a "Best" tag; connect-once card that says the person types the code; confirmation card with booking ID, "Saved to My bookings", reminder; movie card with payment-needs-your-yes; Settings › Booking accounts with connect/disconnect and the four rules; call-plan card with script preview. WhatsApp text first; the dashboard renders the same text.

## 5. Backend schema

No migration. Uses existing tables: `vault_sessions` (connections), `agent_runs` / `agent_approvals` (research, approval, execution), `life_events` (`event_type` reservation/event, `start_at`, `end_at`, `confirmation_ref`, `source_refs`), `life_event_actions`, `reminders`.

## 6. Implementation plan

- **P1 (this change).** Booking-engine module; connect-first before browser reads; sign-in wall → connect reply; dashboard queues in background; confirmed bookings recorded with start time, reference and reminder.
- **P2.** Verify a connection after "I'm signed in" with a read of the site instead of trusting the tap; add District/EazyDiner/BookMyShow to the vault provider list where needed.
- **P3.** Multi-app compare for tables (District, Dineout, EazyDiner, venue site) with offers; best-pick card.
- **P4.** Movies: District vs BookMyShow compare, seat hold, payment hand-off to the person; ticket/QR capture via the existing booking-closure path.
- **P5.** Settings › Booking accounts grouping and rules.
- **P6.** Call fallback once the voice provider is chosen.
