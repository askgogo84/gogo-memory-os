// 10 Nov live: "Plan Divya's birthday on 22 November at 5 pm for 20 people" on WhatsApp was answered by understand-first's
// planner: the Events hook sat in processIncomingMessage, after the brain and understand-first. These checks pin the order.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const route = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
const at = (needle: string) => { const i = route.indexOf(needle); assert.ok(i > 0, `missing: ${needle}`); return i }
const ev = at("m.tryEventAsk(eventActor, text, 'whatsapp')")
ok(ev < at("m.runBrain({ phone: from"), 'Events runs before the brain, which can answer or rewrite the message')
ok(ev < at('tryResolvePendingQuestion({'), 'and before the pending-question registry and understand-first')
ok(ev < at('tryUnderstandFirst({'), 'and before understand-first, which answered the live message')
ok(ev < at('tryProductDiscovery({ text })'), 'and before product search')
ok(ev > at('if (signatureAudit.reject)'), 'only after the signature check')
ok(ev > at('isStopMessage(') && ev > at('checkWhatsAppAccess('), 'after STOP and the access gate')
const block = route.slice(route.lastIndexOf('let eventsCheckedFor', ev), ev + 900)
ok(/!preserveFriendFlow && !callCommand && process\.env\.VERCEL_ENV && \(process\.env\.GOGO_EVENTS === '1' \|\| process\.env\.GOGO_EVENTS_OWNERS\)/.test(block), 'flag-gated, and friend flows and call commands are left alone')
ok(/if \(eventReply\) \{[\s\S]{0,300}sendWhatsAppMessage\(from, eventReply\)[\s\S]{0,200}return new NextResponse/.test(block), 'an Events reply goes only to the organizer who wrote, and stops routing')
ok(!/sendWhatsAppMessage\((?!from)/.test(block), 'nobody else is messaged from here')
ok(/eventsChecked: eventsCheckedFor === text/.test(route), 'the shared handler is told when this exact text was already offered to Events')
ok(/!params\.eventsChecked&&eventsEnv\.VERCEL_ENV/.test(pm), 'so it does not ask Events (and its model) a second time')
console.log(`EVENTS_WHATSAPP_ORDER_OK ${checks} checks`)
