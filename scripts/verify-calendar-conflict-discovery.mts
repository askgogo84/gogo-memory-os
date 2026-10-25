// Proactive calendar conflict discovery (Duet brief, 23 Oct). Run: npx tsx scripts/verify-calendar-conflict-discovery.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findScheduleConflicts } from '../lib/agent/calendar-conflicts'

const now = new Date('2026-10-23T04:00:00Z')
const ev = (id: string, s: string, e: string, extra: any = {}) => ({ id, summary: id, start: { dateTime: s }, end: { dateTime: e }, ...extra })
const events = [
  ev('Call with Divya', '2026-10-23T09:00:00Z', '2026-10-23T10:00:00Z'),
  ev('Tipplr QC', '2026-10-23T09:30:00Z', '2026-10-23T10:30:00Z'),
  ev('Declined sync', '2026-10-23T09:15:00Z', '2026-10-23T09:45:00Z', { attendees: [{ self: true, responseStatus: 'declined' }] }),
  ev('Free block', '2026-10-23T09:00:00Z', '2026-10-23T11:00:00Z', { transparency: 'transparent' }),
  { id: 'All day', summary: 'All day', start: { date: '2026-10-23' }, end: { date: '2026-10-24' } },
  ev('Past', '2026-10-23T01:00:00Z', '2026-10-23T02:00:00Z'),
  ev('Past twin', '2026-10-23T01:30:00Z', '2026-10-23T02:30:00Z'),
  ev('Client call', '2026-10-24T20:00:00Z', '2026-10-24T20:30:00Z'),
]
const tickets = [{ id: 7, flight_no: 'EY 237', from_city: 'BLR', to_city: 'AUH', depart_at: '2026-10-24T22:35:00Z' }]
const c = findScheduleConflicts(events, tickets, now)
assert.deepEqual(c.map(x => x.kind), ['overlap', 'flight'])
assert.equal(c[0].title, 'Call with Divya overlaps Tipplr QC', 'declined, free, all-day and past events never count')
assert.match(c[1].title, /Client call is close to EY 237 · BLR → AUH/)
assert.match(c[1].summary, /2\.6 h before departure/)
assert.deepEqual(findScheduleConflicts(events, tickets, now).map(x => x.key), c.map(x => x.key), 'stable keys dedupe across passes')
assert.deepEqual(findScheduleConflicts([], [], now), [])

const src = readFileSync('lib/agent/open-loops.ts', 'utf8')
const sync = src.slice(src.indexOf('async function syncCalendarConflicts'), src.indexOf('export async function syncOpenLoopsForUser'))
assert.match(sync, /out\.complete!==true\|\|Number\(out\.unknownIntervals\|\|0\)>0/, 'incomplete reads never produce or resolve conflicts')
assert.match(sync, /throw new Error\('skip:calendar_read_incomplete'\)/)
assert.match(sync, /\.eq\('telegram_id',Number\(telegramId\)\)/)
assert.match(sync, /t\.passengers\.some/, 'another traveller\'s flight is not the owner\'s conflict')
assert.doesNotMatch(sync, /insert\(|update\(|sendWhatsApp/, 'discovery only records an open loop; delivery stays with the pulse')
assert.match(src, /const sourceTypes=\['followup','approval','agent_run','life_event_action','calendar_conflict'\] as const[\s\S]*?syncLifeActions\(tg,current\),\n\s*syncCalendarConflicts\(tg,current,gmailOnce\),/, 'source index stays aligned for reconciliation')
assert.match(src, /\.filter\(x=>!x\.startsWith\('skip:'\)\)/)
const feed = readFileSync('lib/dashboard/task-feed.ts', 'utf8')
assert.match(feed, /\.eq\('telegram_id', tg\)\.eq\('status', 'active'\)\s*\.eq\('source_type', 'calendar_conflict'\)/, 'Needs you shows the owner\'s own clashes')
console.log('Calendar conflict discovery: complete reads only, owner flights only, deduped open loops')

// Task results follow the owner's quiet hours (Alerts settings), not a fixed 22–07.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
const { runOutcomeQuietUntil } = await import('../lib/agent/run-outcome-delivery')
const at2230 = new Date('2026-10-23T17:00:00Z') // 22:30 IST
assert.ok(runOutcomeQuietUntil('Asia/Kolkata', at2230), 'default 22–07 is quiet at 22:30')
assert.equal(runOutcomeQuietUntil('Asia/Kolkata', at2230, { quietStart: 23, quietEnd: 6 }), null, 'a 23–06 owner still hears at 22:30')
assert.equal(runOutcomeQuietUntil('Asia/Kolkata', at2230, { quietStart: 0, quietEnd: 0 }), null, 'equal start/end = never quiet')
console.log('Task results: owner quiet hours')
