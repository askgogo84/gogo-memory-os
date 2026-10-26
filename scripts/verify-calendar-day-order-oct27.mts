// 27 Oct live: "What do I have on my calendar tomorrow?" listed the 11:30 multi-day standup above the 10:30 meeting.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const c = await import('../lib/agent/calendar-read')
const tz = 'Asia/Kolkata'
const items = [
  { summary: 'Daily Connect-Standup Call', label: 'x', account: 'g@tipplr.in', start: '2026-10-08T06:00:00Z', end: '2026-10-31T06:15:00Z' },
  { summary: 'ONDC l Tipplr weekly connect', label: 'Tue, 27 Oct, 10:30 am – 11:00 am', account: 'g@tipplr.in', start: '2026-10-27T05:00:00Z', end: '2026-10-27T05:30:00Z' },
  { summary: 'Cohort Connect | Seller Apps', label: 'Tue, 27 Oct, 11:00 am – 11:45 am', account: 'g@tipplr.in', start: '2026-10-27T05:30:00Z', end: '2026-10-27T06:15:00Z' },
  { summary: 'FnB daily syncup <> Tipplr', label: 'Tue, 27 Oct, 11:30 am – 12:00 pm', account: 'g@tipplr.in', start: '2026-10-27T06:00:00Z', end: '2026-10-27T06:30:00Z' },
  { summary: 'ONDC| Food Readiness', label: 'Tue, 27 Oct, 7:30 pm – 8:00 pm', account: 'g@tipplr.in', start: '2026-10-27T14:00:00Z', end: '2026-10-27T14:30:00Z' },
]
const lines = c.calendarItemLines(items, tz)
assert.match(lines[0], /^1\. ONDC l Tipplr weekly connect/)
assert.match(lines[1], /^2\. Cohort Connect/)
assert.match(lines[2], /^3\. Daily Connect-Standup Call — 11:30 am/, 'the standup sits at 11:30, before the 11:30 syncup (stable order)')
assert.match(lines[3], /^4\. FnB daily syncup/)
assert.match(lines[4], /^5\. ONDC\| Food Readiness/)
// A week view (entries on several days) keeps its order unchanged.
const week = c.sortCalendarGroupsByDay(c.collapseCalendarItems([items[3], { ...items[1], start: '2026-10-28T05:00:00Z' }], tz), tz)
assert.equal(week[0].first.summary, 'FnB daily syncup <> Tipplr')
console.log('Calendar day order passed')
