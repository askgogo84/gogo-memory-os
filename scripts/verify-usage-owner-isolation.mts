// DRAFT/TEST-FIRST: actual usage-meter module with inert owner-bound database.
// No real accounts, credentials, network/provider interactions, or production writes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/data/limits.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

type Query = { table: string; equals: Array<[string, unknown]>; operation?: string }
const queries: Query[] = []
const database = {
  from(table: string) {
    const record: Query = { table, equals: [] }
    queries.push(record)
    const q: any = {
      select: () => q,
      eq: (column: string, value: unknown) => { record.equals.push([column, value]); return q },
      like: () => q,
      single: async () => ({ data: table === 'users'
        ? { tier: 'free', daily_count: 1, last_reset: '2099-01', tier_expires_at: null }
        : null, error: null }),
      insert: (_row: unknown) => { record.operation = 'insert'; return Promise.resolve({ error: null }) },
      update: (_row: unknown) => { record.operation = 'update'; return q },
      then: (ok: (value: unknown) => unknown, fail?: (error: unknown) => unknown) =>
        Promise.resolve({ data: [], count: 0, error: null }).then(ok, fail),
    }
    return q
  },
}
const exports: Record<string, any> = {}
runInNewContext(compiled, {
  module: { exports }, exports, Date, Intl, Number, JSON, Math, console,
  require(name: string) {
    if (name === './supabase-admin') return { supabaseAdmin: database }
    throw new Error('unexpected dependency in usage-meter fixture: ' + name)
  },
}, { filename: 'lib/data/limits.ts', timeout: 3000 })

assert.equal(Number('9007199254740993'), Number('9007199254740992'),
  'adjacent signed-64 owner IDs alias as unsafe JavaScript numbers')
const invalidOwners: unknown[] = [
  Number('9007199254740993'), -Number('9007199254740993'),
  Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN,
  0, 17.25, '17', '9007199254740993', null, undefined,
]
for (const value of invalidOwners) {
  const operations = [
    () => exports.checkFeatureLimit(value, 'reminder_create'),
    () => exports.checkAndIncrementLimit(value),
    () => exports.getUsageStatusReply(value),
    () => exports.logUsage(value, 'ai_action'),
  ]
  for (const run of operations) {
    queries.length = 0
    await assert.rejects(() => Promise.resolve().then(run),
      /usage_owner_invalid/, 'invalid owner must fail closed: ' + String(value))
    assert.equal(queries.length, 0,
      'no private table query or write before invalid-owner denial: ' + String(value))
  }
}

for (const owner of [17, -17]) {
  queries.length = 0
  const allowed = await exports.checkFeatureLimit(owner, 'reminder_create')
  assert.equal(allowed.allowed, true)
  assert.equal(allowed.used, 0)
  await exports.logUsage(owner, 'ai_action')
  const limit = await exports.checkAndIncrementLimit(owner)
  assert.equal(limit.allowed, true)
  const summary = await exports.getUsageStatusReply(owner)
  assert.match(summary, /Gogo capacity/)
  assert.ok(queries.length >= 6, 'safe controls exercise fake read/write paths')
  assert.ok(queries.every(query => query.equals.some(([column, value]) =>
    column === 'telegram_id' && value === owner) ||
    (query.table === 'memories' && query.operation === 'insert')),
    'all private read/update queries bind safe owner exactly')
}
console.log('Usage meter owner precision: synthetic invalid / safe signed owner controls passed')
