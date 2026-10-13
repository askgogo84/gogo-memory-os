import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 21:02: a "Conflict" line showed only an event's start ("Daily Connect-Standup Call at Thu, 8 Oct, 11:30 am")
// for a slot on 14 Oct, and delete/move only searched the primary Google account and said "Cancelled".
// Run: npx tsx scripts/verify-calendar-conflict-and-mutations.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'
const acc: any = await import('../lib/services/google-calendar-accounts')
const wa: any = await import('../lib/channels/whatsapp')

const ms = (iso: string) => Date.parse(iso)
const standup = { summary: 'Daily Connect-Standup Call', start: { dateTime: '2026-10-08T11:30:00+05:30' }, end: { dateTime: '2026-10-14T18:00:00+05:30' }, _account: 'goverdhan@tipplr.in' }

// range wording: same day shows start–end, a long event shows both ends so it is never a single moment
assert.match(acc.describeEventRange({ start: { dateTime: '2026-10-14T16:00:00+05:30' }, end: { dateTime: '2026-10-14T16:30:00+05:30' } }), /^Wed, 14 Oct, 4:00 pm–4:30 pm$/i)
const longRange = acc.describeEventRange(standup)
assert.match(longRange, /8 Oct.*→.*14 Oct/, 'a multi-day event shows both its start and its end')
assert.match(acc.describeEventRange({ start: { date: '2026-10-14' } }), /all day/)

// real overlaps only
const slotStart = ms('2026-10-14T17:00:00+05:30'), slotEnd = ms('2026-10-14T17:30:00+05:30')
assert.equal(acc.findConflictingEvent([standup], slotStart, slotEnd)?.summary, 'Daily Connect-Standup Call')
assert.equal(acc.findConflictingEvent([{ ...standup, end: { dateTime: '2026-10-08T12:00:00+05:30' } }], slotStart, slotEnd), null, 'a finished event is no clash')
assert.equal(acc.findConflictingEvent([{ ...standup, transparency: 'transparent' }], slotStart, slotEnd), null, 'a "free" event does not block')
assert.equal(acc.findConflictingEvent([{ ...standup, attendees: [{ self: true, responseStatus: 'declined' }] }], slotStart, slotEnd), null, 'a declined event does not block')
assert.equal(acc.findConflictingEvent([{ ...standup, status: 'cancelled' }], slotStart, slotEnd), null)
assert.equal(acc.findConflictingEvent([{ start: { date: '2026-10-14' }, end: { date: '2026-10-15' } }], slotStart, slotEnd), null, 'all-day entries are not treated as a clash')

// one line (the WhatsApp card carries it in a single slot), with the account when several are linked
const one = acc.describeConflict(standup, true)
assert.ok(!one.includes('\n'))
assert.match(one, /Daily Connect-Standup Call on goverdhan@tipplr\.in \(.*8 Oct.*→.*14 Oct.*\)/)
assert.ok(!/ on /.test(acc.describeConflict({ ...standup, _account: null }, false)))
const card = wa.parseCalendarApproval(`📅 *Ready to add — approval required*\n\nGogo test 2\nWed, 14 Oct, 5:00 pm\nDuration: 30 mins\nCalendar: goverdhan.md@gmail.com\n\n⚠️ Conflict: ${one}\n\nNothing has been added yet.`)
assert.equal(card?.conflict, one, 'the whole conflict line reaches the approval card')

// conflict check reads every linked account
const fi = readFileSync(new URL('../lib/feature-intents.ts', import.meta.url), 'utf8')
assert.match(fi, /accounts\.length>1\?accounts:/, 'all linked accounts are checked when there are several')
assert.match(fi, /findConflictingEvent\(merged/)

// delete / move: searches every account, writes back to the account the event is on, says "Deleted"
const cm = readFileSync(new URL('../lib/bot/handlers/calendar-mutations.ts', import.meta.url), 'utf8')
assert.match(cm, /getAllCalendarAccountAccess/)
assert.match(cm, /accounts\.map\(async a => \(\{ email: a\.email, events: await listUpcomingEvents\(a\.accessToken, 7\)/)
assert.match(cm, /accountEmail: ev\._account \|\| null/, 'the pending action remembers the account')
assert.match(cm, /accountEmail: e\._account \|\| null/, 'every candidate remembers its account')
assert.match(cm, /Deleted \*\$\{summary\}\* from your calendar/)
assert.ok(!/Cancelled \*/.test(cm), 'no ambiguous "Cancelled" wording for a deletion')
assert.match(cm, /never write to another one|can't reach the calendar that event is on/, 'a missing account is never replaced by another')
console.log('Calendar: conflicts show the full range across all accounts; delete/move work on every linked account')
