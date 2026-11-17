// 17 Nov (owner): "calling should work on everything, whether it's table booking or hotel room booking or my
// hospital appointment; script should work accordingly". A table keeps its flow; any other ask gets a plan written
// from the ask, shown for an explicit yes, and a caller that only uses what the person said.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const vc = await import('../lib/agent/voice-call.ts')
const { voicePlanHash } = await import('../lib/agent/voice-call-execution.ts')
let checks = 0
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const kind = (t: string) => vc.parseCallCommand(t)?.kind ?? null

// 1. What counts as a call request.
for (const yes of [
  'Call Novotel on 8310441698 and book a room for 2 nights on Saturday under name Munu jain',
  'call Manipal Hospital and book an appointment with Dr Rao on Friday 10am',
  'Call Apollo Clinic and ask if the orthopaedic OPD is open on Sunday',
  'call Novotel hotel and check if early check-in is possible on 18 November',
  'call Bounce Salon and reschedule my haircut to Saturday 11am',
  'call Divya on 9845012345 and ask if the keys are ready',
  'Call Toit Indiranagar on 9686567626 and book a table for 2 at 9pm on Saturday under name Divya',
]) eq(kind(yes), 'book', `call request: ${yes.slice(0, 50)}`)
for (const no of [
  'call mom and ask about Sunday lunch tomorrow', 'call the plumber and fix the tap on Saturday', 'call Divya and get the keys at 5pm', 'call mom on Sunday',
  'call amma and ask if she took her medicines at 9pm', 'call my wife and tell her I am late', 'call me and get me up at 6am', 'call the bank tomorrow at 11am',
]) eq(kind(no), null, `not a call plan (stays a reminder or chat): ${no}`)

// 2. Table vs general.
const split = (t: string) => vc.splitCallAsk(vc.stripCallBookingName(t))
eq(split('Call Novotel on 8310441698 and book a room for 2 nights on Saturday under name Munu jain'), { venue: 'Novotel', ask: 'book a room for 2 nights on Saturday' }, 'live: who and what, number and name removed')
eq(split('call Manipal Hospital and book an appointment with Dr Rao on Friday 10am'), { venue: 'Manipal Hospital', ask: 'book an appointment with Dr Rao on Friday 10am' }, 'hospital appointment')
for (const table of ['book a table for 2 at 9pm on Saturday', 'reserve a table for 6 tomorrow 8pm', 'book for 4 Saturday 8pm', 'book a private room for 10 Saturday 8pm']) eq(vc.isTableAsk(table), true, `table flow: ${table}`)
for (const other of ['book a room for 2 nights on Saturday', 'book an appointment with Dr Rao on Friday 10am', 'ask if the OPD is open on Sunday', 'reschedule my haircut to Saturday 11am', 'book a cab for 6am tomorrow', 'cancel my booking for Friday', 'book a deluxe suite for Friday'])
  eq(vc.isTableAsk(other), false, `general call: ${other}`)

// 3. The brief: only what the person said.
const ask = 'book an appointment with Dr Rao on Friday 10am'
eq(vc.fallbackCallBrief(ask), { task: 'Book an appointment with Dr Rao on Friday 10am.', opening: "I'm calling to book an appointment with Dr Rao on Friday 10am.", details: 'only what is in the request' }, 'fallback uses the person\'s own words')
const good = '{"task":"Book an appointment with Dr Rao on Friday at 10am","opening":"I\'d like to book an appointment with Dr Rao for Friday at 10am","details":["Doctor: Dr Rao","Friday","10am"]}'
eq(vc.acceptCallBrief(good, ask), { task: 'Book an appointment with Dr Rao on Friday at 10am.', opening: "I'd like to book an appointment with Dr Rao for Friday at 10am.", details: 'Doctor: Dr Rao; Friday; 10am' }, 'a faithful brief is used')
eq(vc.acceptCallBrief(good.replace('10am"]', '10am","Age 42"]'), ask), null, 'a number the person never said is refused (invented age)')
eq(vc.acceptCallBrief(good.replace('Friday at 10am","opening', 'Friday 20 November at 10am","opening'), ask), null, 'an invented date is refused')
eq(vc.acceptCallBrief(good.replace('"Friday","10am"', '"Will pay by card"'), ask), null, 'payment talk the person did not ask for is refused')
eq(vc.acceptCallBrief('sorry, I cannot', ask), null, 'no JSON: refused')
eq(await vc.compileCallAsk(ask, 'Manipal Hospital', async () => good.replace('10am"]', '10am","Age 42"]')), vc.fallbackCallBrief(ask), 'a refused brief falls back to the person\'s words')
eq(await vc.compileCallAsk(ask, 'Manipal Hospital', async () => { throw new Error('down') }), vc.fallbackCallBrief(ask), 'model down: fallback')
eq((await vc.compileCallAsk(ask, 'Manipal Hospital', async () => good)).opening, "I'd like to book an appointment with Dr Rao for Friday at 10am.", 'model brief used when faithful')

// 4. The plan card and the approval binding.
const plan: any = { venue: 'Manipal Hospital', to: '+918310441698', source: 'the number you gave', guestName: 'Divya', partySize: null, date: null, dateLabel: '', timeLabel: '', flexWindow: '', seating: '',
  purpose: 'Book an appointment with Dr Rao on Friday at 10am.', opening: "I'd like to book an appointment with Dr Rao for Friday at 10am.", details: 'Doctor: Dr Rao; Friday; 10am', kind: 'general', test: false, redials: 0, createdAt: '2026-11-17T11:00:00.000Z' }
const card = vc.callPlanText(plan)
ok(card.startsWith('*CALL PLAN · NEEDS YOUR YES*') && card.includes('To: Manipal Hospital · ') && card.includes('"Hi, I\'m an AI assistant from AskGogo, calling for Divya. I\'d like to book an appointment with Dr Rao for Friday at 10am."'), 'card shows who, the number and the exact opening')
ok(card.includes("What I'll do: Book an appointment with Dr Rao on Friday at 10am.") && card.includes('Details I may share: Doctor: Dr Rao; Friday; 10am.') && !/table for/i.test(card), 'card shows the task and details, and no table script')
ok(/Won't pay, share card details or OTPs/.test(card) && card.endsWith('Reply *yes call* to place it, or *no* to skip.'), 'limits and the explicit yes')
ok(voicePlanHash('-1', plan) !== voicePlanHash('-1', { ...plan, opening: 'I am calling to cancel.' }) && voicePlanHash('-1', plan) !== voicePlanHash('-1', { ...plan, details: 'x' }) && voicePlanHash('-1', plan) !== voicePlanHash('-1', { ...plan, kind: 'table' }), 'the yes is bound to the opening, details and kind shown')
const table: any = { venue: 'Toit', to: '+919686567626', source: 'the number you gave', guestName: 'Divya', partySize: 2, date: '2026-11-21', dateLabel: 'on Sat 21 Nov', timeLabel: '9pm', flexWindow: 'between 8:30pm and 10pm', seating: 'no preference', purpose: 'Book a table for 2 people at Toit.', test: false, redials: 0, createdAt: 'x' }
ok(vc.callPlanText(table).includes('Could I book a table for 2 on Sat 21 Nov at 9pm?'), 'the table card is unchanged')

// 5. After the call.
eq(vc.parseOutcome('{"done":true,"confirmed":"Dr Rao, Friday 10:15 am, token 12","staff_name":"Nithin","callback_time":null,"notes":"Appointment given."}')?.booked, true, 'general outcome read')
const done = vc.callResultText(plan, 'completed', vc.parseOutcome('{"done":true,"confirmed":"Dr Rao, Friday 10:15 am","staff_name":"Nithin","notes":"ok"}'))
ok(done.startsWith('*Done by phone* · Manipal Hospital') && done.includes('They confirmed: Dr Rao, Friday 10:15 am') && done.includes('Spoke to Nithin.') && done.includes('not a written confirmation') && !/My bookings|guests/.test(done), 'done: says what was confirmed, no table wording')
const notDone = vc.callResultText(plan, 'completed', vc.parseOutcome('{"done":false,"confirmed":null,"notes":"Dr Rao is not available on Friday.","callback_time":"after 4 pm"}'))
ok(/not confirmed\. Dr Rao is not available on Friday\./.test(notDone) && /called back after 4 pm/.test(notDone) && /call again/.test(notDone), 'not done: honest, with the callback and a retry')
eq(vc.parseOutcome('{"booked":true,"confirmed_time":"9:00 pm","staff_name":"A","notes":"x"}')?.confirmedTime, '9:00 pm', 'table outcome unchanged')
const src = readFileSync('lib/agent/voice-call.ts', 'utf8')
ok(src.includes("&& plan.kind !== 'general') saved = await recordPhoneBooking("), 'a general call is never saved as a table booking')
ok(src.includes("ensureCallAgent(fetchImpl, plan.kind === 'general' ? 'general' : 'table')") && /Never guess or invent a fact/.test(vc.GENERAL_CALL_AGENT_PROMPT) && /do not agree to it/.test(vc.GENERAL_CALL_AGENT_PROMPT), 'general calls use the general agent, which may not invent or agree to payment')
ok(!src.includes("can't book a hotel room by phone yet"), 'the room refusal is gone: a room is now a general call')
console.log(`PASS verify-general-call-nov17: ${checks} checks`)
