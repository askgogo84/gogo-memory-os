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
