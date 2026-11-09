// Original-module regression for explicit meeting clock and declined-self events.
// Run: npx tsx scripts/verify-meeting-prep-constraints.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
process.env.OPENAI_API_KEY ||= 'fixture'
process.env.ANTHROPIC_API_KEY ||= 'fixture'
const mp = await import('../lib/agent/meeting-prep-ask')
const now = Date.parse('2026-11-06T09:00:00+05:30')
const a = (summary: string, start: string, attendees: any[] = []) =>
  ({ summary, start, label: summary, attendees })
const rows = [
  a('All day', '2026-11-06'),
  a('Old event', '2026-11-06T08:00:00+05:30'),
  a('Declined early', '2026-11-06T09:30:00+05:30', [{ email: 'me@example.com', self: true, responseStatus: 'declined' }]),
  a('11am team check', '2026-11-06T11:00:00+05:30', [{ email: 'guest@example.com', responseStatus: 'declined' }]),
  a('3pm requested', '2026-11-06T15:00:00+05:30'),
  a('3:30pm follow-up', '2026-11-06T15:30:00+05:30'),
]
assert.equal(mp.nextMeeting(rows, now)?.summary, '11am team check', 'declined self invitation not next')
assert.ok(mp.isMeetingPrepAsk('Prep me for my 3pm meeting'))
assert.deepEqual(mp.requestedMeetingClock('Prep me for my 3pm meeting'), { hour: 15, minute: 0 })
assert.deepEqual(mp.requestedMeetingClock('prepare me for my 3:30pm meeting'), { hour: 15, minute: 30 })
assert.deepEqual(mp.requestedMeetingClock('brief me on my 12am call'), { hour: 0, minute: 0 })
assert.deepEqual(mp.requestedMeetingClock('brief me on my 12pm call'), { hour: 12, minute: 0 })
assert.equal(mp.requestedMeetingClock('prepare me for my next meeting'), null)
assert.equal(mp.requestedMeetingClock('prep me for my 13pm meeting'), null, 'invalid 12-hour clock')
assert.equal(mp.requestedMeetingClock('prep me for my 3:99pm meeting'), null, 'invalid minute')
assert.equal(mp.nextMeeting(rows, now, { hour: 15, minute: 0 }, 'Asia/Kolkata')?.summary, '3pm requested')
assert.equal(mp.nextMeeting(rows, now, { hour: 15, minute: 30 }, 'Asia/Kolkata')?.summary, '3:30pm follow-up')
assert.equal(mp.nextMeeting(rows, now, { hour: 16, minute: 0 }, 'Asia/Kolkata'), null, 'no unrelated fallback')
assert.equal(mp.nextMeeting([a('Declined 3pm', '2026-11-06T15:00:00+05:30', [{ email: 'me@example.com', self: true, responseStatus: 'declined' }]), rows[3]], now, { hour: 15, minute: 0 }, 'Asia/Kolkata'), null)
assert.equal(mp.nextMeeting([a('UTC equivalent', '2026-11-06T09:30:00Z')], now, { hour: 15, minute: 0 }, 'Asia/Kolkata')?.summary, 'UTC equivalent')
assert.equal(mp.nextMeeting([a('New York', '2026-11-06T15:00:00Z')], now, { hour: 10, minute: 0 }, 'America/New_York')?.summary, 'New York')
assert.equal(mp.nextMeeting([a('New York', '2026-11-06T15:00:00Z')], now, { hour: 15, minute: 0 }, 'America/New_York'), null)
assert.equal(mp.nextMeeting(rows, now, { hour: 15, minute: 0 }, 'Invalid/Zone'), null, 'invalid timezone never chooses a wrong event')
assert.equal(mp.nextMeeting([a('1', '2026-11-06T15:00:00+05:30'), a('2', '2026-11-06T15:00:00+05:30')], now, { hour: 15, minute: 0 }, 'Asia/Kolkata'), null, 'same-time ambiguity')
const src = readFileSync('lib/agent/meeting-prep-ask.ts', 'utf8')
const fn = src.slice(src.indexOf('export async function tryMeetingPrep'))
assert.match(fn, /const requestedClock = requestedMeetingClock\(text\)/)
assert.match(fn, /nextMeeting\(events, Date\.now\(\), requestedClock, actor\.timezone \|\| 'Asia\/Kolkata'\)/)
assert.ok(fn.indexOf('if (!next && requestedClock)') < fn.indexOf('const guests ='), 'no unrelated Gmail lookup if absent')
assert.ok(fn.indexOf("I couldn't understand the meeting time") < fn.indexOf('const guests ='), 'invalid clock fails closed')
console.log('verify-meeting-prep-constraints: PASS — original-module synthetic regressions, no providers')
