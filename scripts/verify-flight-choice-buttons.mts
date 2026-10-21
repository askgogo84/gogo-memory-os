import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
// 14 Oct: the flight questions should be taps (one way / round trip, cabin, people, time of day), not typed answers.
// Run: npx tsx scripts/verify-flight-choice-buttons.mts
function load(file: string, mocks: Record<string, any>, env: Record<string, string> = {}) {
  const module = { exports: {} as any }
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, console: { log() {}, error() {}, warn() {} }, process: { env }, Promise, JSON, Map, Error, String, Number, Date, setTimeout, URL,
      require(name: string) { if (name in mocks) return mocks[name]; throw new Error(`Unmocked: ${name}`) } })
  return module.exports
}
const choices = load('lib/agent/flight-choices.ts', {})

// ---- the sender: tap message first, plain text if the tap message cannot be sent -------------------
const sent: any[] = []
let failChoice = false
const channel = (extra: Record<string, any> = {}) => load('lib/channels/whatsapp.ts', {
  '@/lib/whatsapp': {
    sendWhatsApp: async (...args: any[]) => { sent.push(['text', ...args]) },
    sendWhatsAppCalendarApprovalButtons: async () => { sent.push(['calendar']) },
    sendWhatsAppChoice: async (...args: any[]) => { if (failChoice) throw new Error('content_api_down'); sent.push(['choice', ...args]) },
    sendWhatsAppTypingIndicator: async () => {},
  },
  '@/lib/agent/flight-choices': choices, ...extra,
})
const wa = channel()
const question = 'Bengaluru to Singapore on 27 Oct 2026.\n\nOne-way or round trip?\n\nOr say go and I\'ll search 1 adult, economy, one-way, any departure time.'
await wa.sendWhatsAppMessage('+15555550101', question)
assert.equal(JSON.stringify(sent.pop()), JSON.stringify(['choice', '+15555550101', 'trip', 'Bengaluru to Singapore on 27 Oct 2026. One-way or round trip?', [{ title: 'One way' }, { title: 'Round trip' }]]))
await wa.sendWhatsAppMessage('+15555550101', 'Bengaluru to Singapore on 27 Oct 2026.\n\n' + choices.FLIGHT_CHOICES.time.question + '\n\nOr say go.')
const timeSend = sent.pop()
assert.equal(timeSend[2], 'time'); assert.equal(timeSend[4].length, 5)
failChoice = true
await wa.sendWhatsAppMessage('+15555550101', question)
assert.equal(JSON.stringify(sent.pop()), JSON.stringify(['text', '+15555550101', question]), 'if the tap message fails the same question goes as text')
failChoice = false
await wa.sendWhatsAppMessage('+15555550101', 'Flight task completed · BLR to SIN\n\n1. IndiGo · 6:30 AM')
assert.equal(sent.pop()[0], 'text', 'results and everything else stay plain text')
await wa.sendWhatsAppMessage('+15555550101', 'Please send the departure city, travel date together so I can compare the right flights.')
assert.equal(sent.pop()[0], 'text')

// ---- the Twilio content: created once by name, reused, quick-reply for up to 3, list for time -----
const created: any[] = []; const messages: any[] = []; let existing: any[] = []
const twilioClient = {
  content: { v1: { contents: {
    list: async () => existing,
    create: async (request: any) => { created.push(request); return { sid: `HX${created.length}` } },
  } } },
  messages: { create: async (payload: any) => { messages.push(payload); return { sid: 'SM1', status: 'queued' } } },
}
const wlib = load('lib/whatsapp.ts', {
  './qa-trace': { qaTraceReply: () => {} },
  twilio: { default: () => twilioClient },
  '@/lib/services/delivery-callback': { deliveryCallbackUrl: () => '', persistAcceptedChunk: async () => {} },
  '@/lib/metering/record': { recordMeterEvent: async () => {} },
}, { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'test', TWILIO_WHATSAPP_NUMBER: '+15555550100' })
await wlib.sendWhatsAppChoice('+15555550101', 'cabin', 'Bengaluru to Singapore on 27 Oct 2026. Which cabin?', choices.FLIGHT_CHOICES.cabin.options)
await wlib.sendWhatsAppChoice('+15555550101', 'cabin', 'second send', choices.FLIGHT_CHOICES.cabin.options)
assert.equal(created.length, 1, 'the template is created once and reused')
const quick = created[0].types['twilio/quick-reply']
assert.equal(created[0].friendlyName, 'gogo_flight_choice_cabin_v1')
assert.equal(JSON.stringify(quick.actions.map((a: any) => a.title)), JSON.stringify(['Economy', 'Premium economy', 'Business']))
assert.ok(quick.actions.length <= 3 && quick.actions.every((a: any) => a.title.length <= 20))
assert.equal(messages.length, 2); assert.equal(messages[0].contentSid, 'HX1')
assert.equal(JSON.parse(messages[0].contentVariables)['1'], 'Bengaluru to Singapore on 27 Oct 2026. Which cabin?')
await wlib.sendWhatsAppChoice('+15555550101', 'time', 'Departure time?', choices.FLIGHT_CHOICES.time.options)
const list = created[1].types['twilio/list-picker']
assert.equal(JSON.stringify(list.items.map((i: any) => i.item)), JSON.stringify(['Morning', 'Afternoon', 'Evening', 'Night', 'Any time']))
assert.ok(list.items.length <= 10 && list.items.every((i: any) => i.item.length <= 24 && i.description.length <= 72))
existing = [{ friendlyName: 'gogo_flight_choice_trip_v1', sid: 'HXexisting' }]
await wlib.sendWhatsAppChoice('+15555550101', 'trip', 'One-way or round trip?', choices.FLIGHT_CHOICES.trip.options)
assert.equal(created.length, 2, 'an existing template found by name is reused, not duplicated')
assert.equal(messages.at(-1).contentSid, 'HXexisting')
console.log('✅ flight questions go out as tap buttons (list for time of day), fall back to text, and reuse one template each')
