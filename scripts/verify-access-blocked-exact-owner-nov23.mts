// Registered synthetic security regression: actual block-status function and two helpers.
// Database, WhatsApp, dashboard session and external providers are NEVER accessed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/access/gate.ts', 'utf8')
const start = source.indexOf('function exactBlockStatusOwner(')
assert.ok(start > 0, 'find actual exact-block-status owner parser')
const snippet = source.slice(start)
assert.match(snippet, /export async function isTelegramIdBlocked\(/)
assert.doesNotMatch(snippet, /\.eq\('telegram_id',\s*Number\(/, 'never round block-status lookup owners')

const queries: { table: string; selected: string; owner: unknown }[] = []
let mode: 'normal' | 'error' | 'throw' = 'normal'
let row: any = null
let simulateStoredBigint = false
const supabaseAdmin = {
  from(table: string) {
    const call = { table, selected: '', owner: undefined as unknown }
    queries.push(call)
    assert.equal(table, 'users', 'only users can be queried')
    const q = {
      select(fields: string) {
        call.selected = fields
        return q
      },
      eq(column: string, owner: unknown) {
        assert.equal(column, 'telegram_id', 'the query must bind to one exact owner')
        call.owner = owner
        return q
      },
      async maybeSingle() {
        if (mode === 'throw') throw new Error('synthetic database failure')
        // PostgREST serializes an uncast BIGINT as a bare JSON number.
        // Model that wire representation before the client parses the response.
        let data = row
        if (simulateStoredBigint) {
          const ownerToken = call.selected.split(',').map(s => s.trim()).includes('telegram_id::text')
            ? JSON.stringify(row.telegram_id) : row.telegram_id
          data = JSON.parse('{"telegram_id":' + ownerToken + ',"access_status":' + JSON.stringify(row.access_status) + '}')
        }
        return { data, error: mode === 'error' ? { code: 'TEST' } : null }
      },
    }
    return q
  },
}
const exported: Record<string, any> = {}
const js = ts.transpileModule(snippet, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
vm.runInNewContext(js, {
  exports: exported, module: { exports: exported }, supabaseAdmin,
  BigInt, Number, String, console,
}, { filename: 'actual-access-block-status.fixture.js' })
const isBlocked = exported.isTelegramIdBlocked as (id: string | number) => Promise<boolean>
assert.equal(typeof isBlocked, 'function', 'the actual function must be executed')

const exactOwners: Array<string | number> = [
  '1', '-1', 42, -42, '42', '-42', '9007199254740992',
  '9007199254740993', '-9007199254740993',
  '9223372036854775807', '-9223372036854775808',
]
assert.equal(Number('9007199254740992'), Number('9007199254740993'),
  'test must exercise an actual floating-point collision')

simulateStoredBigint = true
for (const id of exactOwners) {
  const exact = String(id)
  for (const status of ['blocked', 'active']) {
    queries.length = 0
    mode = 'normal'
    row = { telegram_id: exact, access_status: status }
    assert.equal(await isBlocked(id), status === 'blocked', 'exact ' + exact + ' / ' + status)
    assert.equal(queries.length, 1, 'one read for valid owner')
    assert.equal(queries[0].owner, exact, 'exact string predicate, never unsafe Number')
    assert.match(queries[0].selected, /telegram_id/, 'selected owner is checked independently')
    assert.match(queries[0].selected, /access_status/, 'selected block flag is checked')
  }
}
simulateStoredBigint = false
queries.length = 0
row = { telegram_id: 42, access_status: 'active' }
assert.equal(await isBlocked('42'), false, 'safe legacy DB numeric owner remains valid')
assert.equal(queries[0].owner, '42')

for (const bad of ['', '0', '-0', '01', '-01', '+42', ' 42', '42 ', '4.2',
  '4e2', '42tail', '9223372036854775808', '-9223372036854775809',
  '999999999999999999999', 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  queries.length = 0
  row = { telegram_id: '42', access_status: 'active' }
  assert.equal(await isBlocked(bad as string | number), true,
    'invalid identity cannot bypass blocked decision: ' + String(bad))
  assert.equal(queries.length, 0, 'invalid identities never query private users')
}

for (const id of ['9007199254740993', '-9223372036854775808', '42']) {
  queries.length = 0
  mode = 'normal'
  row = { telegram_id: '42', access_status: 'active' }
  if (id === '42') row.telegram_id = '43'
  assert.equal(await isBlocked(id), true, 'cross-owner returned row must fail closed')
  assert.equal(queries[0].owner, id, 'owner predicate never switched')
}
queries.length = 0
row = { telegram_id: Number('9007199254740993'), access_status: 'active' }
assert.equal(await isBlocked('9007199254740993'), true,
  'rounded numeric returned row must not authorize adjacent signed BIGINT account')

for (const failure of ['error', 'throw'] as const) {
  queries.length = 0
  mode = failure
  row = null
  assert.equal(await isBlocked('-9007199254740993'), true,
    'unknown database state must not report account as unblocked: ' + failure)
  assert.equal(queries.length, 1)
}
queries.length = 0
mode = 'normal'
row = null
assert.equal(await isBlocked('42'), false,
  'valid absent user has no block flag; checkWhatsAppAccess independently enforces admission')
assert.equal(queries.length, 1)
console.log('PASS: exact signed-64-bit block-status owner, DB errors fail closed, valid absence remains separate from admission; zero provider calls')
