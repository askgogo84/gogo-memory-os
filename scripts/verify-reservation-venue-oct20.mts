// 20 Oct live: "Book a table for 2 Saturday 8pm at District 6 near Orion mall" asked "Which restaurant?".
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const { parseRestaurantReservationIntent: p } = await import('../lib/agent/restaurant-reservation.ts')
const cases: Array<[string, string]> = [
  ['Book a table for 2 Saturday 8pm at District 6 near Orion mall', 'District 6'],
  ['Reserve a table for 2 tonight at 9 pm at Toit', 'Toit'],
  ['book a table for 2 on Friday at the Leela Palace', 'Leela Palace'],
  ['Book a table for 2 at Toit Indiranagar tomorrow at 7pm', 'Toit Indiranagar'],
  ['Book a table for 4 tomorrow at 8pm', ''], // no venue: still asks
]
for (const [t, want] of cases) assert.equal(p(t)?.restaurant ?? '', want, t)
const d6 = p(cases[0][0])!
assert.equal(d6.partySize, 2); assert.equal(d6.preferredStart, '20:00')
console.log('RESERVATION_VENUE_OK')
