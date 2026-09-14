import assert from 'node:assert/strict'
import fs from 'node:fs'
import { bookingDetailsFromText } from '../lib/agent/booking-closure'

const booking=bookingDetailsFromText('Your BookMyShow booking is confirmed for 20 Sep 2026 at 7:30 PM. Venue: PVR Orion. Booking ID ABC123.')
assert.ok(booking)
assert.equal(booking?.status,'confirmed')
assert.match(String(booking?.confirmationRef||''),/ABC123/)

const closure=fs.readFileSync('lib/agent/booking-closure.ts','utf8')
const calendar=fs.readFileSync('lib/agent/booking-calendar-execution.ts','utf8')
const whatsapp=fs.readFileSync('app/api/twilio/whatsapp/route.ts','utf8')
const executeRoute=fs.readFileSync('app/api/agent/approvals/execute/route.ts','utf8')

assert.match(closure,/trustedProviderUrl\(next\)/)
assert.doesNotMatch(closure,/redirect:\s*['"]follow['"]/)

assert.match(closure,/details\.status==='confirmed'\|\|details\.status==='rescheduled'/)
assert.match(closure,/details\.status==='cancelled'/)
assert.match(closure,/details\.status==='unknown'/)
assert.match(closure,/ensureReminder/)
assert.match(closure,/prepareBookingCalendarApproval/)
assert.match(closure,/booking-change-watch/)
assert.match(closure,/providerIssued:true/)
assert.match(closure,/retrieveEventCredential\(telegramId:number,requestText:string\)/)
assert.match(closure,/queryTokens\(requestText\)/)
assert.doesNotMatch(closure,/generate.*qr/i)

assert.match(calendar,/existingPending/)
assert.match(calendar,/bookingCalendarEventId/)
assert.match(calendar,/booking-life-event:/)
assert.match(calendar,/action_type:'calendar_change'/)
assert.match(calendar,/eq\('status','approved'\)/)
assert.match(calendar,/create_booking_calendar_event/)
assert.doesNotMatch(calendar,/sendUpdates=all/)

assert.match(whatsapp,/booking_event_calendar/)
assert.match(whatsapp,/executeApprovedBookingCalendar/)
assert.match(executeRoute,/booking_event_calendar/)
assert.match(executeRoute,/executeApprovedBookingCalendar/)

console.log('✅ Booking closure lifecycle regression passed')
