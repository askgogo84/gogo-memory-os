# Result cards — TRD

## Phase 1 (WhatsApp flight card)
- `lib/agent/flight-card.ts` (pure): `flightCardModel(output)` turns a completed travel step's `output_json` (`inventoryType: 'browser-verified'`, `context`, `flights`) into `{route, when, party, rows[≤5], pick}` using the same order as the text list (`oneWayDisplayOrder` rules: cheapest first, cheapest non-stop kept). Returns null for round trips, unverified fares or anything malformed.
- `app/api/cards/flights/[runId]/route.ts`: `ImageResponse` PNG, 1080 px wide, light theme. Auth: `?o=<owner>&t=<token>` checked with `verifyCardToken('flights.<runId>', owner, t)`; reads the run's steps with the service role filtered by `run_id` and `telegram_id`. 404 on any failure. The ₹ glyph comes from a Google Fonts subset fetched with `text=`; if that fails the card prints "Rs".
- `lib/agent/travel-research-worker.ts`: for WhatsApp delivery of a completed flight run with a card model, send the card image first (best effort, short caption), then the text. A card failure is logged and never blocks or duplicates the text.
- Text stays the full result (all rows, verdict, link), so a card that fails to load in WhatsApp loses nothing.

## Phase 2 (dashboard page)
- `app/r/[id]` page reading the same model; components follow Open Intelligent UI (MIT) patterns; no model-generated UI.

## Security
- Signed link bound to card kind + run id + owner, 7-day expiry (existing `card-link`).
- No personal data on the card: route, date, party size, airline, times, fares only.
