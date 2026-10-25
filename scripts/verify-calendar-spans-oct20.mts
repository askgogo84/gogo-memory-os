// 20 Oct live: a standup series whose entries each span ~3 weeks was listed 8 times as multi-week ranges.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const { calendarItemLines } = await import('../lib/agent/calendar-read.ts')
const tz = 'Asia/Kolkata'
const standup = (d: number) => ({ summary: 'Daily Connect-Standup Call', account: 'goverdhan@tipplr.in', label: 'x',
  start: `2026-10-${String(d).padStart(2, '0')}T06:00:00Z`, end: new Date(Date.parse(`2026-10-${String(d).padStart(2, '0')}T06:15:00Z`) + 23 * 86400_000).toISOString() })
const items = [standup(8), standup(9), standup(12), standup(13), standup(14),
  { summary: 'Lunch with Divya', label: 'Tue, 20 Oct, 1:00 pm – 2:00 pm', start: '2026-10-20T07:30:00Z', end: '2026-10-20T08:30:00Z' },
  { summary: 'Lunch with Divya', label: 'Tue, 20 Oct, 1:00 pm – 2:00 pm', start: '2026-10-20T07:30:00Z', end: '2026-10-20T08:30:00Z' },
  { summary: 'Offsite', label: 'All day · 2026-10-20 (end 2026-10-21 exclusive)', start: '2026-10-20', end: '2026-10-21' }]
const lines = calendarItemLines(items as any, tz)
assert.equal(lines.length, 3, lines.join('\n'))
assert.match(lines[0], /^1\. Daily Connect-Standup Call — 11:30 am – 11:45 am \(goverdhan@tipplr\.in\) · 5 overlapping entries, each spans several days/)
assert.equal(lines[1], '2. Lunch with Divya — Tue, 20 Oct, 1:00 pm – 2:00 pm (×2)')
assert.equal(lines[2], '3. Offsite — All day · 2026-10-20 (end 2026-10-21 exclusive)', 'all-day entries untouched')
console.log('PASS long-span series collapse; duplicates (×N); all-day unchanged')

const { alreadyHappened, firstFutureDate } = await import('../lib/agent/lookup-then-calendar.ts')
const now = new Date('2026-10-20T07:40:00Z')
const live = 'Pushpa 3 is expected to release sometime in 2028, per a statement from the film team. No exact date has been announced. Note: a short film titled "Pushpa 3 - The Rampage" released on Dec 25, 2025.'
assert.equal(alreadyHappened(live, now), false, 'still expected — not "already out"')
assert.equal(firstFutureDate(live, now), null)
assert.equal(alreadyHappened('Jailer 2 already released on 15 October 2026.', now), true, 'positive control')
console.log('CALENDAR_SPANS_OK')
