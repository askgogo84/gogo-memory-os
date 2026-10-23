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
assert.deepEqual(out.map(o => o.eventId), ['Starts soon', 'Divya sync', 'Nithin 1:1'], 'meetings with other people until they start; not declined/free/all-day/solo/next week')
const divya = out.find(o => o.eventId === 'Divya sync')!
assert.equal(divya.title, 'Prepare for Divya sync · Fri, 3:00 pm')
assert.match(divya.summary, /^With Divya until 3:30 pm\. Read first: “Contract draft” \(22 Oct\); “Q4 menu pricing” \(21 Oct\)\.$/, 'latest related email first; unrelated newsletter left out')
assert.deepEqual(divya.threadIds, ['t3', 't1'])
assert.deepEqual(divya.attendees, ['divya@acme.com'], 'resource rooms and self excluded')
assert.match(out.find(o => o.eventId === 'Nithin 1:1')!.summary, /No recent email with them in the last two weeks\./, 'no related email: said plainly, nothing invented')
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

// Start nudge (23 Oct, Instinct side by side): "Your Daily Connect-Standup starts at 11:30am, in about 8 minutes" + link.
{
  const P = await import('../lib/agent/meeting-prep')
  assert.equal(P.safeMeetLink('https://meet.google.com/zdq-nnkc-jfr'), 'https://meet.google.com/zdq-nnkc-jfr')
  assert.equal(P.safeMeetLink('https://evil.example/meet.google.com'), null)
  assert.equal(P.safeMeetLink('http://meet.google.com/x'), null)
  const withLink = P.findMeetingsNeedingPrep([{ id: 'standup', summary: 'Daily Connect-Standup', start: '2026-10-23T06:00:00Z', end: '2026-10-23T06:15:00Z', meetLink: 'https://meet.google.com/zdq-nnkc-jfr', attendees: [{ email: 'nithin@tipplr.in' }] } as any], [], me, new Date('2026-10-23T05:52:00Z'))
  assert.equal(withLink[0].meetLink, 'https://meet.google.com/zdq-nnkc-jfr'); assert.equal(withLink[0].meetingName, 'Daily Connect-Standup')
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
  const N = await import('../lib/agent/meeting-nudge')
  assert.equal(N.meetingNudgeText({ name: 'Daily Connect-Standup', startsAt: '2026-10-23T06:00:00Z', meetLink: 'https://meet.google.com/zdq-nnkc-jfr', now: Date.parse('2026-10-23T05:52:00Z'), tz: 'Asia/Kolkata' }),
    '📅 Your Daily Connect-Standup starts at 11:30am, in about 8 minutes.\nhttps://meet.google.com/zdq-nnkc-jfr')
  const src = readFileSync('lib/agent/meeting-nudge.ts', 'utf8')
  assert.match(src, /key: `meeting-nudge\/\$\{loop\.source_id\}`/, 'once per meeting (delivery ledger key)')
  assert.match(src, /prefs\.topics\.calendar === false \|\| isQuietHour\(prefs, hour\)/, 'Calendar topic and quiet hours respected')
  assert.match(readFileSync('app/api/cron/autonomous-runs/route.ts', 'utf8'), /processMeetingNudges\(\)/)
  console.log('Meeting start nudge: 10 minutes before, with the Meet link, once, within alert settings')
}
