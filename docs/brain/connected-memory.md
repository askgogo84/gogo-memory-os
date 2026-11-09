# Connected memory (29 Oct 2026)

Every booking lives in `life_events` (tickets are promoted by the database trigger; hotel stays and cabs are written by
`lib/memory`). `lib/memory/life-graph.ts` links them into trips: same destination city plus overlapping dates (±1 day),
and a flight or train leaving that city within 21 days is the way home. No new table or migration.

| Piece | File | What it does |
|---|---|---|
| Trip linking | `lib/memory/life-graph.ts` | `loadTrips`, `linkTrips`, `tripLines` (context lines) |
| Hotel stays | `lib/memory/stay.ts` | detect → read (Haiku, JSON) → save/merge (`stay:<hotel>:<city>`) → reminders → reply |
| Front door | `lib/memory/front-door.ts` | runs before the brain: hotel forwards, date answers to Gogo's stay question, cab details |
| Context | `lib/agent/brain.ts`, `lib/bot/process-message.ts` | the brain and the chat model see "Trips (linked bookings)" |
| Screenshots | `app/api/webhooks/whatsapp/route.ts` (`handleImageMeeting`) | a hotel screenshot becomes a stay, not a loose note |

Rules: the date an email was sent is never a stay date; a guest added to someone else's booking is a guest, never
"you added me"; reminders only from stated dates; nothing is booked, sent or paid.

Kill switch: `GOGO_MEMORY=off`. Canary: same as the brain (`GOGO_BRAIN_USERS`, or production).
Logs: `STAY_SAVED`, `STAY_EXTRACT_FAILED`, `STAY_SAVE_FAILED`, `CAB_SAVE_FAILED`, `LIFE_GRAPH_READ_FAILED`, `LIFE_GRAPH_TURN_FAILED`.
Test: `scripts/verify-life-graph-oct29.mts`.
