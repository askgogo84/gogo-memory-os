import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 01:34 live run (Machaxi Milan, Sat 7 AM) and the live-slot check before it.
// Run: npx tsx scripts/verify-booking-night-13oct.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
const SC = await import('../lib/agent/secure-computer')
const PB = await import('../lib/agent/provider-booking')
const LS = await import('../lib/agent/live-slots')

// 1. Playo's email login: "Verify Enter OTP goverdhan.md@gmail.com (Edit) VERIFY Resend OTP in 29 sec"
const page = '[Open dialog] Verify Enter OTP someone@example.com (Edit) VERIFY Resend OTP in 29 sec Games Venues'
assert.equal(PB.bookingOtpPrompt({ text: page }), true)
assert.equal(SC.otpChannelOf(page), 'email')
assert.equal(SC.otpChannelOf('[Open dialog] Verify Enter OTP sent to +91 98•••01 Resend OTP'), 'sms')
const msg = PB.bookingOtpMessage({ host: 'playo.co', mobile: '+919999999999', takeoverUrl: 'https://x', channel: 'email' })
assert.match(msg, /sent a login code \(OTP\) to your email/)
assert.doesNotMatch(msg, /SMS/)
const src = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
const budget = src.slice(src.indexOf('Date.now()-bookingStartedAt>BOOKING_BUDGET_MS){'), src.indexOf("Gogo ran out of time before the payment step."))
assert.match(budget, /bookingOtpPrompt\(page\)[^\n]*bookingStop\('otp'/, 'a code screen at time-out asks for the code')

// 2. Live slots: the price shown on its own line is the courts' price, not a third court.
assert.deepEqual(LS.slotItems(['Premium Hybrid Court 5', 'Premium Hybrid Court 6', 'INR 450']), { courts: ['Premium Hybrid Court 5', 'Premium Hybrid Court 6'], shared: '₹450' })
const req = { listUrl: '', date: '2026-10-17', time: '7:00 AM', timezone: 'Asia/Kolkata', service: 'badminton', location: 'HSR Layout' }
const text = LS.liveSlotMessage(req, [{ venue: 'The Majesstine Sports, HSR Layout', options: ['Premium Hybrid Court 5', 'Premium Hybrid Court 6', 'INR 450'], none: false, checked: true }])
assert.match(text, /2 open: Premium Hybrid Court 5, Premium Hybrid Court 6 \(₹450 each\)/)

// 3. The slot-check objective no longer says "add to cart / continue to the cart" (the planner refused twice),
//    still parses date, time and service, and tells later checks which venue is covered.
const obj = LS.liveSlotObjective(req, 1, ['The Majesstine Sports'])
assert.doesNotMatch(obj, /add one court to the cart|until the booking summary or cart is shown|fill_phone/)
assert.deepEqual(PB.bookingTargetFromObjective(obj), { date: '2026-10-17', time: '7:00 AM', service: 'badminton' })
assert.match(obj, /Do not open The Majesstine Sports; pick a different venue\./)
const lsSrc = readFileSync(new URL('../lib/agent/live-slots.ts', import.meta.url), 'utf8')
assert.doesNotMatch(lsSrc, /Promise\.allSettled/, 'venue checks run one after another')

console.log('13 Oct booking night: email OTP is asked for (even at time-out), slot prices read as prices, slot checks are read-only and cover different venues')
