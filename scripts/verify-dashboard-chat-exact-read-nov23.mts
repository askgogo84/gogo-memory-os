// Synthetic actual-function regression. No live sessions, databases, providers or sends.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
const start = source.indexOf('async function resolveDashboardUser(')
const end = source.indexOf('\nasync function saveConversation(', start)
assert.ok(start >= 0 && end > start, 'actual dashboard chat lookup function must exist')
const functionSource = source.slice(start, end)
assert.doesNotMatch(functionSource, /\b(?:parseInt|parseFloat)\s*\(/, 'never parse owner prefix')
assert.doesNotMatch(functionSource, /Number\s*\(\s*telegramId\s*\)/, 'never round session owner')
const script = ts.transpileModule(functionSource + '\nexports.lookup = resolveDashboardUser;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

type Scenario = { owner: unknown; returned?: unknown; error?: unknown; expected?: boolean }
async function exercise({ owner, returned, error, expected }: Scenario) {
  const predicates: Array<{ column: string; value: unknown }> = []
  let reads = 0
  const db = { from(table: string) {
    reads++
    assert.equal(table, 'users', 'only the authenticated user's row is read')
    return {
      select(cols: string) {
        assert.equal(cols, 'telegram_id, whatsapp_id, name')
        return this
      },
      eq(column: string, value: unknown) {
        predicates.push({ column, value })
        return this
      },
      async maybeSingle() {
        return { data: returned === undefined ? null : { telegram_id: returned, whatsapp_id: 'fixture', name: 'Synthetic' }, error: error || null }
      },
    }
  }}
  const exports: Record<string, any> = {}
  runInNewContext(script, { exports, module: { exports }, supabaseAdmin: db, BigInt, Number, String, Promise })
  const value = await exports.lookup(owner)
  assert.equal(Boolean(value), expected ?? false, 'lookup result for ' + String(owner))
  return { reads, predicates, value }
}

assert.equal(Number('9007199254740992'), Number('9007199254740993'), 'fixture reproduces numeric alias')
for (const owner of [
  '42', '-123', '9007199254740992', '9007199254740993',
  '-9007199254740993', '-9223372036854775808', '9223372036854775807',
]) {
  const result = await exercise({ owner, returned: owner, expected: true })
  assert.equal(result.reads, 1, 'one exact lookup for a valid owner')
  assert.deepEqual(result.predicates, [{ column: 'telegram_id', value: owner }])
  assert.equal(typeof result.predicates[0].value, 'string', 'the query owner must remain decimal text')
}
{
  const safe = await exercise({ owner: '42', returned: 42, expected: true })
  assert.equal(safe.reads, 1, 'older safe integer database representation is still supported')
}
for (const owner of [
  '', '0', '-0', '00', '042', '-042', '+42', '42junk', '42.0', ' 42', '42 ',
  '9e18', '9223372036854775808', '-9223372036854775809',
  '999999999999999999999999', null, undefined, 42, 42.5,
  Number('9007199254740993'),
]) {
  const result = await exercise({ owner, returned: '42' })
  assert.equal(result.reads, 0, 'invalid session cannot execute private lookup')
  assert.equal(result.predicates.length, 0)
}
for (const returned of [
  '9007199254740992', Number('9007199254740993'), '9007199254740993x',
  '0', null, 42, {},
]) {
  const result = await exercise({ owner: '9007199254740993', returned })
  assert.equal(result.reads, 1)
  assert.equal(result.value, null, 'mismatched/rounded returned owner must fail closed')
}
{
  const result = await exercise({ owner: '-123', returned: '-123', error: { message: 'unreadable row' } })
  assert.equal(result.value, null, 'database errors must not return identity')
}
console.log('PASS dashboard chat exact-owner read: signed 64-bit IDs, negatives, invalid sessions, returned owner and DB error')
