// 17 Nov investor demo (owner's screenshot): phone bookings went under "Gogo" though a name was given; a call
// request for a hotel room was saved as a stay; a check-out answer replaced the check-in.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const vc = await import('../lib/agent/voice-call.ts')
const fd = await import('../lib/memory/front-door.ts')
let checks = 0
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }

// 1. Booking name: the two live messages, plus the phrasings people use.
const P = 'call Toit and book a table for 2 '
eq(vc.callBookingName('Call novotel Indiranagar on 8310441698 and book a table for 2 at 9pm on Saturday under name Manu jain'), 'Manu Jain', 'live 1: "under name Manu jain"')
eq(vc.callBookingName('Call Toit Indiranagar on 9686567626 and book a table for 2 at 9pm on Saturday under name Divya'), 'Divya', 'live 2: "under name Divya"')
for (const [input, want] of [
  ['Saturday 8pm under the name Goverdhan', 'Goverdhan'], ['Saturday 8pm under the name of nithin k', 'Nithin K'], ['in the name of Divya for Saturday 8pm', 'Divya'],
  ['tonight 8pm, name is Nithin', 'Nithin'], ['under Divya', 'Divya'], ['under name: Divya', 'Divya'], ['under the name "Divya"', 'Divya'], ['under name Divya.', 'Divya'],
  ['under the name M D Goverdhan', 'M D Goverdhan'], ['under name Goverdhan Mandyam Doddamane', 'Goverdhan Mandyam Doddamane'], ['under name Dr Nithin Rao', 'Dr Nithin Rao'],
  // Review B1: a day, time word or filler after the name is never part of it.
  ['under name Divya Saturday 8pm', 'Divya'], ['under name divya friday', 'Divya'], ['under name Divya next Friday', 'Divya'], ['under name divya pls', 'Divya'], ['under name divya thanks', 'Divya'],
  ['under name Divya in the smoking area', 'Divya'], ['under name Divya near the window', 'Divya'], ['under name Divya with a cake', 'Divya'], ['under name Divya also ask for parking', 'Divya'],
  ['the name is Divya not Gogo', 'Divya'], ['under name of Divya or Nithin', 'Divya'],
  // Review B3: words that are not a name give nothing.
  ['Saturday 8pm', null], ['under name of the company', null], ['with name tags on Saturday', null], ['name will be given later', null], ['under name not decided', null],
  ['under name as usual', null], ['with Nithin, name is on the list', null], ['in the name of the birthday girl', null], ['under name my wife', null], ['under my name', null], ['. Restaurant name is Toit Indiranagar', null],
] as [string, string | null][]) eq(vc.callBookingName(P + input), want, `name from "${input}"`)
for (const venue of ['call The Name Bar and book a table for 2', 'call Name Is Coffee and book a table for 2', 'call In The Name Of Food and book a table for 2 Saturday', 'call the place whose name is Toit and book a table for 2', 'call Under The Mango Tree and book a table for 2 Saturday 8pm'])
  eq(vc.callBookingName(venue), null, `a venue is never the booking name: ${venue}`)
// Review B2: only the name words are removed; the day and time stay.
eq(vc.stripCallBookingName('Call Toit Indiranagar on 9686567626 and book a table for 2 at 9pm on Saturday under name Divya'), 'Call Toit Indiranagar on 9686567626 and book a table for 2 at 9pm on Saturday', 'live 2: tail removed')
eq(vc.stripCallBookingName(P + 'under name Divya friday'), 'call Toit and book a table for 2 friday', 'the day after the name is kept')
eq(vc.stripCallBookingName(P + 'in the name of Divya for Saturday 8pm'), 'call Toit and book a table for 2 for Saturday 8pm', 'a name in the middle')
eq(vc.stripCallBookingName('Call District 6 near Orion mall and book a table for 2 Saturday 8pm under the name Goverdhan'), 'Call District 6 near Orion mall and book a table for 2 Saturday 8pm', 'documented example unchanged')
eq(vc.stripCallBookingName(P + 'Saturday 8pm'), 'call Toit and book a table for 2 Saturday 8pm', 'nothing to strip')
const src = readFileSync('lib/agent/voice-call.ts', 'utf8')
eq(/const givenName = callBookingName\(params\.text\)/.test(src) && /const guestName = named\?\.\[1\] \|\| savedName/.test(src), true, 'the plan uses the given name before the saved or account name')
eq(src.indexOf('await rememberBookingName(tg, named[1])') > src.indexOf('if (isRoomCallRequest(cmd.text)) return'), true, 'a name is remembered only after a plan exists (review B4)')

// 2. A room is not a table: never a call plan, and never saved as a stay.
const room = 'Call Novotel on 8310441698 and book a room for 2 nigths on Saturday under name Munu jain'
eq(vc.isRoomCallRequest(room), true, 'live: a room request')
for (const yes of ['call Taj and book a suite for Friday', 'call ITC and reserve 2 rooms for Saturday', 'call Novotel and book us a room', 'call Novotel and book a deluxe double room', 'call Taj and book the presidential suite', 'call Novotel and book for two nights from Saturday', 'call the resort and book a villa'])
  eq(vc.isRoomCallRequest(yes), true, `room request: ${yes}`)
for (const no of ['Call Toit Indiranagar and book a table for 2 at 9pm on Saturday', 'call Rooms Cafe and book a table for 4', 'call Toit and book a private room for 10 Saturday 8pm', 'call Toit and book a table for 6 Saturday 8pm, I have guests in town for 3 nights', 'call Suite 22 Lounge and book a table for 2', 'call Toit and book a table for 2 Saturday night'])
  eq(vc.isRoomCallRequest(no), false, `a table call is unaffected: ${no}`)
eq(/if \(isRoomCallRequest\(cmd\.text\)\) return \{ text: "I can call a restaurant to book a table, but I can't book a hotel room by phone yet\. Nothing was called\."/.test(src), true, 'the reply says so, promises nothing else and calls nothing')
eq(fd.isStayRequest(room), true, 'live: a request, not a booking that exists')
eq(['Book me a room at Novotel for Saturday night please, 2 nights', 'Please call the hotel and book a room', 'can u book a room at Taj for 20 to 22 Nov'].map(fd.isStayRequest), [true, true, true], 'requests')
for (const conf of ['Your booking at Novotel Bengaluru is confirmed. Check-in 18 Nov, check-out 20 Nov. Booking ID 12345', 'Booking confirmed: Taj MG Road, 2 nights from 20 Nov',
  'Please find attached your booking confirmation for Novotel Bengaluru. Check-in 18 Nov, check-out 20 Nov.', 'Book again and save 10%! Your stay at Novotel Bengaluru is confirmed. Check-in 18 Nov, check-out 20 Nov',
  'Call us on 080 1234 5678 for changes. Your booking at Novotel is confirmed, check-in 18 Nov', 'Reserve your spot at breakfast. Your Hyatt reservation is confirmed for 18 Nov to 20 Nov'])
  eq(fd.isStayRequest(conf), false, `a confirmation is still saved: ${conf.slice(0, 40)}`)
const front = readFileSync('lib/memory/front-door.ts', 'utf8')
eq(front.includes('if (text.length >= 40 && !(isStayRequest(text) && !p.forwarded) && looksLikeHotelBooking(text)) {'), true, 'a typed request is never ingested as a stay; a forward always can be')

// 3. The check-out answer goes to check-out.
eq(fd.askedStayField('🏨 *Updated: Novotel*\nCheck-in Wed, 18 Nov.\n\nWhich day do you check out?'), 'checkOut', 'live: the "Updated" card asks for check-out')
eq(fd.askedStayField('🏨 *Saved: Novotel*\nBooking under Munu Jain.\n\nWhich dates is the stay?'), 'both', 'the first card still asks for both')
eq(fd.askedStayField('🏨 *Updated: Novotel*\nCheck-in Wed, 18 Nov · check-out Fri, 20 Nov.\n\nI\'ll remind you on arrival day and on the morning of check-out.'), null, 'a finished card asks nothing')
console.log(`PASS verify-demo-fixes-nov17: ${checks} checks`)
