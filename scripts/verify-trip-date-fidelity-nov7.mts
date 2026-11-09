// Inert original-module regression: no booking, Gmail, Supabase, browser or flight-provider calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { tripAsk, tripFlightQuery, formatTripPlan } = await import('../lib/agent/trip-plan')
const now = new Date('2026-11-07T00:00:00+05:30')

// Explicit future years must never silently become the nearest earlier calendar year.
const future = tripAsk('plan a Goa trip 12 to 15 Dec 2027 with Divya and Nithin', now)
assert.ok(future)
assert.deepEqual([future.start, future.end, future.nights], ['2027-12-12', '2027-12-15', 3])
assert.deepEqual(future.companions, ['Divya', 'Nithin'])
assert.equal(tripAsk('plan a Goa trip Dec 12 to 15 2027', now)?.start, '2027-12-12')

// A supplied past year is not rewritten as a future one, and invalid calendar days do not normalize.
assert.equal(tripAsk('plan a Goa trip 12 to 15 Dec 2025', now)?.start, '2025-12-12')
assert.equal(tripAsk('plan a Goa trip 28 to 31 Feb 2027', now), null)
assert.equal(tripAsk('plan a Goa trip 28 to 29 Feb 2028', now)?.end, '2028-02-29')

// Yearless dates still take the next occurrence; a yearless Dec-to-Jan range spans years.
const january = tripAsk('plan a Goa trip 5 to 7 Jan with Divya', now)
assert.ok(january)
assert.equal(january.start, '2027-01-05')
assert.equal(january.end, '2027-01-07')
const winter = tripAsk('plan a Goa trip 30 Dec to 2 Jan', now)
assert.ok(winter)
assert.deepEqual([winter.start, winter.end, winter.nights], ['2026-12-30', '2027-01-02', 3])
assert.equal(tripAsk('plan a Goa trip 12 to 15 Dec', now)?.start, '2026-12-12')

// Both the background research request and user-copyable flight action must preserve the resolved years.
assert.equal(tripFlightQuery(january), 'flights Bengaluru to Goa 5 Jan 2027 back 7 Jan 2027')
assert.equal(tripFlightQuery(future), 'flights Bengaluru to Goa 12 Dec 2027 back 15 Dec 2027')
assert.match(formatTripPlan(january, { flights: null, stays: null }), /Say "flights Bengaluru to Goa 5 Jan 2027 back 7 Jan 2027"/)
const originalModule = readFileSync('lib/agent/trip-plan.ts', 'utf8')
assert.match(originalModule, /const flightText = tripFlightQuery\(ask\)/)
assert.match(originalModule, /tryRunTravelResearch\(\{ actor, surface: surface as any, text: flightText \}\)/)
console.log('PASS: explicit trip year, inferred year, valid dates and complete background flight query (synthetic)')
