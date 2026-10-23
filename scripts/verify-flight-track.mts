// "Track Virgin Atlantic VS 354" (23 Oct live): live status from the flight-data feed + a watch until landing.
// Run: npx tsx scripts/verify-flight-track.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
process.env.OPENAI_API_KEY ||= 'test-key'
process.env.ANTHROPIC_API_KEY ||= 'test-key'
const t = await import('../lib/agent/flight-track')
const fs = await import('../lib/bot/handlers/flight-status')

assert.equal(t.icaoFlightCode('VS 354'), 'VIR354'); assert.equal(t.icaoFlightCode('6E0201'), 'IGO201'); assert.equal(t.icaoFlightCode('ZZ1'), null)
assert.equal(t.isFlightTrackRequest('Track Virgin Atlantic VS 354'), true)
assert.equal(t.isFlightTrackRequest('Keep me posted on EK 501'), true)
assert.equal(t.isFlightTrackRequest('Stop tracking VS 354'), false)
assert.equal(t.isFlightTrackRequest('Did VS 354 land?'), false, 'a status question stays a one-off answer')
assert.equal(t.trackCode('Track Virgin Atlantic VS 354'), 'VS354')
assert.match(fs.buildFlightStatusQuery('Track Virgin Atlantic VS 354', '2026-10-23'), /^VS354 VIR354 flight status/)

const occ = (dep: string, arr: string, status = 'Expected', extra: any = {}) => ({
  number: 'VS 354', status, airline: { name: 'Virgin Atlantic' },
  departure: { airport: { iata: 'LHR', municipalityName: 'London' }, scheduledTime: { utc: dep, local: dep.replace('Z', '+00:00') }, terminal: '3', gate: '12', ...(extra.dep || {}) },
  arrival: { airport: { iata: 'BOM', municipalityName: 'Mumbai' }, scheduledTime: { utc: arr, local: arr.replace('Z', '+00:00') } },
})
const now = new Date('2026-10-23T10:00:00Z')
const fixture: Record<string, any[]> = {
  '2026-10-22': [occ('2026-10-22 08:30Z', '2026-10-22 17:30Z', 'Arrived')],
  '2026-10-23': [occ('2026-10-23 08:30Z', '2026-10-23 17:30Z', 'EnRoute', { dep: { revisedTime: { utc: '2026-10-23 08:55Z', local: '2026-10-23 08:55+00:00' } } })],
  '2026-10-24': [occ('2026-10-24 08:30Z', '2026-10-24 17:30Z')],
}
const f = await t.lookupLiveFlight('VS354', now, 'UTC', async (_c, d) => fixture[d] || [])
assert.ok(f, 'found')
assert.equal(f!.depUtc, '2026-10-23T08:30:00.000Z', 'the flight in the air now, not yesterday\'s or tomorrow\'s')
assert.equal(f!.status.state, 'departed')
const text = t.formatLiveFlight(f!)
assert.match(text, /VS354\* · Virgin Atlantic/); assert.match(text, /London \(LHR\) → Mumbai \(BOM\)/); assert.match(text, /Status: \*In the air\*/)
assert.match(text, /Departs 08:55 \(was 08:30\)/, 'times come from the feed, airport-local')
assert.equal(await t.lookupLiveFlight('VS354', now, 'UTC', async () => []), null)
assert.equal(t.pickLiveOccurrence([occ('2026-10-20 08:30Z', '2026-10-20 17:30Z', 'Arrived')], now.getTime()), null, 'a flight that landed days ago is not "now"')

// Structured feed answers first; web search only when it has nothing.
let searched = 0
const live = await fs.answerLiveFlightStatus('Track Virgin Atlantic VS 354', 'Gogo', { live: async () => 'LIVE', search: async () => { searched++; return [] } }, 'Asia/Kolkata')
assert.equal(live, 'LIVE'); assert.equal(searched, 0)
await fs.answerLiveFlightStatus('Track VS 354', 'Gogo', { live: async () => null, search: async () => { searched++; return [] } }, 'Asia/Kolkata')
assert.ok(searched > 0)

const src = readFileSync('lib/agent/flight-track.ts', 'utf8')
assert.match(src, /\.eq\('telegram_id', tg\)\.eq\('active', true\)\s*\.eq\('condition_json->adHocFlight->>flightNo', f\.flightNo\)/, 'one watch per flight occurrence, owner-scoped')
assert.doesNotMatch(src, /from\('travel_tickets'\)\.(?:insert|upsert)/, 'a tracked flight is never saved as the owner\'s trip')
assert.ok(src.includes("message: e.text, topic: 'travel' })"), 'alerts go through deliverWatchAlert (owner alert settings)')
assert.match(readFileSync('lib/agent/watchers.ts', 'utf8'), /watcher\.condition_json\?\.adHocFlight\s*\?\s*await import\('\.\/flight-track'\)/)
assert.match(readFileSync('lib/bot/process-message.ts', 'utf8'), /trackAsk\.createFlightTrackWatch\(resolvedUser\.telegramId, live\)/)
console.log('Flight tracking: live feed status, one watch per flight until landing, ICAO search fallback')

// Follow-up "Alert me once it lands" binds to the flight just discussed; never a reminder.
assert.equal(t.isFlightFollowUp('Alert me once it lands'), true)
assert.equal(t.isFlightFollowUp('Notify me when it takes off'), true)
assert.equal(t.isFlightFollowUp('track it'), true)
assert.equal(t.isFlightFollowUp('Alert me once VS 354 lands'), false, 'a named flight is a track request, not a follow-up')
assert.equal(t.isFlightFollowUp('Remind me to call Divya at 5'), false)
const nowMs = Date.parse('2026-10-23T03:10:00Z')
assert.equal(t.flightCodeFromHistory([
  { content: 'Virgin Atlantic VS354 Status: scheduled…', created_at: '2026-10-23T03:08:00Z' },
  { content: 'Track Virgin Atlantic VS 354', created_at: '2026-10-23T03:08:00Z' },
], nowMs), 'VS354')
assert.equal(t.flightCodeFromHistory([{ content: 'Track EK 501', created_at: '2026-10-22T10:00:00Z' }], nowMs), '', 'an old flight (over 6 h) is not "it"')
const pm = readFileSync('lib/bot/process-message.ts', 'utf8')
assert.ok(pm.indexOf("handledBy: 'flight-track-follow-up'") > 0 && pm.indexOf("handledBy: 'flight-track-follow-up'") < pm.indexOf('const timingProblem='), 'follow-up is checked before reminders and chat')
console.log('Flight follow-up: "alert me once it lands" tracks the flight from context')

// Arrival estimate: landing time > live prediction > revisedTime; a too-early estimate after a late departure is hidden.
const late = { departure: { scheduledTime: { utc: '2026-10-22 18:50Z' }, revisedTime: { utc: '2026-10-22 19:42Z' } },
  arrival: { scheduledTime: { utc: '2026-10-23 04:05Z', local: '2026-10-23 09:35+05:30' }, revisedTime: { utc: '2026-10-23 03:20Z', local: '2026-10-23 08:50+05:30' } } }
assert.equal(t.arrivalEstimateLocal(late), undefined, '08:50 after a 52-min-late departure is not shown (23 Oct live)')
assert.equal(t.arrivalEstimateLocal({ ...late, arrival: { ...late.arrival, predictedTime: { utc: '2026-10-23 04:03Z', local: '2026-10-23 09:33+05:30' } } }), '2026-10-23 09:33+05:30')
assert.equal(t.arrivalEstimateLocal({ ...late, arrival: { ...late.arrival, runwayTime: { utc: '2026-10-23 04:01Z', local: '2026-10-23 09:31+05:30' } } }), '2026-10-23 09:31+05:30')
console.log('Arrival estimate: plausible live prediction only')

// "Alert as soon as it lands": 2-minute checks around the expected landing; the per-minute cron runs both trackers.
const eta = Date.parse('2026-10-23T04:03:00Z'), dep = Date.parse('2026-10-22T19:42:00Z')
assert.equal(t.nextCheckMinutes(eta - 30 * 60_000, dep, { etaArrival: '2026-10-23T04:03:00Z' }), 2)
assert.equal(t.nextCheckMinutes(eta + 60 * 60_000, dep, { etaArrival: '2026-10-23T04:03:00Z' }), 2)
assert.equal(t.nextCheckMinutes(eta - 4 * 3600_000, dep, { etaArrival: '2026-10-23T04:03:00Z' }), 20)
const cron = readFileSync('app/api/cron/autonomous-runs/route.ts', 'utf8')
assert.match(cron, /processDueFlightTracks\(10\)/); assert.match(cron, /runFlightLegTracker\(\)/)
const L = await import('../lib/agent/flight-leg-tracker')
const leg = { departAt: '2026-10-22T19:42:00Z', arriveAt: '2026-10-23T04:05:00Z' }
assert.equal(L.dueForCheck(Date.parse('2026-10-23T04:00:00Z'), { ...leg, tracking: { lastCheckedAt: '2026-10-23T03:57:30Z' } }), true, 'saved legs: 2-minute checks near landing')
console.log('Landing alerts: 2-minute checks near landing on the per-minute cron')

// First check after "Track" never re-announces what the reply already said (23 Oct: "VS354 has taken off" hours late).
const trackSrc = readFileSync('lib/agent/flight-track.ts', 'utf8')
assert.match(trackSrc, /const firstPass = !prev\.lastCheckedAt/)
assert.match(trackSrc, /if \(firstPass && !\['landed', 'cancelled', 'diverted'\]\.includes\(e\.kind\)\)/)
console.log('First pass: only landing/cancellation/diversion are announced')
