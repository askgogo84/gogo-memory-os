// P1 synthetic ORIGINAL-function regression: never route a watch to another BIGINT owner.
// No live Supabase/Twilio/Vault calls or customer data. Extracts the actual shipped functions.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/agent/watchers.ts', 'utf8')
function section(begin, end) {
  const from = source.indexOf(begin), to = source.indexOf(end, from + begin.length)
  assert.ok(from >= 0 && to > from, 'original watcher function boundaries must be present')
  return source.slice(from, to)
}
const moduleSource = [
  'type ContextualWatcherMeta = any',
  "type WatcherDelivery = 'app'|'whatsapp'|'both'",
  section('function exactWatcherOwner(', 'export type ContextualWatcherMeta'),
  section('async function sendWhatsAppIfWanted(', 'function searchFingerprint('),
  'exports.sendWhatsAppIfWanted = sendWhatsAppIfWanted',
].join('\n')
const compiled = ts.transpileModule(moduleSource, {
  fileName: 'watchers-owner-egress-original.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const A = '9007199254740992', B = '9007199254740993'
const ticketId = '11111111-1111-4111-8111-111111111111'
const condition = {
  contextual: true, contextualKind: 'travel',
  expiresAt: '2027-01-01T00:00:00Z',
  sourceRefs: [{ type: 'travel_ticket', id: ticketId }],
}

function fixture(options = {}) {
  const calls = [], sent = [], costs = []
  const users = [
    { telegram_id: A, whatsapp_id: 'whatsapp:+14155550001' },
    { telegram_id: B, whatsapp_id: 'whatsapp:+14155550002' },
  ]
  const tickets = [
    { telegram_id: A, id: ticketId, arrive_at: '2026-11-02T00:00:00Z' },
    { telegram_id: B, id: ticketId, arrive_at: '2026-11-12T00:00:00Z' },
  ]
  const db = { from(table) {
    assert.ok(['users', 'travel_tickets'].includes(table), 'only owner-bound tables')
    const filters = []
    const query = {
      select(columns) {
        calls.push({ stage: 'select', table, columns })
        return query
      },
      eq(key, value) {
        calls.push({ stage: 'eq', table, key, value })
        filters.push(row => String(row[key]) === String(value))
        return query
      },
      in(key, values) {
        calls.push({ stage: 'in', table, key, values })
        filters.push(row => values.map(String).includes(String(row[key])))
        return query
      },
      async maybeSingle() { return execute(true) },
      then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject) },
    }
    function execute(single) {
      if (options.dbError) return { data: null, error: { message: 'synthetic database outage' } }
      const rows = (table === 'users' ? users : tickets).filter(row => filters.every(test => test(row)))
      const data = single ? rows[0] || null : rows
      if (table === 'users' && data && options.wrongOwnerResult)
        return { data: users[0], error: null }
      if (table === 'users' && data && options.unsafeOwnerResult)
        return { data: { ...data, telegram_id: Number(data.telegram_id) }, error: null }
      return { data, error: null }
    }
    return query
  }}
  const exp = {}
  vm.runInNewContext(compiled, {
    exports: exp, module: { exports: exp }, supabaseAdmin: db,
    sendWhatsAppMessage: async (phone, text) => { sent.push({ phone, text }) },
    recordCostEvent: async event => { costs.push(event) },
    validDate: value => { const n = Date.parse(String(value || '')); return Number.isFinite(n) ? new Date(n).toISOString() : null },
    console: { error(){} }, Date, Number, String, Array, Promise,
  }, { timeout: 2000, filename: 'watchers-owner-egress-original.ts' })
  return { ...exp, calls, sent, costs }
}

{
  const f = fixture()
  await f.sendWhatsAppIfWanted(B, 'whatsapp', 'Private alert for owner B')
  assert.equal(f.sent.length, 1)
  assert.equal(f.sent[0].phone, 'whatsapp:+14155550002', 'owner B must not disclose to owner A')
  assert.deepEqual(f.calls.filter(c => c.stage === 'eq').map(c => c.value), [B])
  assert.equal(f.costs.length, 1)
  assert.equal(f.costs[0].telegramId, B, 'cost ledger must preserve B owner')
  console.log('PASS exact 64-bit owner routes watch only to its own verified recipient')
}
{
  const f = fixture()
  const expiry = await f.sourceBoundTravelExpiry({ telegram_id: B, condition_json: condition })
  assert.equal(expiry, '2026-11-15T00:00:00.000Z', 'owner B ticket alone determines travel expiry')
  assert.deepEqual(f.calls.filter(c => c.stage === 'eq').map(c => c.value), [B])
  console.log('PASS contextual travel expiry never aliases distinct 64-bit owner')
}
for (const bad of [Number(B), NaN, Infinity, 0, 'garbage', '00071', null]) {
  const f = fixture()
  await f.sendWhatsAppIfWanted(bad, 'both', 'private content')
  assert.equal(f.sent.length, 0, 'invalid owner may not send')
  assert.equal(f.calls.length, 0, 'invalid owner must not query users')
  await assert.rejects(f.sourceBoundTravelExpiry({ telegram_id: bad, condition_json: condition }), /owner_invalid/)
  assert.equal(f.calls.length, 0, 'invalid owner must not query travel tickets')
}
console.log('PASS ambiguous numeric and invalid owner identities fail closed without reads or sends')
for (const options of [{ dbError: true }, { wrongOwnerResult: true }, { unsafeOwnerResult: true }]) {
  const f = fixture(options)
  // main (#1319) fails closed on an owner-lookup DB error by throwing; it must still never send.
  if (options.dbError) await assert.rejects(f.sendWhatsAppIfWanted(B, 'whatsapp', 'confidential watch'), /watch_alert_owner_lookup_failed/)
  else await f.sendWhatsAppIfWanted(B, 'whatsapp', 'confidential watch')
  assert.equal(f.sent.length, 0, 'unverified lookup never permits outbound content')
  assert.equal(f.costs.length, 0, 'unverified send must not charge owner')
}
console.log('PASS unavailable, mismatched, rounded database owner evidence cannot authorize send')
{
  const f = fixture()
  await f.sendWhatsAppIfWanted(B, 'app', 'no WhatsApp')
  assert.equal(f.calls.length, 0)
  assert.equal(f.sent.length, 0)
  console.log('PASS app-only delivery remains app-only')
}
console.log('Watcher private WhatsApp egress and travel expiry exact-owner regression passed')
