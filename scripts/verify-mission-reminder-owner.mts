// CONDITIONAL P1: exported reminder reads must reject imprecise/invalid owner identities
// BEFORE any service-role read. Entire module executes with inert DB and timezone stubs.
// No real reminders, accounts, credentials, provider sends or database connections.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/agent/reminder-read.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const farFuture = '2035-10-27T12:00:00.000Z'
const rounded = Number('9007199254740993')
assert.equal(rounded, Number('9007199254740992'), 'adjacent 64-bit user IDs alias when converted to Number')
const stored = [
  { id: 'owner-positive', telegram_id: 17, message: 'Safe positive owner', sent: false, remind_at: farFuture, timezone: 'UTC' },
  { id: 'owner-negative', telegram_id: -17, message: 'Safe negative owner', sent: false, remind_at: farFuture, timezone: 'UTC' },
  { id: 'other-safe', telegram_id: 18, message: 'OTHER OWNER PRIVATE', sent: false, remind_at: farFuture, timezone: 'UTC' },
  { id: 'foreign-rounded', telegram_id: rounded, message: 'OTHER 64-BIT OWNER PRIVATE', sent: false, remind_at: farFuture, timezone: 'UTC' },
]
type QueryLog = { table: string; filters: Array<[string, unknown]> }
const queries: QueryLog[] = []
const db = {
  from(table: string) {
    const filters: Array<[string, unknown]> = []
    const log: QueryLog = { table, filters }
    queries.push(log)
    assert.equal(table, 'reminders', 'only the requested reminder table is allowed in this fixture')
    let start = 0
    let end = 99
    const q: any = {
      select: () => q,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return q },
      gte: (column: string, value: unknown) => { filters.push([column, value]); return q },
      order: () => q,
      range: (a: number, b: number) => { start = a; end = b; return q },
      then(ok: (value: any) => any, fail?: (error: any) => any) {
        try {
          const data = stored.filter(row => filters.every(([column, value]) =>
            column === 'remind_at' ? String(row.remind_at) >= String(value) : (row as any)[column] === value,
          )).slice(start, end + 1)
          return Promise.resolve({ data, error: null }).then(ok, fail)
        } catch (error) { return Promise.reject(error).then(ok, fail) }
      },
    }
    return q
  },
}
const moduleExports: Record<string, any> = {}
runInNewContext(compiled, {
  exports: moduleExports, module: { exports: moduleExports }, Date, Intl,
  require(name: string) {
    if (name === '@/lib/supabase-admin') return { supabaseAdmin: db }
    if (name === '@/lib/timezone') return { isValidTimezone: () => false, getLocalParts: () => { throw Error('unused timezone') } }
    if (name === '@/lib/bot/memory-redaction') return { redactSecretShapedText: (text: string) => text }
    throw new Error('unapproved reminder-read dependency: ' + name)
  },
}, { filename: 'lib/agent/reminder-read.ts', timeout: 3000 })

assert.equal(typeof moduleExports.readScopedReminders, 'function')
const step = { title: 'Review reminders', instruction: 'Review reminders' }
const read = (owner: unknown) => moduleExports.readScopedReminders(owner, step, 'Show my reminders')

// Verify ORIGINAL module rejects before private database access rather than reading
// the row assigned to a distinct 64-bit owner after IEEE-754 rounding.
for (const invalid of [
  rounded, -rounded, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN,
  1.25, 0, '17', '9007199254740993', null, undefined,
]) {
  queries.length = 0
  await assert.rejects(() => read(invalid), /mission_reminder_owner_unsafe/,
    'unsafe or noncanonical owner must fail closed: ' + String(invalid))
  assert.equal(queries.length, 0, 'denied owner must not query private reminders: ' + String(invalid))
}

for (const [owner, expected] of [[17, 'owner-positive'], [-17, 'owner-negative']] as const) {
  queries.length = 0
  const reply = await read(owner)
  assert.deepEqual(Array.from(reply.reminders, (row: any) => row.id), [expected],
    'valid safe signed owner reads only their own reminders')
  assert.ok(queries.length > 0)
  assert.ok(queries.every(query => query.filters.some(([name, value]) =>
    name === 'telegram_id' && value === owner)), 'every page binds the exact safe owner')
  assert.equal(reply.truncated, false)
}
console.log('Mission reminder read owner validation: synthetic unsafe/foreign/safe controls passed')
