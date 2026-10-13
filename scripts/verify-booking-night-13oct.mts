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
assert.doesNotMatch(obj, /never add|never log in|never proceed|LIVE SLOT CHECK ONLY|read-only/i, '13 Oct 14:35: "never ..." next to the booking objective made the planner refuse every step')
assert.deepEqual(PB.bookingTargetFromObjective(obj), { date: '2026-10-17', time: '7:00 AM', service: 'badminton' })
assert.match(obj, /Not The Majesstine Sports\./)
const lsSrc = readFileSync(new URL('../lib/agent/live-slots.ts', import.meta.url), 'utf8')
assert.doesNotMatch(lsSrc, /Promise\.allSettled/, 'venue checks run one after another')

// 4. Safeguards (13 Oct 01:38: after the robot check, Gogo switched to Playo's email login and a new account was started).
const loginPage = { text: '[Open dialog] Login / Sign Up Enter Mobile No * + 91 Send OTP or Email Id Google', controls: [
  { tag: 'button', selector: '#send', label: 'Send OTP' },
  { tag: 'button', selector: '#email-toggle', label: 'Email Id' },
  { tag: 'button', selector: '#google', label: 'Google' },
  { tag: 'input', type: 'email', selector: '#email', field: 'Enter email' },
  { tag: 'input', type: 'tel', selector: '#mobile', field: 'Enter Mobile No' },
  { tag: 'input', type: 'text', selector: '#help-email', field: 'Need help?', label: 'Email*' },
] }
assert.equal(SC.bookingLoginSwitchIndex([{ kind: 'click', selector: '#email-toggle' }] as any, loginPage), 0, 'never switch to email login')
assert.equal(SC.bookingLoginSwitchIndex([{ kind: 'click_text', text: 'Google' }] as any, loginPage), 0, 'never switch to Google login')
assert.equal(SC.bookingLoginSwitchIndex([{ kind: 'fill_phone', selector: '#mobile' }, { kind: 'click', selector: '#send' }, { kind: 'fill', selector: '#email', value: 'x' }] as any, loginPage), 2, 'never type an email into a login form')
assert.equal(SC.bookingLoginSwitchIndex([{ kind: 'fill_phone', selector: '#mobile' }, { kind: 'click', selector: '#send' }] as any, loginPage), -1, 'the approved mobile login is untouched')
assert.equal(SC.bookingLoginSwitchIndex([{ kind: 'click_text', text: 'Send OTP' }, { kind: 'choose', field: 'Court', value: 'first' }] as any, loginPage), -1)
assert.equal(SC.bookingAccountCreation('Thanks for creating a Playo account'), true)
assert.equal(SC.bookingAccountCreation('[Open dialog] Login / Sign Up Enter Mobile No'), false, "Playo's combined Login / Sign Up title is not account creation")
assert.equal(SC.bookingAccountCreation('Complete your profile to continue'), true)
const stopMsg = PB.bookingReviewMessage({ host: 'playo.co', takeoverUrl: 'https://x', accountCreationRefused: true })
assert.match(stopMsg, /started creating a new account instead of logging you in, so I stopped/)
assert.match(PB.bookingReviewMessage({ host: 'playo.co', takeoverUrl: 'https://x', loginSwitchRefused: true }), /don't switch to email or Google login on my own/)
assert.match(src, /bookingLoginSwitchIndex\(actions,page\)/)
assert.match(src, /bookingAccountCreation\(String\(page\?\.text\|\|''\)\)\)return await bookingStop/)

console.log('13 Oct booking night: login only by the approved mobile number, stop at account creation, code asked for even at time-out, slot prices read as prices, slot checks read-only on different venues')
