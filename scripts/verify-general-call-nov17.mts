// 17 Nov (owner): "calling should work on everything, whether it's table booking or hotel room booking or my
// hospital appointment; script should work accordingly". A table keeps its flow; any other ask gets a plan written
// from the ask, shown for an explicit yes, and a caller that only uses what the person said.
// The second half pins the independent review of PR #1534 (who gets called, what may be said).
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
  'call 9845012345 and ask if the keys are ready',
  'call the hotel on 080 2345 6789 and confirm our booking',
  'call the hotel and confirm our booking', 'call my doctor and ask about the reports', // no number: a call request that is answered with "I need their number"
  'call Sagar Clinic on 0821 2345678 and ask timings', // number typed but unreadable: still a call request, so the person is told
  'Call Toit Indiranagar on 9686567626 and book a table for 2 at 9pm on Saturday under name Divya',
]) eq(kind(yes), 'book', `call request: ${yes.slice(0, 50)}`)
for (const no of [
  'call mom and ask about Sunday lunch tomorrow', 'call the plumber and fix the tap on Saturday', 'call Divya and get the keys at 5pm', 'call mom on Sunday',
  'call amma and ask if she took her medicines at 9pm', 'call my wife and tell her I am late', 'call me and get me up at 6am', 'call the bank tomorrow at 11am',
  // Review B1: a vague callee with no number is never looked up; a time in the callee part is a note to self.
  'Call dentist tomorrow to confirm appointment', 'call the bank tomorrow to check on the loan', 'call the office at 10am and tell Nithin I will be late',
  // Review B2: a number later in the ask is not the number to dial.
  'call the plumber and tell him my number is 9845012345', 'call Nithin and ask him to pay 9845012345 on gpay',
]) eq(kind(no), null, `not a call plan (stays a reminder or chat): ${no}`)

// 2. Who and what; table vs general.
const split = (t: string) => vc.splitCallAsk(vc.stripCallBookingName(t))
eq(split('Call Novotel on 8310441698 and book a room for 2 nights on Saturday under name Munu jain'), { venue: 'Novotel', phone: '+918310441698', unreadable: false, ask: 'book a room for 2 nights on Saturday' }, 'live: who, number and what; the name tail removed')
eq(split('call Manipal Hospital and book an appointment with Dr Rao on Friday 10am'), { venue: 'Manipal Hospital', phone: null, unreadable: false, ask: 'book an appointment with Dr Rao on Friday 10am' }, 'hospital appointment')
eq(split('call Divya 9845012345 and ask if the keys are ready')?.venue, 'Divya', 'a number right after the name is not part of the name')
eq(split('call 9845012345 and ask if the keys are ready'), { venue: 'the number you gave', phone: '+919845012345', unreadable: false, ask: 'ask if the keys are ready' }, 'a bare number')
eq(split('call Novotel at 080-2345-6789, and ask for late checkout')?.venue, 'Novotel', 'number with punctuation')
eq(vc.callBookingName('call Manipal Hospital and schedule an appointment with Dr Rao under the name Divya'), 'Divya', 'the name hint on the card works for any ask (review D4)')
eq([vc.genericCallee('the hotel'), vc.genericCallee('my doctor'), vc.genericCallee('school'), vc.genericCallee('Manipal Hospital'), vc.genericCallee('Dr Rao')], [true, true, true, false, false], 'vague vs named callee')
for (const table of ['book a table for 2 at 9pm on Saturday', 'reserve a table for 6 tomorrow 8pm', 'book for 4 Saturday 8pm', 'book a private room for 10 Saturday 8pm',
  "book for 4 Saturday 8pm, it is my doctor friend's birthday", 'book dinner for 2 after my class at 8pm']) eq(vc.isTableAsk(table), true, `table flow: ${table}`)
for (const other of ['book a deluxe double sea-facing room for 2 nights', 'book a 2pm appointment', "book Dr Rao's appointment for Friday", 'book a complete blood count test', 'book a full body health checkup', 'book a follow-up', 'book 2 nights from Saturday', 'book a private room for 2 nights', 'book a table tennis court', 'book Saturday 8pm', 'book a room for 2 nights on Saturday', 'book an appointment with Dr Rao on Friday 10am', 'ask if the OPD is open on Sunday', 'reschedule my haircut to Saturday 11am', 'book a cab for 6am tomorrow',
  'cancel my booking for Friday', 'book a deluxe suite for Friday', 'book an ambulance', 'book a spa treatment for Saturday 5pm', 'book a meeting room for 10 on Friday'])
  eq(vc.isTableAsk(other), false, `general call: ${other}`)

// 3. Who gets called (both reviews): only a number the person gave, read whole or not at all. Nothing is looked up.
const cp = (s: string) => vc.calleeParts(s)
eq(cp('Novotel on 8310441698'), { name: 'Novotel', phone: '+918310441698', unreadable: false }, 'mobile')
eq([cp('Novotel 080 2345 6789 Bangalore').phone, cp('Divya +91-98450 12345').phone, cp('Taj 044-2345 6789').phone], ['+918023456789', '+919845012345', '+914423456789'], 'landline with STD code, +91 form')
for (const bad of ['Sagar Clinic on 0821 2345678', 'Novotel on 98450 1234', 'Airtel on 1800 123 4567', 'Novotel on 984501234567', 'Manipal Hospital on 9845012345 or 9845012346'])
  eq([cp(bad).phone, cp(bad).unreadable], [null, true], `unreadable, never guessed or replaced: ${bad}`)
eq([cp('Manipal Hospital').phone, cp('Manipal Hospital').unreadable], [null, false], 'no number typed')
const vsrc = readFileSync('lib/agent/voice-call.ts', 'utf8')
ok(vsrc.includes("if (general.unreadable) return { text: `I couldn't read the phone number in that message") && vsrc.includes("if (!general.phone) {") && !/findNamedPhone|pickNamedPhone/.test(vsrc), 'general calls never look up a number on the web; owner supplies one on the plan or in a follow-up')
ok(/ v[2-9]$/.test(vc.GENERAL_CALL_AGENT_NAME), 'the general agent has a new name, so an agent made from an earlier draft is never reused (v3 on 21 Nov: phone menus)')

// 4. The brief: a faithful restatement or the person's own words (review B3, D2).
const ask = 'book an appointment with Dr Rao on Friday 10am'
eq(vc.fallbackCallBrief(ask, 'Divya'), { task: 'For Divya: book an appointment with Dr Rao on Friday 10am.', opening: "I'm calling for Divya to book an appointment with Dr Rao on Friday 10am.", details: 'only what is in the request' }, 'fallback uses the person\'s own words')
eq(vc.fallbackCallBrief('tell them I will be late', 'Divya').opening, 'I have a message from Divya: I will be late.', 'a message is passed on as a message')
eq(vc.fallbackCallBrief('let them know I am running late', 'Divya').opening, 'I have a message from Divya: I am running late.', 'let them know …')
eq(vc.fallbackCallBrief('tell Dr Rao I will be late', 'Divya').opening, 'I have a message from Divya for Dr Rao: I will be late.', 'who the message is for is kept')
eq(vc.fallbackCallBrief('ask them to call me back', 'Divya').opening, "I'm calling for Divya to ask them to call Divya back.", '"me" is the person')
eq(vc.fallbackCallBrief('get my reports at 5pm', 'Divya').opening, "I'm calling for Divya to get their reports at 5pm.", '"my" is the person, not the caller')
eq(vc.fallbackCallBrief('confirm our booking', 'Divya').opening, "I'm calling for Divya to confirm their booking.", '"our" too')
const acc = (o: object) => vc.acceptCallBrief(JSON.stringify(o), ask, 'Manipal Hospital', 'Divya')
const good = { task: 'Book an appointment with Dr Rao on Friday 10am', opening: "I'm calling for Divya to book an appointment with Dr Rao on Friday 10am", details: ['Dr Rao', 'Friday', '10am'] }
eq(acc(good), { task: 'Book an appointment with Dr Rao on Friday 10am.', opening: "I'm calling for Divya to book an appointment with Dr Rao on Friday 10am.", details: 'Dr Rao; Friday; 10am' }, 'a faithful brief is used')
eq(acc({ ...good, opening: "I'd like to book an appointment with Dr Rao on Friday at 10 am" }) !== null, true, '"10 am" is the same time as "10am"')
for (const [why, bad] of [
  ['invented number', { ...good, details: ['Dr Rao', 'Friday', '10am', 'Age 42'] }],
  ['different doctor and day, am turned into pm, symptoms', { task: 'Book an urgent appointment with Dr Sharma on Thursday at 10pm for severe chest pain', opening: "I'd like to book an appointment with Dr Sharma on Thursday at 10pm", details: ['chest pain'] }],
  ['invented patient', { ...good, opening: "I'd like to book an appointment for my wife with Dr Rao on Friday 10am" }],
  ['reversed intent', { task: 'Cancel the appointment with Dr Rao on Friday 10am', opening: "I'm calling for Divya to cancel the appointment with Dr Rao on Friday 10am", details: [] }],
  ['money and ID talk', { ...good, details: ['will transfer the consultation fee by bank', 'will share Aadhaar'] }],
  ['"urgent" added', { ...good, task: 'Book an urgent appointment with Dr Rao on Friday 10am' }],
  ['doctor and day dropped', { task: 'Book an appointment.', opening: "I'd like to book an appointment", details: [] }],
  ['not in the caller\'s voice', { ...good, opening: 'Hello there, appointment with Dr Rao on Friday 10am please' }],
] as [string, object][]) eq(acc(bad), null, `refused: ${why}`)
eq(vc.acceptCallBrief(JSON.stringify({ task: 'Book 2 rooms for 2 guests for 2 nights from Saturday', opening: "I'd like to book 2 rooms for 2 guests for 2 nights from Saturday", details: ['2 adults'] }), 'book a room for 2 nights on Saturday', 'Novotel', 'Divya'), null, 'reusing a number with a new meaning (guests, adults) is refused')
const flip = (askText: string, task: string, opening: string) => vc.acceptCallBrief(JSON.stringify({ task, opening, details: [] }), askText, 'Novotel', 'Divya')
eq(flip("tell them I can't come on Friday", 'Tell them I can come on Friday', "I'd like to tell them I can come on Friday"), null, 'a dropped "can\'t" is refused')
eq(flip('book a room without breakfast', 'Book a room with breakfast', "I'd like to book a room with breakfast"), null, '"without" turned into "with" is refused')
eq(flip('book 2 rooms for 3 nights', 'Book 3 rooms for 2 nights', "I'd like to book 3 rooms for 2 nights"), null, 'swapped numbers are refused')
eq(flip('book a room for 2 nights', 'Book 2 rooms for 2 nights', "I'd like to book 2 rooms for 2 nights"), null, 'a doubled number is refused')
eq(flip('reschedule my booking from Friday to Monday', 'Reschedule my booking from Monday to Friday', "I'd like to reschedule my booking from Monday to Friday"), null, 'reversed days are refused')
eq(flip('ask if a room is available on Friday', 'Ask to confirm a room on Friday', "I'd like to confirm a room on Friday"), null, 'a question upgraded to a booking is refused')
eq(flip('book a room for 2 nights on Saturday', 'Book a room for 2 nights on Saturday', "I'd like to book a room for 2 nights on Saturday") !== null, true, 'the faithful version of the same ask is used')
eq(vc.acceptCallBrief('sorry, I cannot', ask), null, 'no JSON: refused')
eq(await vc.compileCallAsk(ask, 'Manipal Hospital', 'Divya', async () => JSON.stringify({ ...good, details: ['Age 42'] })), vc.fallbackCallBrief(ask, 'Divya'), 'a refused brief falls back to the person\'s words')
eq(await vc.compileCallAsk(ask, 'Manipal Hospital', 'Divya', async () => { throw new Error('down') }), vc.fallbackCallBrief(ask, 'Divya'), 'model down: fallback')
eq((await vc.compileCallAsk(ask, 'Manipal Hospital', 'Divya', async () => JSON.stringify(good))).details, 'Dr Rao; Friday; 10am', 'model brief used when faithful')

// 22 Nov handoff: salon, hotel and clinic *script* acceptance is synthetic only.
// These do not dial, book, send or exercise Bolna; owner-supervised live acceptance is still pending.
// If a model invents a payment, reservation or medical appointment while drafting an enquiry,
// the caller must fall back to the owner's exact words rather than silently upgrading the action.
for (const scenario of [
  { venue: 'Bounce Salon', guest: 'Nithin', ask: 'book a haircut tomorrow at 6pm', invented: 'book a haircut and pay a deposit tomorrow at 6pm' },
  { venue: 'Novotel', guest: 'Divya', ask: 'ask if early check-in is possible on Friday', invented: 'book and prepay a suite on Friday' },
  { venue: 'Apollo Clinic', guest: 'Divya', ask: 'ask if the clinic is open on Sunday', invented: 'book a consultation and share medical records on Sunday' },
]) {
  const fallback = vc.fallbackCallBrief(scenario.ask, scenario.guest)
  eq(fallback.details, 'only what is in the request', scenario.venue + ': details are bounded to the owner ask')
  ok(fallback.task.includes(scenario.ask) && fallback.opening.includes(scenario.ask),
    scenario.venue + ': fallback preserves the actual owner task and avoids a new booking')
  const modelBrief = await vc.compileCallAsk(scenario.ask, scenario.venue, scenario.guest, async () =>
    JSON.stringify({ task: scenario.invented, opening: "I'm calling for " + scenario.guest + ' to ' + scenario.invented, details: [] }))
  eq(modelBrief, fallback, scenario.venue + ': fabricated model additions cannot enter the call script')
}

// 5. The plan card, the approval binding, and what the caller is given.
const plan: any = { venue: 'Manipal Hospital', to: '+918025024444', source: 'the number you gave', guestName: 'Divya', partySize: null, date: null, dateLabel: '', timeLabel: '', flexWindow: '', seating: '',
  purpose: 'Book an appointment with Dr Rao on Friday 10am.', opening: "I'm calling for Divya to book an appointment with Dr Rao on Friday 10am.", details: 'Dr Rao; Friday; 10am', kind: 'general', test: false, redials: 0, createdAt: '2026-11-17T11:00:00.000Z' }
const card = vc.callPlanText(plan)
ok(card.startsWith('*CALL PLAN · NEEDS YOUR YES*') && card.includes('To: Manipal Hospital · ') && card.includes('(the number you gave)'), 'card shows who and the number the person gave')
ok(card.includes('"Hi, I\'m an AI assistant from AskGogo, calling for Divya. I\'m calling for Divya to book an appointment with Dr Rao on Friday 10am."') && card.includes("What I'll do: Book an appointment with Dr Rao on Friday 10am.") && card.includes('Details I may share: Dr Rao; Friday; 10am.') && !/table for/i.test(card), 'card shows the exact opening, task and details, and no table script')
ok(/Won't pay, share card details or OTPs/.test(card) && /I won't give your phone number either/.test(card) && card.endsWith('Reply *yes call* to place it, or *no* to skip.'), 'limits (review B4) and the explicit yes')
ok(voicePlanHash('-1', plan) !== voicePlanHash('-1', { ...plan, opening: 'I am calling to cancel.' }) && voicePlanHash('-1', plan) !== voicePlanHash('-1', { ...plan, details: 'x' }) && voicePlanHash('-1', plan) !== voicePlanHash('-1', { ...plan, kind: 'table' }), 'the yes is bound to the opening, details and kind shown')
const table: any = { venue: 'Toit', to: '+919686567626', source: 'the number you gave', guestName: 'Divya', partySize: 2, date: '2026-11-21', dateLabel: 'on Sat 21 Nov', timeLabel: '9pm', flexWindow: 'between 8:30pm and 10pm', seating: 'no preference', purpose: 'Book a table for 2 people at Toit.', test: false, redials: 0, createdAt: 'x' }
ok(vc.callPlanText(table).includes('Could I book a table for 2 on Sat 21 Nov at 9pm?'), 'the table card is unchanged')
// placeCall with a fake provider: nothing is dialled; this reads what the voice agent would be handed.
const sent: any[] = []
const fakeFetch: any = async (url: string, init: any) => { sent.push({ url, body: init?.body ? JSON.parse(init.body) : null }); return { ok: true, text: async () => JSON.stringify(String(url).endsWith('/v2/agent/all') ? [{ agent_name: vc.GENERAL_CALL_AGENT_NAME, id: 'G1' }, { agent_name: vc.CALL_AGENT_NAME, id: 'T1' }] : { execution_id: 'e1' }) } }
process.env.BOLNA_API_KEY = 'test'; delete process.env.BOLNA_AGENT_ID; delete process.env.BOLNA_GENERAL_AGENT_ID
eq(await vc.placeCall(plan, '+919999900000', fakeFetch), 'e1', 'general call placed through the fake provider')
const body = sent.find(s => String(s.url).endsWith('/call'))?.body
eq([body.agent_id, body.recipient_phone_number], ['G1', '+918025024444'], 'the general agent, the approved number')
eq(body.user_data, { venue: 'Manipal Hospital', guest_name: 'Divya', purpose: plan.purpose, opening: plan.opening, details: plan.details, timezone: 'Asia/Kolkata' }, 'the caller is handed exactly what is on the card: no phone number of the person, no table fields')
ok(/Start by saying exactly: \{opening\}/.test(vc.GENERAL_CALL_AGENT_PROMPT) && /Never guess or invent a fact/.test(vc.GENERAL_CALL_AGENT_PROMPT) && /do not agree to it/.test(vc.GENERAL_CALL_AGENT_PROMPT) && /You do not have \{guest_name\}'s phone number/.test(vc.GENERAL_CALL_AGENT_PROMPT), 'general agent rules (review D1, B4)')

// 6. After the call.
const done = vc.callResultText(plan, 'completed', vc.parseOutcome('{"done":true,"confirmed":"Dr Rao, Friday 10:15 am","staff_name":"Nithin","notes":"ok"}'))
ok(done.startsWith('*Call done* · Manipal Hospital') && done.includes('They said: Dr Rao, Friday 10:15 am') && done.includes('Spoke to Nithin.') && done.includes('not a written confirmation') && !/My bookings|guests|booked/i.test(done), 'done: says what was said, no table wording')
const unclear = vc.callResultText(plan, 'completed', vc.parseOutcome('{"done":false,"confirmed":null,"notes":"They put the call on hold.","callback_time":"after 4 pm"}'))
ok(/no clear answer\. They put the call on hold\./.test(unclear) && /called back after 4 pm/.test(unclear) && /call again/.test(unclear), 'unclear: honest, with the callback and a retry')
ok(/Nothing was said or agreed\./.test(vc.callResultText(plan, 'busy', null)) && !/booked/.test(vc.callResultText(plan, 'busy', null)), 'a failed general call has no booking wording (review D5)')
eq(vc.parseOutcome('{"booked":true,"confirmed_time":"9:00 pm","staff_name":"A","notes":"x"}')?.confirmedTime, '9:00 pm', 'table outcome unchanged')
const src = readFileSync('lib/agent/voice-call.ts', 'utf8')
ok(src.includes("&& plan.kind !== 'general') saved = await recordPhoneBooking("), 'a general call is never saved as a table booking')
ok(/a clear no or not available is still an answer/.test(src), 'an answered enquiry counts as done, so it does not invite redials')
// The route gate uses the parser (21 Nov: through isCallRequestFor, which asks the parser first and adds only venues
// called before), so ordinary "call mom and ask…" keeps the brain (review B5).
for (const route of ['app/api/webhooks/whatsapp/route.ts', 'app/api/dashboard/chat/route.ts']) {
  const r = readFileSync(route, 'utf8')
  ok(/\(\?:and\|to\)\\s\+\(\?:book\|reserve\)\\b\|\(\?:yes/.test(r) && /(?:parseCallCommand\(text\)\?\.kind\s*===\s*'book'|isCallRequestFor\(String\([^)]+\),\s*text\))/.test(r), `${route}: the call gate is the old pattern or the parser's own answer`)
}
console.log(`PASS verify-general-call-nov17: ${checks} checks`)
