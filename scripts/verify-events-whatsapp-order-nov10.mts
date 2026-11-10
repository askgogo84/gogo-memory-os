// 10 Nov live: "Plan Divya's birthday on 22 November at 5 pm for 20 people" on WhatsApp was answered by understand-first's
// planner: the Events hook sat in processIncomingMessage, after the brain and understand-first. These checks pin the order.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const route = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
const at = (needle: string) => { const i = route.indexOf(needle); assert.ok(i > 0, `missing: ${needle}`); return i }
const ev = at("entry.tryEventAsk(eventActor, text, 'whatsapp')")
ok(ev < at("m.runBrain({ phone: from"), 'Events runs before the brain, which can answer or rewrite the message')
ok(ev < at('tryResolvePendingQuestion({'), 'and before the pending-question registry and understand-first')
ok(ev < at('tryUnderstandFirst({'), 'and before understand-first, which answered the live message')
ok(ev < at('tryProductDiscovery({ text })'), 'and before product search')
ok(ev > at('if (signatureAudit.reject)'), 'only after the signature check')
ok(ev > at('isStopMessage(') && ev > at('checkWhatsAppAccess('), 'after STOP and the access gate')
const block = route.slice(route.lastIndexOf('let eventsCheckedFor', ev), ev + 900)
ok(/entry\.offerEventsEarly\(\{ owner: String\(resolvedUser\.telegramId\), text, forwarded: Boolean\(forwardedMessage\), approval: Boolean\(approvalIntent\(text\)\), reservation: isRestaurantReservationRequest\(text\) \|\| isSportsVenueRequest\(text\) \}\)/.test(block) && block.indexOf('offerEventsEarly(') < block.indexOf('resolveAgentActor('), 'the early offer is decided before any database read, from owner, forwarding and approval')
ok(/!preserveFriendFlow && !callCommand && process\.env\.VERCEL_ENV && \(process\.env\.GOGO_EVENTS === '1' \|\| process\.env\.GOGO_EVENTS_OWNERS\)/.test(block), 'flag-gated, and friend flows and call commands are left alone')
ok(/if \(eventReply\) \{[\s\S]{0,300}sendWhatsAppMessage\(from, eventReply\)[\s\S]{0,200}return new NextResponse/.test(block), 'an Events reply goes only to the organizer who wrote, and stops routing')
ok(!/sendWhatsAppMessage\((?!from)/.test(block), 'nobody else is messaged from here')
ok(/eventsChecked: eventsCheckedFor === text/.test(route), 'the shared handler is told when this exact text was already offered to Events')
ok(/!params\.eventsChecked&&eventsEnv\.VERCEL_ENV/.test(pm), 'so it does not ask Events (and its model) a second time')
// Behaviour of the early rule (the owner is configured; nothing else is touched).
process.env.GOGO_EVENTS_OWNERS = '-884501501'
const { offerEventsEarly } = await import('../lib/events/entry.ts')
const O = '-884501501', base = { owner: O, forwarded: false, approval: false }
ok(offerEventsEarly({ ...base, text: "Plan Divya's birthday on 22 November at 5 pm for 20 people" }), 'the live message is offered to Events first')
ok(offerEventsEarly({ ...base, text: 'How many people are coming to the party?' }), 'and a question about the event')
for (const [t, why] of [['5 pm', 'a time meant for another question'], ['2', 'a bare number picking an option'], ['#1', 'a numbered pick'], ['yes', "a yes (Events' own yes goes to the later hook, after approvals)"], ['Toit Indiranagar', 'a reply to the draft (later hook, after the registry)']] as const)
  ok(!offerEventsEarly({ ...base, text: t }), `not offered early: ${why}`)
ok(!offerEventsEarly({ ...base, text: "You're invited to Nithin's birthday party, RSVP by Friday", forwarded: true }), 'a forwarded invitation is not read as the person planning their own event')
ok(!offerEventsEarly({ ...base, text: 'approve the party booking', approval: true }), 'an approval reply goes to approvals')
ok(!offerEventsEarly({ ...base, owner: '12345', text: "Plan Divya's birthday" }), 'anyone not in GOGO_EVENTS_OWNERS is not offered (and costs no database read)')
{ const { isRestaurantReservationRequest } = await import('../lib/agent/restaurant-reservation.ts'); const { isSportsVenueRequest } = await import('../lib/agent/appointment-research.ts')
  const viaRoute = (t: string) => offerEventsEarly({ ...base, text: t, reservation: isRestaurantReservationRequest(t) || isSportsVenueRequest(t) })
  for (const t of ['book a table for 6 guests at Toit', 'book a table at Toit for my birthday dinner Saturday for 8'])
    ok(isRestaurantReservationRequest(t) && !viaRoute(t), `a table booking keeps its own handler: "${t}"`)
  ok(viaRoute("Plan Divya's birthday on 22 November at 5 pm for 20 people"), 'the live planning message is still offered first') }
console.log(`EVENTS_WHATSAPP_ORDER_OK ${checks} checks`)
