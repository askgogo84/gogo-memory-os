// 28 Oct live: details sent after an unrelated Gogo message were not bound to the open booking, and the chat model
// invented "Booking … IX 355 … Reply confirm to open the payment page".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'; process.env.OPENAI_API_KEY ||= 'x'
const { inventedApprovalGuard } = await import('../lib/services/claude.ts')
const invented = "Got it. Booking Air India Express IX 355, BLR → BOM, 8 Nov 2026.\n\nReply confirm to open the payment page, or cancel to stop."
assert.match(inventedApprovalGuard(invented), /nothing has been booked/)
assert.equal(inventedApprovalGuard('Bengaluru is 21°C and cloudy.'), 'Bengaluru is 21°C and cloudy.')
assert.equal(inventedApprovalGuard('Booking.com and MakeMyTrip both list it.'), 'Booking.com and MakeMyTrip both list it.')
const src = readFileSync(new URL('../lib/agent/flight-booking.ts', import.meta.url), 'utf8')
assert.ok(src.includes('const late = await lateBookingDetails(actor, text)'), 'complete details bind to the open booking from the last 2 h')
console.log('BOOKING_LATE_DETAILS_OK')
assert.ok(src.includes('const url = googleFlightsTfsUrl(last.context) || last.searchLink'), '28 Oct live: booking opened the q= link and Google used Pune as origin')
console.log('BOOKING_TFS_START_OK')
const fb = await import('../lib/agent/flight-booking.ts')
assert.deepEqual(fb.flightBookingRequest('Book the evening one'), { kind: 'time', window: 'evening' })
const opts: any[] = [{ airline: 'AI Express', departure: '12:05 PM', fareInr: 4620, stops: 1 }, { airline: 'SpiceJet', departure: '11:20 PM', fareInr: 4735, stops: 0 }, { airline: 'AI Express', departure: '5:00 PM', fareInr: 4880, stops: 0 }, { airline: 'SpiceJet', departure: '5:50 AM', fareInr: 5051, stops: 0 }]
assert.equal(fb.pickFlight(opts, { kind: 'time', window: 'evening' })?.departure, '5:00 PM', '28 Oct live: the evening one = 5:00 PM')
assert.equal(fb.pickFlight(opts, { kind: 'time', window: 'night' })?.departure, '11:20 PM')
assert.equal(fb.pickFlight(opts, { kind: 'time', window: 'earliest' })?.departure, '5:50 AM')
assert.equal(fb.pickFlight(opts, { kind: 'time', window: 'morning' })?.departure, '5:50 AM')
console.log('BOOKING_TIME_PICK_OK')
const sc = (await import('node:fs')).readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
assert.ok(/handoff[\s\S]{0,200}chromewebdata[\s\S]{0,300}edgeBlockedHosts\.push\('the airline site'\)/.test(sc), '28 Oct live: an airline hand-off ending on Chrome\'s error page falls back to an agency')
console.log('BOOKING_HANDOFF_FALLBACK_OK')
const scm = await import('../lib/agent/secure-computer.ts')
assert.equal(scm.bookingPrefersAgency({}), true, '28 Oct (owner): Indian booking sites first')
assert.equal(scm.bookingPrefersAgency({ GOGO_BOOKING_PREFER: 'airline' }), false)
const ctl = [{ selector: '#a', label: 'Continue to book with Air India Express' }, { selector: '#m', label: 'Continue to book with MakeMyTrip for ₹4,900' }, { selector: '#c', label: 'Continue to book with Cleartrip for ₹4,950' }]
assert.deepEqual(scm.googleAgencyContinueControl(ctl, []), { selector: '#c', name: 'cleartrip' })
assert.deepEqual(scm.googleAgencyContinueControl(ctl, ['cleartrip']), { selector: '#m', name: 'makemytrip' })
assert.ok(src.includes('pick a listed booking site first: Agoda'), 'objective asks for a booking site first')
console.log('BOOKING_AGENCY_FIRST_OK')
assert.deepEqual(scm.googleAgencyContinueControl([{ selector: '#g', label: 'Continue to book with Goibibo for ₹5,001' }, { selector: '#ag', label: 'Continue to book with Agoda for ₹4,915' }], []), { selector: '#ag', name: 'agoda' }, '28 Oct: Agoda first (guest checkout seen on the owner\'s phone)')
assert.ok(sc.includes("const next=onGoogle&&/^continue to book with/i.test(advanceKey(actions[repeat]))"), 'a repeated booking-site click moves to the next site')
assert.ok(sc.includes("if(f)f.setAttribute('target','_self')"), 'hand-off kept in the same tab')
const net = (await import('node:fs')).readFileSync(new URL('../lib/agent/browser-page-network.ts', import.meta.url), 'utf8')
assert.ok(net.includes("'airindiaexpress.com'") && net.includes("'agoda.com'"), 'Air India Express and Agoda reachable from the hand-off')
console.log('BOOKING_HANDOFF_SAME_TAB_OK')
