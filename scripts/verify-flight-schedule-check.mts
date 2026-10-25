import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct: KL879's pass read as "5 Oct 13:05 → 23:10" (and earlier "05 Oct 09:24"); real: 13 Oct 10:05 → 23:10.
// Run: npx tsx scripts/verify-flight-schedule-check.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
const S = await import('../lib/services/flight-schedule')

const occ = (day: string, depUtc: string) => ({ depLocal: `2026-10-${day} 10:05+02:00`, arrLocal: `2026-10-${day} 23:10+05:30`, depUtc: Date.parse(depUtc) })
const list = [occ('13', '2026-10-13T08:05:00Z'), occ('14', '2026-10-14T08:05:00Z')]
const now = Date.parse('2026-10-13T06:25:00Z') // 11:55 IST, when the pass was forwarded

assert.deepEqual(S.localParts('2026-10-13 10:05+02:00'), { date: '13 Oct 2026', clock: '10:05' })
assert.equal(S.pickOccurrence(list, { departure: '13:05', arrival: '23:10' }, now)?.depLocal, '2026-10-13 10:05+02:00', 'the arrival clock matches; nearest upcoming wins')
assert.equal(S.pickOccurrence(list, { departure: '09:24', arrival: '23:10' }, now)?.depLocal, '2026-10-13 10:05+02:00')
assert.equal(S.pickOccurrence(list, { departure: '07:00', arrival: '08:00' }, now), null, 'nothing matching is left unchanged')
assert.equal(S.pickOccurrence(list, { departure: '10:05' }, Date.parse('2026-10-14T00:00:00Z'))?.depLocal, '2026-10-14 10:05+02:00', 'a departed flight is not picked')
assert.equal(S.occurrencesFrom([{ departure: { scheduledTime: { utc: '2026-10-13 08:05Z', local: '2026-10-13 10:05+02:00' } }, arrival: { scheduledTime: { local: '2026-10-13 23:10+05:30' } } }])[0].depUtc, Date.parse('2026-10-13T08:05:00Z'))

const tickets = readFileSync(new URL('../lib/services/travel-tickets.ts', import.meta.url), 'utf8')
assert.ok(tickets.indexOf('scheduleCheckedLeg(f, departAt') < tickets.indexOf('const legs = buildLegs(info)'), 'legs are checked before they are scheduled')
const src = readFileSync(new URL('../lib/services/flight-schedule.ts', import.meta.url), 'utf8')
assert.match(src, /if \(!process\.env\.AERODATABOX_RAPIDAPI_KEY \|\| !f\.flightNo\) return f/, 'no key, no change')
assert.match(src, /departAt\.getTime\(\) > now - 12 \* 60 \* MIN\) return f/, 'only legs that read as past or undated are checked')

console.log('Flight schedule check: a misread pass date is corrected from the airline schedule by matching the printed clocks; no match or no key leaves it unchanged')
