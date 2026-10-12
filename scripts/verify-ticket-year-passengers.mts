import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 12 Oct regression: a forwarded KLM boarding pass printed "12 Oct" with no year, so the leg had no
// departure instant: no alerts, no tracking, "could not verify the departure date". The second pass,
// forwarded with it, hit the busy-user lease, got a 503 and was lost after Twilio's retries.
// Run: npx tsx scripts/verify-ticket-year-passengers.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'

const { withTicketYear, withTicketYears } = await import('../lib/services/travel-time')
const { buildLegs, displayPassenger, knownPersonFor } = await import('../lib/services/travel-tickets')

const now = Date.parse('2026-10-12T14:30:00Z') // 8:00 pm IST, when the passes were forwarded

// 1. Year inference.
assert.equal(withTicketYear('12 Oct', now), '12 Oct 2026')
assert.equal(withTicketYear('Oct 13', now), '13 Oct 2026')
assert.equal(withTicketYear('2 Jan', now), '2 Jan 2027', 'a month already passed means next year')
assert.equal(withTicketYear('1 Sep', now), '1 Sep 2026', 'a pass forwarded after a recent trip stays in this year')
assert.equal(withTicketYear('12 Oct 2026', now), '12 Oct 2026', 'printed years are untouched')
assert.equal(withTicketYear('5 Jan', Date.parse('2026-12-30T00:00:00Z'), '31 Dec 2026'), '5 Jan 2027', 'arrival rolls into the new year')
assert.equal(withTicketYear('29 Feb', now), '29 Feb 2028', 'leap day only in a leap year')
assert.equal(withTicketYear('Tomorrow', now), 'Tomorrow', 'unknown shapes are left alone')

// 2. The exact legs Claude read tonight (leg 1 from the log; leg 2 from the second pass).
const klm: any = { type: 'flight', passengers: ['URS, Divyashree'], flights: [
  { from: 'New York', to: 'Amsterdam', date: '12 Oct', departure: '16:40', arrival: '06:00', arrivalDate: '13 Oct', airline: 'KLM Royal Dutch Airlines', flightNo: 'KL0642', pnr: 'GGQM5Q', seat: '6K' },
  { from: 'Amsterdam', to: 'Bengaluru', date: '13 Oct', departure: '10:05', arrival: '23:10', airline: 'KLM Royal Dutch Airlines', flightNo: 'KL0879', pnr: 'GGQM5Q', seat: '6K' },
] }
const before = buildLegs(klm)
assert.equal(before[0].departAt, null, 'without a year the leg cannot be dated (the bug)')
const legs = buildLegs(withTicketYears(klm, now))
assert.equal(legs[0].departAt?.toISOString(), '2026-10-12T20:40:00.000Z', 'JFK 16:40 EDT')
assert.equal(legs[0].arriveAt?.toISOString(), '2026-10-13T04:00:00.000Z', 'AMS 06:00 CEST next day')
assert.equal(legs[1].departAt?.toISOString(), '2026-10-13T08:05:00.000Z', 'AMS 10:05 CEST')

// 3. Passenger names as people say them.
assert.equal(displayPassenger('URS, Divyashree'), 'Divyashree Urs')
assert.equal(displayPassenger('URS/DIVYASHREE MS'), 'Divyashree Urs')
assert.equal(displayPassenger('SHARMA/RAHUL MR'), 'Rahul Sharma')
assert.equal(displayPassenger('Goverdhan M D'), 'Goverdhan M D')
assert.equal(knownPersonFor('Divyashree Urs', ['Divya', 'Srini']), 'Divya')
assert.equal(knownPersonFor('Divyashree Urs', ['Divya', 'Divya K']), null, 'ambiguous contacts are not guessed')
assert.equal(knownPersonFor('Rahul Sharma', ['Ra']), null, 'too-short names never match')
assert.equal(knownPersonFor('Divyashree Urs', []), null)

// 4. Wiring: the save path dates legs first and starts tracking; the webhook waits instead of 503.
const tickets = readFileSync(new URL('../lib/services/travel-tickets.ts', import.meta.url), 'utf8')
assert.ok(tickets.indexOf('withTicketYears(info, now)') < tickets.indexOf('const legs = buildLegs(info)'), 'years are filled before legs are built')
assert.match(tickets, /compileTravelWatchersForUser\(ctx\.telegramId\)/)
assert.match(tickets, /if \(t\.tracking\) trackingTail/, 'tracking is claimed only when the monitor is active')
const route = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
const lease = route.slice(route.indexOf('let brainLease = await acquireBrainUserLease'), route.indexOf("return new NextResponse('Busy'"))
assert.match(lease, /Date\.now\(\) - waitStart < 45_000/, 'a busy user makes the next photo wait, not fail')
assert.match(route, /export const maxDuration = 120/)

console.log('Ticket year + passengers: boarding passes without a year are dated, both legs are scheduled, passengers are named as people say them, and a second forwarded photo waits its turn')
