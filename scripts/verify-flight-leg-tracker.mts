import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// The three things Instinct does on a trip, as AskGogo now does them:
//  1. memory: the passenger is the person the user knows ("Divya" for "URS, Divyashree");
//  2. tracking: each flight is followed live, take-off to landing, from a real source;
//  3. events: trip monitors' findings read as travel alerts naming the trip and person.
// Run: npx tsx scripts/verify-flight-leg-tracker.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'

const T = await import('../lib/agent/flight-leg-tracker')
const { aliasFromTexts } = await import('../lib/services/travel-tickets')
const { travelWatchAlertMessage } = await import('../lib/agent/contextual-travel-watchers')
const { verifyContextualDisruption } = await import('../lib/agent/watcher-quality')

// ── 1. Memory ────────────────────────────────────────────────────────────────────────────
assert.equal(aliasFromTexts('Divyashree', ['Divya is flying back from New York on Monday', 'remind me to pick up Divya', 'Divyashree passport copy']), 'Divya')
assert.equal(aliasFromTexts('Divyashree', ['Divya went out', 'Divy came over']), null, 'a tie is not guessed')
assert.equal(aliasFromTexts('Divyashree', ['Divyashree flies Monday']), null, 'the full name is not an alias')
assert.equal(aliasFromTexts('Rahul', ['Ravi called']), null)
const brain = readFileSync(new URL('../lib/agent/context-brain.ts', import.meta.url), 'utf8')
assert.match(brain, /the user calls them/, 'recall facts carry the name the user uses')

// ── 2. Tracking ──────────────────────────────────────────────────────────────────────────
assert.equal(T.normalizeFlightNo('KL0642'), 'KL642')
assert.equal(T.normalizeFlightNo('6E 5237'), '6E5237')
assert.equal(T.normalizeFlightNo('EY1'), 'EY1')
assert.equal(T.normalizeFlightNo('AI 0101'), 'AI101')

const leg = { id: 't1', telegramId: '1', flightNo: 'KL0642', airline: 'KLM', fromCity: 'New York', toCity: 'Amsterdam',
  departAt: '2026-10-12T20:40:00.000Z', arriveAt: '2026-10-13T04:00:00.000Z', alias: 'Divya', tracking: {} as any }
const at = (iso: string) => Date.parse(iso)
assert.equal(T.dueForCheck(at('2026-10-12T17:00:00Z'), leg), false, 'not before 3h out')
assert.equal(T.dueForCheck(at('2026-10-12T18:00:00Z'), leg), true)
assert.equal(T.dueForCheck(at('2026-10-12T18:10:00Z'), { ...leg, tracking: { lastCheckedAt: '2026-10-12T18:00:00Z' } }), false, '30 min away from take-off: every 30 min')
assert.equal(T.dueForCheck(at('2026-10-12T20:30:00Z'), { ...leg, tracking: { lastCheckedAt: '2026-10-12T20:15:00Z' } }), true, 'near take-off: every 15 min')
assert.equal(T.dueForCheck(at('2026-10-13T04:30:00Z'), { ...leg, tracking: { state: 'landed' } }), false, 'stops after landing')
assert.equal(T.dueForCheck(at('2026-10-13T06:30:00Z'), leg), false, 'window closes 2h after arrival')

// Flight-data API (AeroDataBox shape): nearest occurrence, delay, gate.
const adb = (status: string, extra: any = {}) => [
  { number: 'KL 642', status: 'Arrived', departure: { scheduledTime: { utc: '2026-10-11 20:40Z' } }, arrival: {} }, // yesterday's
  { number: 'KL 642', status, departure: { scheduledTime: { utc: '2026-10-12 20:40Z' }, revisedTime: { utc: extra.rev || '2026-10-12 20:40Z' }, gate: 'B31', terminal: '4' },
    arrival: { revisedTime: { utc: '2026-10-13 04:05Z' }, runwayTime: extra.landed ? { utc: '2026-10-13 03:58Z' } : undefined, baggageBelt: extra.landed ? '12' : undefined } },
]
const sched = T.parseFlightData(adb('Expected'), leg.departAt)!
assert.equal(sched.state, 'scheduled', "yesterday's arrived occurrence is ignored")
assert.equal(sched.depGate, 'B31')
const late = T.parseFlightData(adb('Delayed', { rev: '2026-10-12 21:25Z' }), leg.departAt)!
assert.equal(late.state, 'delayed'); assert.equal(late.delayMinutes, 45)
assert.equal(T.parseFlightData(adb('EnRoute'), leg.departAt)!.state, 'departed')
const landed = T.parseFlightData(adb('Arrived', { landed: true }), leg.departAt)!
assert.equal(landed.state, 'landed')

// Messages and transitions.
const ev1 = T.legEvents(leg, sched)
assert.deepEqual(ev1.map(e => e.kind), ['gate'])
assert.match(ev1[0].text, /Divya's flight KL0642 \(New York → Amsterdam\) boards from gate B31, terminal 4/)
const ev2 = T.legEvents({ ...leg, tracking: { sent: ['gate-B31'], gateNotified: 'B31' } }, late)
assert.deepEqual(ev2.map(e => e.kind), ['delayed'])
assert.match(ev2[0].text, /delayed by about 45 min, now leaving at 17:25 local time/)
assert.equal(T.legEvents({ ...leg, tracking: { sent: ['gate-B31', 'delayed-45'], gateNotified: 'B31', delayNotified: 45 } }, { ...late, delayMinutes: 50 }).length, 0, 'a delay is re-sent only if 15+ min worse')
const up = T.legEvents({ ...leg, tracking: { sent: ['gate-B31'] } }, T.parseFlightData(adb('EnRoute'), leg.departAt)!)
assert.match(up[0].text, /🛫 Divya's flight KL0642 \(New York → Amsterdam\) has taken off\. Expected in Amsterdam at 06:05 local time\./)
const down = T.legEvents({ ...leg, tracking: { sent: ['gate-B31', 'departed'] } }, landed)
assert.match(down[0].text, /🛬 Divya's flight KL0642 has landed in Amsterdam at 05:58 local time\. Arrival: bags on belt 12\./)
assert.equal(T.legEvents({ ...leg, tracking: { sent: ['landed'] } }, landed).length, 0, 'landing is sent once')

// Web fallback: only dated results for this flight, and only states possible at that time.
const r = (title: string, snippet: string, url = 'https://www.flightera.net/en/flight/KL642') => ({ title, snippet, url })
assert.equal(T.statusFromWeb([r('KL642 KLM', 'KL642 landed at 05:58')], leg, at('2026-10-13T04:10:00Z')), null, 'undated results are ignored')
assert.equal(T.statusFromWeb([r('KL642 12 Oct 2026', 'KL642 New York to Amsterdam landed')], leg, at('2026-10-12T19:00:00Z')), null, 'cannot have landed before it takes off')
assert.equal(T.statusFromWeb([r('KL642 12 Oct 2026', 'KL642 landed in Amsterdam')], leg, at('2026-10-13T04:10:00Z'))?.state, 'landed')
assert.equal(T.statusFromWeb([r('KL642 11 Oct 2026', 'KL642 landed')], leg, at('2026-10-13T04:10:00Z')), null, "another day's flight is ignored")
assert.equal(T.statusFromWeb([r('KL642 12 Oct 2026', 'KL642 has not departed yet, no delay')], leg, at('2026-10-12T20:00:00Z')), null, 'negations are not states')
assert.equal(T.statusFromWeb([r('KL642 12 Oct 2026', 'KL642 cancelled')], leg, at('2026-10-12T19:00:00Z'))?.state, 'cancelled')
assert.equal(T.statusFromWeb([r('KL642 12 Oct 2026 cheap flights', 'KL642 from $520', 'https://www.skyscanner.com/x')], leg, at('2026-10-12T19:00:00Z')), null, 'shopping pages never count')

// The trip monitor now matches trackers that drop the leading zero.
assert.equal(verifyContextualDisruption({ contextClass: 'flight_status', query: 'KL642 flight status', resultTitle: 'KL642 delayed 12 October 2026', flightLegs: ['KL642 @ 12 October 2026'] }).verified, true)

// ── 3. Events: travel copy, not shopping copy ───────────────────────────────────────────
const msg = travelWatchAlertMessage({ contextClass: 'destination_weather', title: 'Trip weather · Bengaluru', traveller: 'Divya' }, { title: 'Heavy rain warning for Bengaluru on 13 October', snippet: 'IMD issues orange alert', url: 'https://example.com/w' })
assert.match(msg, /^🌦️ Weather alert for Divya's trip: Bengaluru/)
assert.doesNotMatch(msg, /Price, stock|offer eligibility/)
const watchers = readFileSync(new URL('../lib/agent/watchers.ts', import.meta.url), 'utf8')
assert.match(watchers, /contextualKind === 'travel' \? travelWatchAlertMessage\(condition, candidate\.result\)/)
const cron = readFileSync(new URL('../app/api/cron/agent-watchers/route.ts', import.meta.url), 'utf8')
assert.match(cron, /runFlightLegTracker\(\)/, 'the tracker runs every 15 minutes with the watchers')
const tracker = readFileSync(new URL('../lib/agent/flight-leg-tracker.ts', import.meta.url), 'utf8')
assert.match(tracker, /condition_json->>contextClass', 'flight_status'\)/, 'tracking follows the trip monitor (plan limits and stop apply)')

console.log('Flight leg tracker: traveller known by name, each flight followed from 3h before take-off to landing (data API or dated tracker pages), alerts on gate, delay, take-off, landing; trip alerts read as travel news')
