// 19 Oct vs Wajo: Wajo's Jailer 2 reminder carried venue, screen, seats, booking ID and a leave-by time.
// AskGogo's said "🎟️ Jailer 2 starts in 3 hours at 21:45!", and "Move to 8pm" echoed it as
// "I'll remind you about Jailer 2 starts in 3 hours at 21:45! today at 8:00 PM".
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'
const t = await import('../lib/services/travel-tickets')
assert.equal(t.eventReminderText({name: 'Jailer 2', time: '21:45', venue: 'PVR Orion Mall', screen: 'Audi 04', seats: 'K18, K19, K20', bookingId: 'TSAJKDX'}),
  '🎟️ Jailer 2 at 9:45 PM at PVR Orion Mall, Audi 04, seats K18, K19, K20, booking TSAJKDX. Aim to leave by 9:00 PM.')
assert.equal(t.eventReminderText({name: 'Concert', time: '18:00', venue: 'Palace Grounds'}), '🎟️ Concert at 6:00 PM at Palace Grounds. Aim to leave by 5:15 PM.')
assert.equal(t.eventReminderText({name: 'Show', time: '00:30'}), '🎟️ Show at 12:30 AM. Aim to leave by 11:45 PM.')
assert.equal(t.eventReminderText({name: 'Show', time: 'evening'}), '🎟️ Show at evening.', 'unparseable time: no invented leave-by')
assert.doesNotMatch(t.eventReminderText({name: 'Jailer 2', time: '21:45'}), /starts in|hours/i, 'no relative time that goes stale when moved')
assert.equal(t.trainReminderText({from: 'SBC', to: 'MAS', departure: '06:10', trainNo: '12608', pnr: '4512345678', seat: 'B2-34'}), '🚆 SBC → MAS (train 12608) departs at 6:10 AM, seat B2-34, PNR 4512345678.')
assert.deepEqual(t.legacyReminderTexts({type: 'event', eventName: 'Jailer 2', departLocal: '21:45'}), ['🎟️ Jailer 2 starts in 3 hours at 21:45!'])
const src = readFileSync('lib/services/travel-tickets.ts', 'utf8')
assert.match(src, /reminderMsg: eventReminderText\(e\)/)
assert.match(src, /legacyReminderTexts\(leg\)\]\)/, 'old reminder text still dedupes on re-forward')
const route = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.match(route, /⏰ Moved to \*8:00 PM\*/); assert.doesNotMatch(route, /I'll remind you about \*\$\{target\.message\}\* today at/)
const reader = readFileSync('lib/services/pdf-reader.ts', 'utf8')
assert.match(reader, /"seats":"K18, K19, K20","bookingId":"TSAJKDX"/, 'ticket extraction asks for screen, seats and booking ID')
process.stdout.write('Rich event reminders: venue, screen, seats, booking ID, leave-by; no stale relative time; moved/snoozed echo fixed.\n')
