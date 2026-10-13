import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 18:31 "When does Divya land?": the ticket had no arrival time, the tracker knew the live estimate but never kept it.
// Run: npx tsx scripts/verify-flight-live-arrival.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
const {buildTravelPresenceFacts} = await import('../lib/agent/context-brain')
const now = Date.parse('2026-10-13T13:00:00Z')
const row = (live: any) => ({id: 't1', type: 'flight', from_city: 'Amsterdam', to_city: 'Bengaluru', airline: 'KLM', flight_no: 'KL879', pnr: 'GGQM5Q',
  passengers: ['Divyashree'], depart_at: '2026-10-13T08:05:00Z', arrive_at: null, raw: {timeNormalizationVersion: 2, ...(live ? {liveTracking: live} : {})}})
const without = buildTravelPresenceFacts([row(null)], now, 60, 'when does Divya land')
assert.ok(without.length && !/ESTIMATE|LANDED/.test(without[0].summary), 'no live data: nothing invented')
const eta = buildTravelPresenceFacts([row({etaArrival: '2026-10-13T17:40:00Z', lastCheckedAt: '2026-10-13T12:50:00Z', state: 'departed'})], now, 60, 'when does Divya land')
assert.match(eta[0].summary, /live arrival ESTIMATE \(not on the ticket\): 13 Oct 2026, 23:10 \(Asia\/Kolkata\)/)
assert.match(eta[0].summary, /feed last checked 13 Oct 2026, 18:20 IST/)
assert.match(eta[0].summary, /answer a landing-time question from this estimate/)
const landed = buildTravelPresenceFacts([row({etaArrival: '2026-10-13T17:40:00Z', actualArrival: '2026-10-13T17:31:00Z', state: 'landed'})], now, 60, 'when does Divya land')
assert.match(landed[0].summary, /LANDED at 13 Oct 2026, 23:01/)
const sched = buildTravelPresenceFacts([row({scheduledArrival: '2026-10-13T17:30:00Z', lastCheckedAt: '2026-10-13T13:30:00Z', state: 'departed'})], now, 60, 'when does Divya land')
assert.match(sched[0].summary, /SCHEDULED arrival \(the airline timetable, not on the ticket; no live estimate yet\): 13 Oct 2026, 23:00 \(Asia\/Kolkata\)/)
assert.ok(!/ESTIMATE/.test(sched[0].summary), 'a timetable time is not called a live estimate')
const junk = buildTravelPresenceFacts([row({etaArrival: 'soon'})], now, 60, 'when does Divya land')
assert.ok(!/ESTIMATE/.test(junk[0].summary), 'an unparseable estimate is ignored')
// Two-leg trip: after she boarded the connection, "when does she land" is about that leg, not the first.
const leg1 = {id: 't0', type: 'flight', from_city: 'New York', to_city: 'Amsterdam', airline: 'KLM', flight_no: 'KL642', booking_group: 'g1',
  passengers: ['Divyashree'], depart_at: '2026-10-12T21:00:00Z', arrive_at: '2026-10-13T04:00:00Z', raw: {timeNormalizationVersion: 2}}
const leg2 = {...row({etaArrival: '2026-10-13T17:40:00Z', state: 'departed'}), booking_group: 'g1'}
const trip = buildTravelPresenceFacts([leg1, leg2], now, 60, 'when does Divya land')
const f1 = trip.find((f: any) => f.id === 'travel-ticket:t0')!, f2 = trip.find((f: any) => f.id === 'travel-ticket:t1')!
assert.match(f1.summary, /this leg is finished\. The traveller has since departed on KL879 Amsterdam → Bengaluru/, 'the earlier leg points at the later one')
assert.match(f1.summary, /NOT this one/)
assert.ok(!/IN THE AIR NOW/.test(f1.summary))
assert.match(f2.summary, /IN THE AIR NOW on this leg/, 'the current leg is marked as the one she is on')
assert.match(f2.summary, /live arrival ESTIMATE/)
const notYet = buildTravelPresenceFacts([leg1, {...leg2, depart_at: '2026-10-13T20:00:00Z'}], now, 60, 'when does Divya land')
assert.ok(!/this leg is finished/.test(notYet.find((f: any) => f.id === 'travel-ticket:t0')!.summary), 'a connection not yet taken does not close the first leg')
const tracker = readFileSync(new URL('../lib/agent/flight-leg-tracker.ts', import.meta.url), 'utf8')
assert.match(tracker, /scheduledArrival: adbTime\(best\.arrival\?\.scheduledTime\)/)
const claude = readFileSync(new URL('../lib/services/claude.ts', import.meta.url), 'utf8')
assert.match(claude, /ANSWER ONLY THE LATEST MESSAGE/)
assert.match(tracker, /etaArrival: status\?\.revisedArrival \|\| prev\.etaArrival, actualArrival: status\?\.actualArrival \|\| prev\.actualArrival/)
console.log('Flights: the tracker keeps the live arrival estimate and the answer uses it, labelled as an estimate')
