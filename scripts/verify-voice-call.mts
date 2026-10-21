// Phone calls via Bolna + Plivo (approved mock "Online booking blocked: offer a call"). Pure rules + wiring.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
const v = await import('../lib/agent/voice-call')
// Numbers
assert.equal(v.indianPhoneFrom('Call +91 72599 06666 for reservations'), '+917259906666')
assert.equal(v.indianPhoneFrom('Phone: 080 4567 8901'), '+918045678901')
assert.equal(v.indianPhoneFrom('Reach us on 09876543210'), '+919876543210')
assert.equal(v.indianPhoneFrom('Open till 1AM, 4.2 rating, 2 for ₹1500'), null)
assert.equal(v.displayPhone('+918065539020'), '+91 80655 39020')
assert.equal(v.displayPhone('+917259906666'), '+91 72599 06666')
// Commands
assert.deepEqual(v.parseCallCommand('test call me'), { kind: 'test' })
assert.deepEqual(v.parseCallCommand('test call me on 8310441698'), { kind: 'test', number: '+918310441698' })
assert.equal(v.parseCallCommand('Call District 6 and book a table for 2 Saturday 8pm')?.kind, 'book')
assert.equal(v.parseCallCommand('yes call')?.kind, 'approve')
assert.equal(v.parseCallCommand('Yes, call them')?.kind, 'approve')
assert.equal(v.parseCallCommand('call again')?.kind, 'redial')
assert.equal(v.parseCallCommand('no')?.kind, 'decline')
for (const t of ['Remind me to call Divya tomorrow at 6pm', 'call me tomorrow', 'what did they say on the call', 'Cancel the reminder to call Divya'])
  assert.equal(v.parseCallCommand(t), null, t)
// Call plan: shows number, script, limits, needs an explicit yes
const plan = { venue: 'District 6', to: '+917259906666', source: 'from justdial.com', guestName: 'Goverdhan', partySize: 2, date: '2026-10-24', dateLabel: 'on Sat 24 Oct', timeLabel: '8pm',
  flexWindow: v.flexWindowLabel('20:00', (c: string) => c), seating: 'no preference', purpose: 'Book a table', test: false, redials: 0, createdAt: new Date().toISOString() }
assert.equal(plan.flexWindow, 'between 19:30 and 21:00')
const card = v.callPlanText(plan)
assert.match(card, /CALL PLAN · NEEDS YOUR YES/); assert.match(card, /\+91 72599 06666/); assert.match(card, /AI assistant from AskGogo, calling for Goverdhan/); assert.match(card, /Booking name: Goverdhan/)
assert.match(card, /Won't pay, share card details or agree to a deposit/); assert.match(card, /Reply \*yes call\*/)
// Outcomes: honest
assert.match(v.callResultText(plan, 'no-answer', null), /nobody picked up\. Nothing was booked\.[\s\S]*call again/)
assert.match(v.callResultText({ ...plan, redials: 2 }, 'busy', null), /^(?![\s\S]*call again)/)
assert.match(v.callResultText(plan, 'completed', null), /not treating it as booked/)
const booked = v.parseOutcome('{"booked":true,"confirmed_time":"8:00 pm","staff_name":"Ravi","callback_time":null,"notes":""}')!
assert.match(v.callResultText(plan, 'completed', booked), /Booked by phone.*8:00 pm.*2 guests.*Goverdhan[\s\S]*Ravi[\s\S]*not a written booking ID/)
const refused = v.parseOutcome('noise {"booked":false,"callback_time":"after 6pm","notes":"They wanted to speak to the guest directly."}')!
assert.match(v.callResultText(plan, 'completed', refused), /not booked\. They wanted to speak[\s\S]*after 6pm[\s\S]*call again/)
assert.equal(v.parseOutcome('{"booked":"yes"}')!.booked, false, 'only a literal true counts')
assert.ok(v.TERMINAL.has('completed') && v.TERMINAL.has('balance-low') && !v.TERMINAL.has('call-disconnected'), 'call-disconnected is not final')
// Agent prompt: discloses AI, never pays
assert.match(v.CALL_AGENT_PROMPT, /AI assistant from AskGogo/); assert.doesNotMatch(v.CALL_AGENT_PROMPT, /You are Gogo/); assert.match(v.CALL_AGENT_PROMPT, /do not agree to it/); assert.match(v.CALL_AGENT_PROMPT, /deposit, card, UPI, payment, OTP/)
// Wiring
const src = readFileSync(new URL('../lib/agent/voice-call.ts', import.meta.url), 'utf8')
assert.match(src, /includes\('CALL PLAN'\)/, 'a yes only binds to the plan just shown')
assert.match(src, /15 \* 60_000/, 'plans expire after 15 minutes')
const web = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
assert.ok(web.indexOf('shouldWithholdAuthenticationCode') < web.indexOf("import('@/lib/agent/voice-call')"), 'sign-in code boundary stays first')
const wa = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
assert.match(wa, /voiceMod\.tryVoiceCall/)
const cron = readFileSync(new URL('../app/api/cron/autonomous-runs/route.ts', import.meta.url), 'utf8')
assert.match(cron, /voiceMod\.processVoiceCalls\(\{send:sendWhatsApp\}\)/)
console.log('verify-voice-call: ok')
