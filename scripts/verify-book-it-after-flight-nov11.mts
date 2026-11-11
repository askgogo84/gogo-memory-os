// 11 Nov live (WhatsApp): after flight results, "book it" got "Book what exactly? The last thing we discussed was
// "BLR → GOI" (travel)". A booking reply after a flight result now goes to the flight-booking handler.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(file: string, mocks: Record<string, any>) {
  const exports: any = {}
  const src = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(src, { exports, module: { exports }, console, Promise, Date, URL, process: { env: {} },
    require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(`Unmocked: ${name}`) } })
  return exports
}
let context: any = null
const calls: any[] = []
const inert = new Proxy({}, { get: () => async () => null })
const mocks = (booking: any) => ({
  './gmail-send': inert, './watch-command': inert, 'node:crypto': { randomUUID: () => 'id' },
  '@/lib/supabase-admin': { supabaseAdmin: inert }, '@/lib/google-calendar': inert, '@/lib/timezone': { normalizeTimezone: (z: any) => z, parseLocalDateTime: () => null },
  './adaptive-autonomy': inert, './calendar-update': inert, './decision-learning': { recordDecisionLearning: async () => {} },
  './decision-feedback': { captureExplicitRoutingCorrection: async () => null }, './sentinel': { evaluateAgentSentinel: () => ({ allowed: true }) },
  './reminder-update': inert, './approval-guard': inert,
  './typed-object-context': { latestTypedContext: async () => context, rememberTypedObjects: async () => {}, normalizedObjectTitle: (t: string) => t,
    selectedTypedObject: (c: any) => c?.items?.[0] || null, typedOrdinal: () => null, typedMutationOwner: () => null },
  './flight-booking': { tryFlightBooking: async (p: any) => { calls.push(p); return booking } },
})
const actor = { userId: 'u', legacyTelegramId: -884501501, whatsappId: '918884501501' }

// After a flight result: the flight handler answers.
context = { domain: 'travel', items: [{ id: 'run1', title: 'BLR → GOI' }], selectedId: 'run1', at: new Date().toISOString() }
let r = load('lib/agent/typed-time-routing.ts', mocks({ text: 'Booking: BLR → GOI …', handledBy: 'flight-booking', status: 'waiting_user' }))
let out = await r.tryTypedTimeRouting({ actor, text: 'book it', surface: 'whatsapp' })
assert.equal(out?.handledBy, 'flight-booking'); assert.equal(calls.length, 1); assert.equal(calls[0].text, 'book it')
assert.doesNotMatch(String(out?.text), /what exactly/)

// No flight result to bind to: the old clarification stays (nothing is guessed).
r = load('lib/agent/typed-time-routing.ts', mocks(null))
out = await r.tryTypedTimeRouting({ actor, text: 'book it', surface: 'whatsapp' })
assert.match(String(out?.text), /^Book what exactly\?/)

// After a reminder, "book it" is never sent to flight booking.
calls.length = 0
context = { domain: 'reminders', items: [{ id: 'r1', title: 'Call Nithin' }], selectedId: 'r1', at: new Date().toISOString() }
r = load('lib/agent/typed-time-routing.ts', mocks({ text: 'should not happen' }))
out = await r.tryTypedTimeRouting({ actor, text: 'book it', surface: 'whatsapp' })
assert.equal(calls.length, 0); assert.match(String(out?.text), /^Book what exactly\?/)
console.log('PASS book it after flight results goes to flight booking')
