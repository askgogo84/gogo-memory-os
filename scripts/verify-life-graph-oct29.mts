// 29 Oct: connected memory. The live case: BLR→BOM 6E 5256 landing 11:45 and Mukesh's Four Seasons email adding
// the owner as 2nd guest must become ONE Mumbai trip, answered without "you've added me".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const g = await import('../lib/memory/life-graph')
const st = await import('../lib/memory/stay')
const fd = await import('../lib/memory/front-door')

const flight = g.itemFromLifeEvent({ id: 'f1', event_type: 'travel', subtype: 'flight', title: 'IndiGo 6E5256 Bengaluru → Mumbai', start_at: '2026-10-29T04:25:00Z', end_at: '2026-10-29T06:15:00Z', location: 'Bengaluru → Mumbai', confirmation_ref: 'F8C4UF', metadata_json: {} })!
const back = g.itemFromLifeEvent({ id: 'f2', event_type: 'travel', subtype: 'flight', title: 'IndiGo 6E6240 Mumbai → Bengaluru', start_at: '2026-10-31T14:00:00Z', end_at: '2026-10-31T15:45:00Z', location: 'Mumbai → Bengaluru', confirmation_ref: 'F8C4UF', metadata_json: {} })!
const stayRow = g.itemFromLifeEvent({ id: 's1', event_type: 'reservation', subtype: 'hotel_stay', title: 'Four Seasons, Mumbai', start_at: null, end_at: null, location: 'Mumbai', metadata_json: { city: 'Mumbai', hotel: 'Four Seasons Hotel Mumbai', bookedBy: 'Mukesh Chamedia', userRole: 'guest' } })!
const other = g.itemFromLifeEvent({ id: 'f3', event_type: 'travel', subtype: 'flight', title: 'AI 505 Bengaluru → Kochi', start_at: '2026-11-20T04:00:00Z', end_at: '2026-11-20T05:00:00Z', location: 'Bengaluru → Kochi', metadata_json: {} })!
assert.equal(flight.city, 'Mumbai'); assert.equal(stayRow.kind, 'stay')
const { trips } = g.linkTrips([stayRow, other, back, flight])
const mumbai = trips.find(t => t.city === 'Mumbai')!
assert.ok(mumbai, JSON.stringify(trips))
assert.deepEqual(mumbai.items.map(i => i.id).sort(), ['f1', 'f2', 's1'], 'outbound flight, undated stay and the return flight are one trip')
assert.ok(trips.find(t => t.city === 'Kochi' && t.items.length === 1), 'a different city is a different trip')
assert.equal(g.normCity('Mumbai, T1'), 'mumbai'); assert.equal(g.normCity('Bombay'), 'mumbai'); assert.equal(g.normCity('BLR'), 'bengaluru')
const lines = g.tripLines(trips, 'Asia/Kolkata', Date.parse('2026-10-29T03:00:00Z'))
assert.ok(lines.some(l => /^Mumbai trip/.test(l)), lines.join('\n'))
assert.ok(lines.some(l => /Four Seasons Hotel Mumbai.*booking under Mukesh Chamedia, you are an added guest/.test(l)), lines.join('\n'))
assert.ok(lines.some(l => /6E5256.*PNR F8C4UF/.test(l)))

// The stay read from Mukesh's email.
assert.equal(st.looksLikeHotelBooking('Re: Mukesh, help us make your arrival seamless. Hi, pls add Goverdhan Dodammane as the 2nd guest. On Oct 28, 2026, Four Seasons Hotels and Resorts wrote'), true)
assert.equal(st.looksLikeHotelBooking('Remind me to call Nithin tomorrow'), false)
const stay = st.stayFromJson({ hotel: 'Four Seasons Hotel Mumbai', city: 'Mumbai', checkIn: null, checkOut: null, bookedBy: 'Mukesh Chamedia', guests: ['Mukesh Chamedia', 'Goverdhan Dodammane'], userRole: 'guest', isRequest: true })!
assert.equal(st.stayFromJson({ hotel: 'hotel' }), null, 'no hotel name, no stay')
assert.equal(st.stayFromJson({ hotel: 'X', checkIn: '28 Oct' })!.checkIn, null, 'only ISO dates are kept')
const reply = st.stayReply(stay, mumbai)
assert.match(reply, /Saved: Four Seasons Hotel Mumbai, Mumbai/)
assert.match(reply, /You're a guest on Mukesh Chamedia's booking \(Mukesh has asked the hotel to add you\)/)
assert.match(reply, /Linked to your Mumbai trip: you arrive Thu, 29 Oct at 11:45 am/)
assert.match(reply, /Which dates is the stay\?/)
assert.doesNotMatch(reply, /you've added me|added me as/i, 'never tells the user Gogo was added or acted')
assert.equal(st.stayDedupeKey(stay), 'stay:four-seasons-hotel-mumbai:mumbai')
const merged = st.mergeStay(stay, { ...stay, checkIn: '2026-10-29', checkOut: null, guests: ['Goverdhan Dodammane'], userRole: 'unknown', bookedBy: null })
assert.equal(merged.checkIn, '2026-10-29'); assert.equal(merged.bookedBy, 'Mukesh Chamedia'); assert.equal(merged.userRole, 'guest')
const extracted = await st.extractStay('Four Seasons Hotels: your reservation, check-in 29 Oct 2026, check-out 31 Oct 2026, guests Mukesh Chamedia and Goverdhan', {
  fetcher: (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: '{"isHotelStay":true,"hotel":"Four Seasons Hotel Mumbai","city":"Mumbai","checkIn":"2026-10-29","checkOut":"2026-10-31","bookedBy":"Mukesh Chamedia","guests":["Mukesh Chamedia"],"userRole":"guest","isRequest":false}' }] }), { status: 200 })) as any,
})
if ((globalThis as any).process?.env?.ANTHROPIC_API_KEY) { assert.equal(extracted?.checkOut, '2026-10-31'); assert.equal(extracted?.userRole, 'guest') }
assert.equal(await st.extractStay('Four Seasons reservation check-in tomorrow guests two', { fetcher: (async () => new Response('{}', { status: 500 })) as any }), null)

// Follow-up dates and cab details.
const now = new Date('2026-10-29T04:00:00Z')
assert.deepEqual(fd.parseReplyDates('checking out on 31st', now), ['2026-10-31'])
assert.deepEqual(fd.parseReplyDates('29 Oct to 31 Oct', now), ['2026-10-29', '2026-10-31'])
assert.deepEqual(fd.parseReplyDates('Saturday', now), ['2026-10-31'])
assert.deepEqual(fd.parseReplyDates('tomorrow', now), ['2026-10-30'])
assert.equal(fd.askedStayField(reply), 'both')
assert.equal(fd.askedStayField('Which day do you check out?'), null, 'only Gogo\'s own stay question')
assert.equal(fd.frontDoorCandidate('Cab: driver Ramesh, MH 01 AB 1234, 98200 12345'), true)
assert.equal(fd.frontDoorCandidate('Hi Gogo'), false)
assert.equal(fd.frontDoorCandidate('What is the weather in Goa this week and what should I pack for the beach trip with friends'), false)
assert.equal(fd.currentTrip(trips, Date.parse('2026-10-29T05:00:00Z'))?.city, 'Mumbai')

// Wiring.
const wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8'), web = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.ok(wa.indexOf('lib/memory/front-door') > 0 && wa.indexOf('lib/memory/front-door') < wa.indexOf("import('@/lib/agent/brain')"), 'front door runs before the brain on WhatsApp')
assert.ok(web.indexOf('lib/memory/front-door') > 0 && web.indexOf('lib/memory/front-door') < web.indexOf("import('@/lib/agent/brain')"), 'and on web chat')
assert.match(wa, /ingestStayFromText/, 'hotel screenshots become stays')
assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /Trips \(linked bookings/, 'the brain sees linked trips')
assert.match(readFileSync('lib/bot/process-message.ts', 'utf8'), /Trips \(linked bookings, owner-bound\)/, 'the chat model sees linked trips')
console.log('✓ 29 Oct connected memory: flight + stay + return are one trip; stay reply is correct; dates and cab follow-ups bind')
