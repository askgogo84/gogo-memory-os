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
const tracker = readFileSync(new URL('../lib/agent/flight-leg-tracker.ts', import.meta.url), 'utf8')
assert.match(tracker, /scheduledArrival: adbTime\(best\.arrival\?\.scheduledTime\)/)
const claude = readFileSync(new URL('../lib/services/claude.ts', import.meta.url), 'utf8')
assert.match(claude, /ANSWER ONLY THE LATEST MESSAGE/)
assert.match(tracker, /etaArrival: status\?\.revisedArrival \|\| prev\.etaArrival, actualArrival: status\?\.actualArrival \|\| prev\.actualArrival/)
console.log('Flights: the tracker keeps the live arrival estimate and the answer uses it, labelled as an estimate')
