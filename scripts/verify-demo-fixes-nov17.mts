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
eq(vc.callBookingName('Call novotel Indiranagar on 8310441698 and book a table for 2 at 9pm on Saturday under name Manu jain'), 'Manu Jain', 'live 1: "under name Manu jain"')
eq(vc.callBookingName('Call Toit Indiranagar on 9686567626 and book a table for 2 at 9pm on Saturday under name Divya'), 'Divya', 'live 2: "under name Divya"')
eq(vc.callBookingName('call Toit and book a table for 4 Saturday 8pm under the name Goverdhan'), 'Goverdhan', 'existing phrasing kept')
eq(vc.callBookingName('call Toit and book a table for 4 Saturday 8pm under the name of nithin k'), 'Nithin K', 'under the name of')
eq(vc.callBookingName('call Toit and book a table for 4 in the name of Divya for Saturday 8pm'), 'Divya', 'in the name of …, then the day')
eq(vc.callBookingName('call Toit and book a table for 2 tonight 8pm, name is Nithin'), 'Nithin', 'name is …')
eq(vc.callBookingName('call Toit and book a table for 2 under Divya'), 'Divya', 'under <Name>')
eq(vc.callBookingName('call Toit and book a table for 2 Saturday 8pm'), null, 'no name said')
eq(vc.callBookingName('call The Name Bar and book a table for 2'), null, 'a venue with "name" in it is not a booking name')
eq(vc.stripCallBookingName('Call Toit Indiranagar on 9686567626 and book a table for 2 at 9pm on Saturday under name Divya'), 'Call Toit Indiranagar on 9686567626 and book a table for 2 at 9pm on Saturday', 'the name tail is removed before the venue/day/time are read')
eq(vc.stripCallBookingName('call Toit and book a table for 2 Saturday 8pm'), 'call Toit and book a table for 2 Saturday 8pm', 'nothing to strip')
const src = readFileSync('lib/agent/voice-call.ts', 'utf8')
eq(/const givenName = callBookingName\(params\.text\)/.test(src) && /const guestName = named\?\.\[1\] \|\| savedName/.test(src), true, 'the plan uses the given name before the saved or account name')

// 2. A room is not a table: never a call plan, and never saved as a stay.
const room = 'Call Novotel on 8310441698 and book a room for 2 nigths on Saturday under name Munu jain'
eq(vc.isRoomCallRequest(room), true, 'live: a room request')
eq(['call Taj and book a suite for Friday', 'call Novotel and book a table for 2 nights from Saturday', 'call ITC and reserve 2 rooms for Saturday'].map(vc.isRoomCallRequest), [true, true, true], 'rooms, suites, nights')
eq(['Call Toit Indiranagar and book a table for 2 at 9pm on Saturday', 'call Rooms Cafe and book a table for 4'].map(vc.isRoomCallRequest), [false, false], 'a table booking is unaffected')
eq(/if \(isRoomCallRequest\(cmd\.text\)\) return \{ text: "I can call a restaurant to book a table, but I can't book a hotel room by phone yet\. Nothing was called\./.test(src), true, 'the reply says so and calls nothing')
eq(fd.isStayRequest(room), true, 'live: a request, not a booking that exists')
eq(['Book me a room at Novotel for Saturday night please, 2 nights', 'find rooms at Taj for 20 to 22 Nov', 'Please call the hotel and book a room'].map(fd.isStayRequest), [true, true, true], 'requests')
eq(['Your booking at Novotel Bengaluru is confirmed. Check-in 18 Nov, check-out 20 Nov. Booking ID 12345', 'Booking confirmed: Taj MG Road, 2 nights from 20 Nov'].map(fd.isStayRequest), [false, false], 'a forwarded confirmation is still a stay')
const front = readFileSync('lib/memory/front-door.ts', 'utf8')
eq(front.includes('if (text.length >= 40 && !isStayRequest(text) && looksLikeHotelBooking(text)) {'), true, 'a request is never ingested as a stay')

// 3. The check-out answer goes to check-out.
eq(fd.askedStayField('🏨 *Updated: Novotel*\nCheck-in Wed, 18 Nov.\n\nWhich day do you check out?'), 'checkOut', 'live: the "Updated" card asks for check-out')
eq(fd.askedStayField('🏨 *Saved: Novotel*\nBooking under Munu Jain.\n\nWhich dates is the stay?'), 'both', 'the first card still asks for both')
eq(fd.askedStayField('🏨 *Updated: Novotel*\nCheck-in Wed, 18 Nov · check-out Fri, 20 Nov.\n\nI\'ll remind you on arrival day and on the morning of check-out.'), null, 'a finished card asks nothing')
console.log(`PASS verify-demo-fixes-nov17: ${checks} checks`)
