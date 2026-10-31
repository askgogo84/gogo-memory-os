// TEST ONLY. Runs current original lib/dashboard/activity.ts against a sealed fake store.
// All owner IDs and records are synthetic. No Supabase, provider, customer or network IO.
// Expected mandatory safety RED until independently reviewed source remediation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const file = 'lib/dashboard/activity.ts'
const source = readFileSync(file, 'utf8')
const original = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const originalFunction = original.statements.find(s =>
  ts.isFunctionDeclaration(s) && s.name?.text === 'getActivityTrends')
assert.ok(originalFunction?.body, 'must execute original getActivityTrends function, not a replica')

const compiled = ts.transpileModule(source, {
  fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const SMALL = '123456'
const LARGE_A = '9007199254740992'
const LARGE_B = '9007199254740993'
const TIME = '2026-10-31T12:00:00.000Z'
const NOW = Date.parse('2026-10-31T13:00:00.000Z')
assert.notEqual(LARGE_A, LARGE_B)
assert.equal(Number(LARGE_A), Number(LARGE_B),
  'synthetic owners must demonstrate JavaScript precision aliasing')

const fixtureRows = {
  usage_events: [SMALL, LARGE_A, LARGE_B].map(telegram_id =>
    ({ telegram_id, created_at: TIME, counter: 'ai_action', action: 'chat' })),
  reminders: [
    { telegram_id: SMALL, remind_at: TIME, sent: true },
    { telegram_id: LARGE_A, remind_at: TIME, sent: true },
    { telegram_id: LARGE_A, remind_at: TIME, sent: true },
    { telegram_id: LARGE_B, remind_at: TIME, sent: true },
  ],
  agent_runs: [SMALL, LARGE_A, LARGE_B].map(telegram_id =>
    ({ telegram_id, started_at: TIME, status: 'completed', title: 'Synthetic fixture run', type: 'test' })),
  agent_activity: [SMALL, LARGE_A, LARGE_B].map(telegram_id =>
    ({ telegram_id, created_at: TIME, event_type: 'watcher_triggered' })),
}

function createHarness() {
  const reads = []
  const supabaseAdmin = {
    from(table) {
      assert.ok(Object.hasOwn(fixtureRows, table), 'unexpected private table query')
      const filters = []
      const query = {
        select() { return this },
        eq(column, value) { filters.push({op: 'eq', column, value}); return this },
        gte(column, value) { filters.push({op: 'gte', column, value}); return this },
        lte(column, value) { filters.push({op: 'lte', column, value}); return this },
        order() { return this },
        limit() { return this },
        then(resolve, reject) {
          const data = fixtureRows[table].filter(row => filters.every(f => {
            const actual = String(row[f.column] ?? '')
            const expected = String(f.value)
            return f.op === 'eq' ? actual === expected :
              f.op === 'gte' ? actual >= expected : actual <= expected
          }))
          reads.push({ table, filters: [...filters],
            matchedOwners: data.map(row => String(row.telegram_id)) })
          return Promise.resolve({data, error: null}).then(resolve, reject)
        },
      }
      return query
    },
  }
  const exported = {}
  vm.runInNewContext(compiled, {
    exports: exported,
    require(id) {
      if (id === '@/lib/supabase-admin') return {supabaseAdmin}
      throw new Error('unexpected dependency from sealed test: ' + id)
    },
    Date, Promise, Number, String, Map, Math, Error, console,
  }, {timeout: 2000, filename: file})
  assert.equal(typeof exported.getActivityTrends, 'function')
  return { run: exported.getActivityTrends, reads }
}

const small = createHarness()
const smallResult = await small.run(SMALL, 10, NOW)
const largeA = createHarness()
const largeAResult = await largeA.run(LARGE_A, 10, NOW)
const largeB = createHarness()
const largeBResult = await largeB.run(LARGE_B, 10, NOW)
const numeric = createHarness()
let numericRejected = false
try {
  await numeric.run(Number(LARGE_B), 10, NOW)
} catch {
  numericRejected = true
}

const byTable = (h, table) => h.reads.find(q => q.table === table)
const ownerArg = q => q?.filters.find(f => f.op === 'eq' && f.column === 'telegram_id')?.value
const seven = result => result.trends.find(t => t.days === 7)
let controlPass = 0
let controlFail = 0
let mandatoryPass = 0
let mandatoryFail = 0
async function check(kind, label, fn) {
  try {
    await fn()
    if (kind === 'control') controlPass++
    else mandatoryPass++
    console.log('PASS ' + kind + ': ' + label)
  } catch (e) {
    if (kind === 'control') controlFail++
    else mandatoryFail++
    console.error('FAIL ' + kind + ': ' + label + ' (' +
      String(e?.message || e).slice(0, 150) + ')')
  }
}
await check('control', 'original getActivityTrends runs four provider-free synthetic queries', () => {
  assert.equal(small.reads.length, 4)
  assert.deepEqual([...small.reads.map(r => r.table)].sort(),
    ['agent_activity', 'agent_runs', 'reminders', 'usage_events'].sort())
})
await check('control', 'safe small string owner gets correct owner-only trend counts', () => {
  assert.equal(seven(smallResult).reminders, 1)
  assert.equal(seven(smallResult).ai, 1)
  assert.equal(seven(smallResult).tasks, 1)
  assert.equal(seven(smallResult).alerts, 1)
})
await check('control', 'three non-reminder private queries keep the large decimal string exact', () => {
  assert.equal(largeB.reads.length, 4)
  for (const q of largeB.reads.filter(q => q.table !== 'reminders')) {
    assert.equal(ownerArg(q), LARGE_B)
    assert.ok(q.matchedOwners.every(id => id === LARGE_B))
  }
})
await check('control', 'other valid large string owner preserves its own reminder totals', () => {
  assert.equal(seven(largeAResult).reminders, 2)
  assert.equal(String(ownerArg(byTable(largeA, 'reminders'))), LARGE_A)
})
await check('control', 'small owner uses a scoped reminder filter', () => {
  const q = byTable(small, 'reminders')
  assert.equal(String(ownerArg(q)), SMALL)
  assert.ok(q.matchedOwners.every(id => id === SMALL))
})

await check('mandatory', 'all large-string-owner queries preserve exact tenant identifier', () => {
  for (const q of largeB.reads) assert.equal(String(ownerArg(q)), LARGE_B)
})
await check('mandatory', 'a large owner reminder query cannot select another owner', () => {
  assert.ok(byTable(largeB, 'reminders').matchedOwners.every(id => id === LARGE_B))
})
await check('mandatory', 'large owner trends count only their own delivered reminders', () => {
  assert.equal(seven(largeBResult).reminders, 1)
})
await check('mandatory', 'two distinct 64-bit string owners never share the same reminder query identity', () => {
  assert.notEqual(String(ownerArg(byTable(largeA, 'reminders'))),
    String(ownerArg(byTable(largeB, 'reminders'))))
})
await check('mandatory', 'unsafe rounded numeric owner fails closed before privileged reads', () => {
  assert.equal(numericRejected, true)
  assert.equal(numeric.reads.length, 0)
})

console.log('RESULT controls_pass=' + controlPass + '/5 controls_fail=' + controlFail +
  ' mandatory_owner_pass=' + mandatoryPass + '/5 mandatory_owner_fail=' + mandatoryFail)
if (controlFail) process.exit(2)
if (mandatoryFail) process.exit(1)
