// Inert actual-module regression: screenshot ticket owners and notification recipients.
// No provider/DB/network/browser messages are sent from this fixture.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync('lib/agent/booking-screenshot-worker.ts', 'utf8')
const compiled = ts.transpileModule(source + '\nexport { actorFor as __actorFor };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

type Scenario = {
  row?: any
  event?: any
  document?: any
  user?: any
}
function actualWorkerScenario(config: Scenario = {}) {
  const calls: Array<{ table: string; operation: string; predicates: Array<[string, unknown]> }> = []
  const sent: Array<{ to: string; text: string }> = []
  const user = config.user ?? { id: 'owner-42', telegram_id: '42', whatsapp_id: 'whatsapp:+15550000042', name: 'Safe fixture owner' }
  const db = {
    from(table: string) {
      let operation = 'select'
      const predicates: Array<[string, unknown]> = []
      const q: any = {
        select() { return q },
        eq(column: string, value: unknown) { predicates.push([column, value]); return q },
        not() { return q },
        contains() { return q },
        gte() { return q },
        order() { return q },
        limit() { return q },
        update() { operation = 'update'; return q },
        insert() { operation = 'insert'; return q },
        async maybeSingle() { return execute(true) },
        then(resolve: any, reject: any) { return execute(false).then(resolve, reject) },
      }
      async function execute(single: boolean) {
        calls.push({ table, operation, predicates: [...predicates] })
        if (table === 'life_event_actions' && operation === 'select') return { data: config.row ? [config.row] : [], error: null }
        if (table === 'life_events' && operation === 'select') return { data: config.event ?? null, error: null }
        if (table === 'documents' && operation === 'select') return { data: config.document ? [config.document] : [], error: null }
        if (table === 'users' && operation === 'select') return { data: user, error: null }
        if (table === 'life_event_actions' && operation === 'update') return { data: null, error: null }
        if (table === 'life_events' && operation === 'update') return { data: null, error: null }
        throw new Error('unexpected fake DB table or write: ' + table + ' / ' + operation)
      }
      return q
    },
  }
  class FakeOpenAI {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({
      isMatch: true, title: 'My Concert', startAt: null, bookingRef: 'SAFE-123', qrVisible: true,
      seats: [], location: null, ticketCount: 1,
    }) } }] }) } }
  }
  const mocks: Record<string, any> = {
    openai: FakeOpenAI,
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/services/document-store': { getDocumentSignedUrl: async () => 'https://fixture.invalid/signed-ticket' },
    './booking-calendar-execution': { prepareBookingCalendarApproval: async () => null },
    '@/lib/channels/whatsapp': { sendWhatsAppMessage: async (to: string, text: string) => { sent.push({ to, text }) } },
  }
  const module = { exports: {} as any }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console, Buffer, Date, Intl, URL, Set, Promise,
    process: { env: { OPENAI_API_KEY: 'inert-fixture-only' } },
    require: (name: string) => {
      if (!Object.prototype.hasOwnProperty.call(mocks, name)) throw new Error('unmocked module: ' + name)
      return mocks[name]
    },
    fetch: async (url: string) => {
      assert.equal(url, 'https://fixture.invalid/signed-ticket')
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
    },
  }, { filename: 'inert-booking-screenshot-worker.js', timeout: 15000 })
  return {
    run: module.exports.processPendingBookingScreenshots as (max?: number) => Promise<any>,
    actorFor: module.exports.__actorFor as (telegramId: number) => Promise<any>,
    calls, sent,
  }
}

const syntheticAction = (telegramId: unknown, whatsappTo = 'whatsapp:+15550000999') => ({
  id: 'synthetic-action', life_event_id: 'synthetic-event', telegram_id: telegramId,
  status: 'blocked', updated_at: '2026-10-27T00:00:00.000Z',
  payload_json: {
    deviceHandoffRequired: true, providerBlock: 'cloudflare',
    whatsappTo, screenshotRequestedAt: '2026-10-27T00:00:00.000Z',
  },
})

for (const badId of ['9007199254740992', '9007199254740993', 9007199254740993, null, '0', '001', '42 ', 'NaN']) {
  const fixture = actualWorkerScenario({ row: syntheticAction(badId) })
  const result = await fixture.run()
  assert.equal(result.checked, 1)
  assert.equal(result.waiting, 1, 'unsafe owner must fail closed at action row')
  assert.equal(result.failed, 0)
  assert.deepEqual(fixture.calls.map(x => x.table), ['life_event_actions'],
    'unsafe owner must not query private events, documents or users before rejection')
  assert.equal(fixture.sent.length, 0, 'unsafe owner must not notify any recipient')
}

{
  const fixture = actualWorkerScenario({ row: syntheticAction('42') })
  const result = await fixture.run()
  assert.equal(result.checked, 1)
  assert.equal(result.waiting, 1, 'safe owner can look up their own event')
  const eventRead = fixture.calls.find(x => x.table === 'life_events')
  assert.ok(eventRead)
  assert.ok(eventRead.predicates.some(([field, value]) => field === 'telegram_id' && value === '42'),
    'safe owner lookup uses exact decimal TEXT predicate')
}

{
  const fixture = actualWorkerScenario({ user: {
    id: 'foreign-owner', telegram_id: '43', whatsapp_id: 'whatsapp:+15550000043',
  } })
  await assert.rejects(fixture.actorFor(42), /booking_screenshot_actor_(?:missing|mismatch)/,
    'users lookup must reject a returned foreign owner before ticket delivery')
}

{
  const fixture = actualWorkerScenario()
  const result = await fixture.actorFor(42)
  assert.equal(result.actor.userId, 'owner-42')
  assert.equal(result.actor.legacyTelegramId, 42)
  const userRead = fixture.calls.find(x => x.table === 'users')
  assert.ok(userRead?.predicates.some(([column, value]) => column === 'telegram_id' && value === '42'),
    'actor lookup must use exact owner string, never Number-coerced SQL predicate')
}

{
  const fixture = actualWorkerScenario({
    row: syntheticAction('42', 'whatsapp:+15550000999'),
    event: {
      id: 'synthetic-event', telegram_id: '42', title: 'My Concert', provider: 'BookMyShow',
      timezone: 'Asia/Kolkata', metadata_json: {}, source_refs: [], start_at: null, end_at: null,
    },
    document: {
      id: 'synthetic-ticket', title: 'BookMyShow ticket for My Concert',
      summary: 'QR ticket with booking reference', storage_path: 'fixture/screenshot.jpg',
      mime: 'image/jpeg', created_at: '2026-10-27T00:00:00.000Z', extracted: {},
    },
  })
  const result = await fixture.run()
  assert.equal(result.failed, 0, 'fully inert safe ticket fixture must complete normally')
  assert.equal(result.completed, 1, 'valid owner-scoped screenshot still completes')
  assert.equal(fixture.sent.length, 1)
  assert.equal(fixture.sent[0].to, 'whatsapp:+15550000042',
    'verified users.whatsapp_id must override stale/foreign action payload.whatsappTo')
  assert.match(fixture.sent[0].text, /Ticket screenshot verified/)
  const documentRead = fixture.calls.find(x => x.table === 'documents')
  assert.ok(documentRead?.predicates.some(([column, value]) => column === 'telegram_id' && value === '42'),
    'ticket documents must be queried by the exact canonical owner')
}

console.log('✅ Booking screenshot isolation: actual worker, synthetic adjacent owners, foreign actor, safe ticket and verified recipient')
