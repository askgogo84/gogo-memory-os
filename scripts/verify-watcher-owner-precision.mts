// Conditional P1: watcher WhatsApp/Gmail/travel owner resolution must never round
// two distinct persisted signed64 tenant IDs into the same account.
// Inert execution of the ACTUAL source functions; no provider, network, live DB, or send.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const ownerA = '9007199254740992'
const ownerB = '9007199254740993'
const ownerSafe = '101'
assert.equal(Number(ownerA), Number(ownerB), 'the pre-fix Number conversion aliases distinct owners')

const source = readFileSync('lib/agent/watchers.ts', 'utf8')
const parsed = ts.createSourceFile('watchers.ts', source, ts.ScriptTarget.Latest, true)
const wanted = new Set(['exactWatcherOwner', 'sendWhatsAppIfWanted', 'watcherActor', 'sourceBoundTravelExpiry'])
const bodies = parsed.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && !!node.name && wanted.has(node.name.text)
).map((node) => node.getText(parsed))
for (const name of ['sendWhatsAppIfWanted', 'watcherActor', 'sourceBoundTravelExpiry']) {
  assert.ok(bodies.some((body) => body.includes('function ' + name + '(')), 'missing actual source function: ' + name)
}
const emitted = ts.transpileModule(bodies.join('\n\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

const accounts: Record<string, { id: string; telegram_id: string | number; whatsapp_id: string; name: string }> = {
  [ownerA]: { id: 'actor-A', telegram_id: ownerA, whatsapp_id: 'whatsapp:+14155552671', name: 'A' },
  [ownerB]: { id: 'actor-B', telegram_id: ownerB, whatsapp_id: 'whatsapp:+14155552672', name: 'B' },
  [ownerSafe]: { id: 'actor-safe', telegram_id: ownerSafe, whatsapp_id: 'whatsapp:+14155552673', name: 'Safe' },
}

function fixture(forcedUser?: Record<string, unknown>) {
  const queries: Array<{ table: string; owner: unknown; columns: string }> = []
  const sends: string[] = []
  const costs: unknown[] = []
  const db = {
    from(table: string) {
      let columns = ''
      const filters = new Map<string, unknown>()
      const query = {
        select(fields: string) { columns = fields; return query },
        eq(field: string, value: unknown) { filters.set(field, value); return query },
        in(_field: string, _items: unknown) { return query },
        async maybeSingle() {
          const owner = filters.get('telegram_id')
          queries.push({ table, owner, columns })
          if (table !== 'users') throw Error('unexpected maybeSingle table: ' + table)
          return { data: forcedUser || accounts[String(owner)] || null, error: null }
        },
        then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
          const owner = filters.get('telegram_id')
          queries.push({ table, owner, columns })
          if (table !== 'travel_tickets') return Promise.reject(Error('unexpected query table: ' + table)).then(resolve, reject)
          const row = accounts[String(owner)]
          const result = { data: row ? [{
            id: '11111111-1111-4111-8111-111111111111',
            telegram_id: row.telegram_id,
            depart_at: '2030-01-02T12:00:00.000Z',
            arrive_at: '2030-01-03T12:00:00.000Z',
          }] : [], error: null }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return query
    },
  }
  const mod: { exports: Record<string, any> } = { exports: {} }
  const sandbox: Record<string, any> = {
    exports: mod.exports, module: mod, supabaseAdmin: db,
    sendWhatsAppMessage: async (phone: string) => { sends.push(phone) },
    recordCostEvent: async (data: unknown) => { costs.push(data) },
    validDate: (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null,
    Date, Number, String, Promise, Array, Object, Math, JSON, RegExp, Set,
  }
  vm.runInNewContext(emitted + '\n;globalThis.__targets = {sendWhatsAppIfWanted, watcherActor, sourceBoundTravelExpiry}', sandbox, {
    filename: 'watcher-owner-precision.actual-source.cjs',
  })
  return { functions: sandbox.__targets as Record<string, any>, queries, sends, costs }
}

for (const owner of [ownerSafe, ownerA, ownerB]) {
  const f = fixture()
  await f.functions.sendWhatsAppIfWanted(owner, 'whatsapp', 'inert digest only')
  assert.deepEqual(f.queries.map((q) => q.owner), [owner], 'query must use exact TEXT owner, no numeric rounding')
  assert.deepEqual(f.sends, [accounts[owner].whatsapp_id], 'a watcher must notify ONLY its proven persisted owner')
  assert.equal(f.costs.length, 1)
}

for (const bad of [Number(ownerB), 0, '0', '00101', '101junk', '+101', '1e2', '', null, undefined]) {
  const f = fixture()
  await f.functions.sendWhatsAppIfWanted(bad, 'both', 'inert')
  assert.deepEqual(f.queries, [], 'untrusted or already rounded owner cannot touch private users')
  assert.deepEqual(f.sends, [], 'invalid owner cannot send WhatsApp')
  assert.deepEqual(f.costs, [])
}

for (const mismatch of [accounts[ownerA], { ...accounts[ownerB], telegram_id: Number(ownerB) }]) {
  const f = fixture(mismatch)
  await f.functions.sendWhatsAppIfWanted(ownerB, 'whatsapp', 'inert')
  assert.deepEqual(f.sends, [], 'wrong/rounded returned user cannot receive another tenant message')
}

{
  const f = fixture()
  const actor = await f.functions.watcherActor(ownerSafe)
  assert.equal(actor?.userId, 'actor-safe')
  assert.equal(actor?.legacyTelegramId, 101)
  assert.deepEqual(f.queries.map((q) => q.owner), [ownerSafe])
}
for (const bad of [ownerA, ownerB, Number(ownerB), 0, '00101', '101junk']) {
  const f = fixture()
  assert.equal(await f.functions.watcherActor(bad), null, 'unsafe owner cannot select Gmail actor')
  assert.deepEqual(f.queries, [], 'unsafe owner cannot read Gmail user or credential row')
}
{
  const f = fixture(accounts[ownerA])
  assert.equal(await f.functions.watcherActor(ownerSafe), null, 'returned actor owner must be exact session owner')
}

const travel = (owner: unknown) => ({
  telegram_id: owner,
  condition_json: {
    contextual: true, contextualKind: 'travel',
    sourceRefs: [{ type: 'travel_ticket', id: '11111111-1111-4111-8111-111111111111' }],
    expiresAt: null,
  },
})
for (const owner of [ownerSafe, ownerA, ownerB]) {
  const f = fixture()
  const end = await f.functions.sourceBoundTravelExpiry(travel(owner))
  assert.equal(end, '2030-01-06T12:00:00.000Z')
  assert.deepEqual(f.queries.map((q) => q.owner), [owner], 'travel source reads must retain canonical string owner')
  assert.ok(f.queries[0]?.columns.includes('telegram_id'), 'source rows must include owner evidence')
}
for (const bad of [Number(ownerB), '00101', '101junk', 0, null]) {
  const f = fixture()
  await assert.rejects(() => f.functions.sourceBoundTravelExpiry(travel(bad)))
  assert.deepEqual(f.queries, [], 'invalid owner may not read private travel tickets')
}

console.log('Watcher owner precision: exact WhatsApp recipients, safe Gmail actor, travel sources and negative owners PASS (all inert)')
