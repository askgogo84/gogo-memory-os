// 29 Oct, round 2 of connected memory: notes, meetings, documents and the booking name join the trip.
// Live cases: "Mukesh Chamedia (Aman Chamedia)", the card-for-incidentals note missing from the trip answer,
// the 4 pm Mumbai meeting not linked, "Aman passport" read as RUDITA CHANEDJA, a calendar entry titled
// "To meeting", and phone bookings made "under Gogo".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const g = await import('../lib/memory/life-graph')
const st = await import('../lib/memory/stay')
const names = await import('../lib/memory/names')
const { parseCalendarCreate } = await import('../lib/bot/handlers/calendar-actions')

const flight = g.itemFromLifeEvent({ id: 'f1', event_type: 'travel', subtype: 'flight', title: 'IndiGo 6E5256 Bengaluru → Mumbai', start_at: '2026-10-29T04:25:00Z', end_at: '2026-10-29T06:15:00Z', location: 'Bengaluru → Mumbai', metadata_json: {} })!
const back = g.itemFromLifeEvent({ id: 'f2', event_type: 'travel', subtype: 'flight', title: 'IndiGo 6E6240 Mumbai → Bengaluru', start_at: '2026-10-31T14:00:00Z', end_at: '2026-10-31T15:45:00Z', location: 'Mumbai → Bengaluru', metadata_json: {} })!
const stay = () => g.itemFromLifeEvent({ id: 's1', event_type: 'reservation', subtype: 'hotel_stay', title: 'Four Seasons Mumbai', start_at: '2026-10-29T08:30:00Z', end_at: '2026-10-31T05:30:00Z', location: 'Mumbai', metadata_json: { city: 'Mumbai', hotel: 'Four Seasons Mumbai', checkIn: '2026-10-29', checkOut: '2026-10-31', bookedBy: 'Mukesh Chamedia', userRole: 'guest' } })!
const note = (id: string, text: string) => g.itemFromLifeEvent({ id, event_type: 'other', subtype: 'trip_note', title: text, start_at: '2026-10-29T04:25:00Z', location: 'Mumbai', metadata_json: { city: 'Mumbai', text, from: 'a forwarded message' } })!

// 1. Booking name vs arranged by.
const trips = g.applyTripNotes(g.linkTrips([flight, back, stay(), note('n1', 'Booking is in the name of Aman Chamedia'), note('n2', 'Room is paid for but they might take your card for incidentals')]).trips)
const mumbai = trips.find(t => t.city === 'Mumbai')!
const lines = g.tripLines(trips, 'Asia/Kolkata', Date.parse('2026-10-29T03:00:00Z'))
const text = lines.join('\n')
assert.match(text, /booking name: Aman Chamedia \(arranged by Mukesh Chamedia\), you are an added guest/, text)
assert.doesNotMatch(text, /Mukesh Chamedia \(Aman Chamedia\)/)
assert.doesNotMatch(text, /📌 Booking is in the name/, 'a note absorbed into the stay is not repeated')
assert.match(text, /📌 Room is paid for but they might take your card for incidentals/, 'the incidentals note stays in the trip answer')
assert.ok(lines.findIndex(l => /📌/.test(l)) > lines.findIndex(l => /🏨/.test(l)), 'notes come after the bookings')
console.log('✓ booking name and arranged-by are separate; the incidentals note is in the trip')

// The same, persisted: a note after the email, and the email forwarded again afterwards.
const email = st.stayFromJson({ hotel: 'Four Seasons Mumbai', city: 'Mumbai', bookedBy: 'Mukesh Chamedia', guests: [], userRole: 'guest' })!
const withName = st.mergeStay(email, { ...email, bookedBy: 'Aman Chamedia', arrangedBy: 'Mukesh Chamedia' })
assert.equal(withName.bookedBy, 'Aman Chamedia'); assert.equal(withName.arrangedBy, 'Mukesh Chamedia')
const reforwarded = st.mergeStay(withName, email)
assert.equal(reforwarded.bookedBy, 'Aman Chamedia', 'the forwarder re-read from the email does not replace the booking name')
assert.equal(reforwarded.arrangedBy, 'Mukesh Chamedia')
assert.equal(st.mergeStay(email, { ...email, bookedBy: 'Aman Chamedia' }).arrangedBy, 'Mukesh Chamedia', 'a new booking name keeps the earlier one as arranged-by')
const reply = st.stayReply({ ...withName, checkIn: '2026-10-29', checkOut: '2026-10-31' }, null)
assert.match(reply, /guest on Aman Chamedia's booking\. Arranged by Mukesh Chamedia\./, reply)
assert.match(readFileSync('lib/memory/stay.ts', 'utf8'), /"arrangedBy":"the person who made or sent the booking/, 'the reader asks for arranged-by separately')
console.log('✓ the saved stay keeps the booking name when the email is forwarded again')

// 2. Meetings in the trip city.
const meeting = g.itemFromCalendarEvent({ id: 'e1', summary: 'Investor meeting', start: { dateTime: '2026-10-29T10:30:00Z' }, end: { dateTime: '2026-10-29T11:30:00Z' }, location: 'BKC, Mumbai' })!
const blrCall = g.itemFromCalendarEvent({ id: 'e2', summary: 'Tipplr review', start: { dateTime: '2026-10-30T06:00:00Z' }, location: 'Indiranagar, Bengaluru' })!
const anyCall = g.itemFromCalendarEvent({ id: 'e3', summary: 'Call with Divya', start: { dateTime: '2026-10-30T09:00:00Z' } })!
const later = g.itemFromCalendarEvent({ id: 'e4', summary: 'Dinner with Nithin', start: { dateTime: '2026-11-02T14:00:00Z' } })!
assert.equal(g.itemFromCalendarEvent({ id: 'x', summary: 'Holiday', start: { date: '2026-10-30' } }), null, 'all-day entries are not meetings')
assert.equal(meeting.city, 'mumbai'); assert.equal(blrCall.city, 'bengaluru')
g.linkCalendar(trips, [meeting, blrCall, anyCall, later])
assert.deepEqual(mumbai.items.filter(i => i.kind === 'event').map(i => i.id).sort(), ['gcal:e1', 'gcal:e3'], 'Mumbai meetings and unlocated ones during the stay link; a Bengaluru one and one after the flight home do not')
g.linkCalendar(trips, [meeting])
assert.equal(mumbai.items.filter(i => i.id === 'gcal:e1').length, 1, 'linking twice does not duplicate')
const withMeeting = g.tripLines(trips, 'Asia/Kolkata', Date.parse('2026-10-29T03:00:00Z')).join('\n')
assert.match(withMeeting, /📅 Thu, 29 Oct, 4:00 pm · Investor meeting · BKC, Mumbai \(4\.5 h after you land\)/, withMeeting)
console.log('✓ the 4 pm Mumbai meeting is linked to the trip with the time after landing')

// 3. Travel documents.
assert.equal(names.labelNameMismatch('Aman passport', 'RUDITA CHANEDJA'), true)
assert.equal(names.labelNameMismatch('Aman passport', 'AMAN CHAMEDIA'), false)
assert.equal(names.labelNameMismatch('my passport', 'GOVERDHAN M D'), false, 'a label with no name never warns')
assert.equal(names.labelNameMismatch("wife's passport", 'DIVYASHREE URS'), false)
const docs = g.travelDocLines([
  { kind: 'passport', label: 'Aman passport', holder: 'RUDITA CHANEDJA', expiry: '2023-05-01', expired: true, title: 'Passport' },
  { kind: 'id_document', label: null, holder: 'Aman Chamedia', expiry: null, expired: false, title: 'Aadhaar' },
], trips).join('\n')
assert.match(docs, /🛂 Passport: RUDITA CHANEDJA \(saved as "Aman passport"\) · EXPIRED 2023-05-01/, docs)
assert.match(docs, /does not match the label, so it may be misread/)
assert.match(docs, /🛂 ID: Aman Chamedia · same person as the hotel booking name/, docs)
assert.doesNotMatch(docs, /\d{6,}/, 'never a document number')
assert.deepEqual(g.travelDocLines([{ kind: 'passport', label: null, holder: 'X', expiry: null, expired: false, title: '' }], []), [], 'no trip, no document lines')
const assetSrc = readFileSync('lib/services/asset-memory.ts', 'utf8')
assert.match(assetSrc, /cross-check the two machine-readable lines/, 'the passport reader checks the MRZ')
assert.match(assetSrc, /You called this "\$\{userLabel\}", but I read the name as/, 'a label/name mismatch is said at save time')
console.log('✓ passports and IDs attach to the trip, with the misread name flagged')

// 4. Wiring.
assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /m\.tripContextLines\(p\.telegramId, now, timezone\)/)
assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /Never combine them as one name/)
assert.match(readFileSync('lib/bot/process-message.ts', 'utf8'), /m\.tripContextLines\(user\.telegramId\)/)
assert.match(readFileSync('lib/agent/flight-track.ts', 'utf8'), /g\.applyTripNotes\(/)
console.log('✓ the brain, chat context and landing alert read the full trip')

// 5. Calendar title.
for (const [input, want] of [['Add to calendar meeting with investors at 4 pm tomorrow', 'Meeting with investors'], ['Add to my calendar meeting at 4 pm today', 'Meeting'], ['Add to calendar: call with Nithin at 6 pm tomorrow', 'Call with Nithin']] as const) {
  const p: any = parseCalendarCreate(input)
  assert.equal(p?.title, want, `${input} → ${p?.title}`)
}
console.log('✓ "Add to calendar meeting…" is titled "Meeting…", not "To meeting"')

// 6. Call booking name.
const vc = readFileSync('lib/agent/voice-call.ts', 'utf8')
assert.match(vc, /savedBookingName\(tg\)/); assert.match(vc, /rememberBookingName\(tg, named\[1\]\)/)
assert.match(vc, /under\\s\+the\\s\+name\\s\+\(\?:of\\s\+\)\?\(\[a-z\]/, 'lowercase "under the name goverdhan" is understood')
console.log('✓ a booking name given once is remembered for later calls')
