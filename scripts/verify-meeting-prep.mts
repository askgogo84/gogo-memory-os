// Pre-meeting intelligence (Duet brief Phase 2): upcoming meetings with other people → one prep item with the
// email worth reading first. Run: npx tsx scripts/verify-meeting-prep.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findMeetingsNeedingPrep } from '../lib/agent/meeting-prep'

const now = new Date('2026-10-23T04:00:00Z') // 9:30 IST
const me = 'gogo@tipplr.in'
const ev = (id: string, start: string, end: string, attendees: any[] | null, extra: any = {}) => ({ id, summary: id, start, end, attendees, ...extra })
const events = [
  ev('Divya sync', '2026-10-23T09:30:00Z', '2026-10-23T10:00:00Z', [{ email: me, self: true, responseStatus: 'accepted' }, { email: 'divya@acme.com', displayName: 'Divya', responseStatus: 'accepted' }, { email: 'room-1@resource.calendar.google.com', resource: true }]),
  ev('Focus time', '2026-10-23T06:00:00Z', '2026-10-23T08:00:00Z', null),
  ev('Declined', '2026-10-23T07:00:00Z', '2026-10-23T08:00:00Z', [{ email: me, self: true, responseStatus: 'declined' }, { email: 'x@y.com' }]),
  ev('Free block', '2026-10-23T07:00:00Z', '2026-10-23T08:00:00Z', [{ email: 'x@y.com' }], { transparency: 'transparent' }),
  ev('Starts soon', '2026-10-23T04:10:00Z', '2026-10-23T04:40:00Z', [{ email: 'nithin@tipplr.in' }]),
  ev('Next week', '2026-10-30T09:30:00Z', '2026-10-30T10:00:00Z', [{ email: 'nithin@tipplr.in' }]),
  ev('All day', '2026-10-23', '2026-10-24', [{ email: 'nithin@tipplr.in' }]),
  ev('Nithin 1:1', '2026-10-23T12:00:00Z', '2026-10-23T12:30:00Z', [{ email: me, self: true }, { email: 'nithin@tipplr.in', displayName: 'Nithin' }]),
]
const threads = [
  { id: 't1', subject: 'Q4 menu pricing', messages: [{ from: 'Divya <divya@acme.com>', to: me, internalDate: Date.parse('2026-10-21T08:00:00Z') }] },
  { id: 't2', subject: 'Newsletter', messages: [{ from: 'news@list.com', to: me, internalDate: Date.parse('2026-10-22T08:00:00Z') }] },
  { id: 't3', subject: 'Contract draft', messages: [{ from: me, to: 'divya@acme.com, legal@acme.com', internalDate: Date.parse('2026-10-22T10:00:00Z') }] },
]
const out = findMeetingsNeedingPrep(events as any, threads, me, now, 'Asia/Kolkata')
assert.deepEqual(out.map(o => o.eventId), ['Divya sync', 'Nithin 1:1'], 'only meetings with other people, in the prep window, not declined/free/all-day/solo')
assert.equal(out[0].title, 'Prepare for Divya sync · Fri, 3:00 pm')
assert.match(out[0].summary, /^With Divya until 3:30 pm\. Read first: “Contract draft” \(22 Oct\); “Q4 menu pricing” \(21 Oct\)\.$/, 'latest related email first; unrelated newsletter left out')
assert.deepEqual(out[0].threadIds, ['t3', 't1'])
assert.deepEqual(out[0].attendees, ['divya@acme.com'], 'resource rooms and self excluded')
assert.match(out[1].summary, /No recent email with them in the last two weeks\./, 'no related email: said plainly, nothing invented')
assert.equal(new Set(out.map(o => o.key)).size, out.length)
assert.equal(findMeetingsNeedingPrep(events as any, threads, me, now).length, findMeetingsNeedingPrep(events as any, threads, me, now).length, 'stable')
console.log('Meeting prep: meetings with people in the next 18 h, related email first, honest when there is none')

const loops = readFileSync('lib/agent/open-loops.ts', 'utf8')
assert.match(loops, /sourceType:'meeting_prep'/)
assert.match(loops, /if\(results\[4\]\?\.status==='fulfilled'\)successfulSourceTypes\.push\('meeting_prep'\)/, 'past meetings resolve only after a successful calendar read')
assert.match(loops, /gmailOnce=\(\)=>\(gmailPromise\?\?=readGmailAttention\(tg\)\)/, 'one Gmail read per sync')
assert.match(loops, /Gmail isn’t connected, so no email was checked\./)
const cal = readFileSync('lib/agent/calendar-read.ts', 'utf8')
assert.match(cal, /attendees:event\.attendees\.slice\(0,15\)/)
assert.match(cal, /transparency:String\(event\.transparency\)/, 'free blocks reach the conflict check as free')
console.log('Meeting prep: wired into the open-loop sync (calendar complete read + shared Gmail read)')
