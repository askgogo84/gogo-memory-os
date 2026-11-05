// DRAFT-only inert regression: execute ORIGINAL dashboard task source with a fake DB.
// No real Supabase, providers, accounts, credentials, network requests or notifications.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity'

const source = readFileSync(new URL('../lib/dashboard/tasks.ts', import.meta.url), 'utf8')
assert.match(source, /export async function getDashboardTasks\s*\(/)
const transpiled = ts.transpileModule(source, {
  fileName: 'lib/dashboard/tasks.ts',
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
assert.equal((transpiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)

const A = '9007199254740992'
const B = '9007199254740993'
const SAFE = '123'
const NEGATIVE = '-2251799813685249'
assert.equal(Number(A), Number(B), 'the synthetic accounts must alias via parseInt/Number')

type Row = { telegram_id: unknown; whatsapp_id: string }
type Case = {
  owner: unknown
  returnedRow?: Row | null
  userError?: unknown
  todoError?: unknown
  omitUser?: boolean
}
const users: Record<string, Row> = {
  [A]: { telegram_id: A, whatsapp_id: 'whatsapp:+14155552671' },
  [B]: { telegram_id: B, whatsapp_id: 'whatsapp:+914155552671' },
  [SAFE]: { telegram_id: SAFE, whatsapp_id: 'whatsapp:+447700900123' },
  [NEGATIVE]: { telegram_id: NEGATIVE, whatsapp_id: 'whatsapp:+447700900456' },
}
const tasks: Record<string, unknown[]> = {
  [users[A].whatsapp_id]: [{ id: 'private-A', text: 'Confidential fictional A', done: false, created_at: '2026-11-01T09:00:00Z', done_at: null }],
  [users[B].whatsapp_id]: [{ id: 'private-B', text: 'Confidential fictional B', done: false, created_at: '2026-11-02T09:00:00Z', done_at: null }],
  [users[SAFE].whatsapp_id]: [
    { id: 'safe-done-early', text: '  Done   earlier ', done: true, created_at: '2026-10-01T01:00:00Z', done_at: '2026-10-02T10:00:00Z' },
    { id: 'safe-open', text: '  Pay   bill  ', done: false, created_at: '2026-10-01T01:00:00Z', done_at: null },
    { id: 'safe-done-late', text: 'Done later', done: true, created_at: '2026-10-01T01:00:00Z', done_at: '2026-10-03T10:00:00Z' },
  ],
  [users[NEGATIVE].whatsapp_id]: [{ id: 'negative-owner', text: 'Supported WhatsApp owner', done: false, created_at: null, done_at: null }],
}

async function exercise(fixture: Case) {
  const ledger: { users: unknown[]; todos: unknown[] } = { users: [], todos: [] }
  const fakeDb = {
    from(table: string) {
      assert.ok(table === 'users' || table === 'todos', 'unreviewed service-role table ' + table)
      let filter = ''
      let value: unknown
      const query = {
        select(cols: string) {
          if (table === 'users') assert.equal(cols, 'telegram_id,whatsapp_id')
          else assert.equal(cols, 'id, text, done, created_at, done_at')
          return query
        },
        eq(key: string, v: unknown) {
          filter = key; value = v
          if (table === 'users') {
            assert.equal(key, 'telegram_id')
            ledger.users.push(v)
          } else {
            assert.equal(key, 'whatsapp_id')
            ledger.todos.push(v)
          }
          return query
        },
        async maybeSingle() {
          assert.equal(table, 'users')
          assert.equal(filter, 'telegram_id')
          assert.equal(typeof value, 'string', 'DB owner predicate must preserve exact decimal text')
          return { data: fixture.omitUser ? null : fixture.returnedRow === undefined ? users[String(value)] || null : fixture.returnedRow, error: fixture.userError || null }
        },
        order(column: string, options: { ascending: boolean }) {
          assert.equal(table, 'todos')
          assert.equal(column, 'created_at')
          assert.equal(options.ascending, false)
          return query
        },
        async limit(n: number) {
          assert.equal(n, 250)
          assert.equal(filter, 'whatsapp_id')
          return { data: tasks[String(value)] || [], error: fixture.todoError || null }
        },
      }
      return query
    },
  }
  const exports: Record<string, any> = {}
  const imports: Record<string, unknown> = {
    '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
    './owner-identity': { exactSessionOwnerId },
  }
  runInNewContext(transpiled.outputText, {
    exports,
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), 'forbidden import ' + name)
      return imports[name]
    },
    console: { error: () => {} },
  }, { timeout: 1500 })
  assert.equal(typeof exports.getDashboardTasks, 'function')
  const result = await exports.getDashboardTasks(fixture.owner)
  return { result: JSON.parse(JSON.stringify(result)), ledger }
}

let controls = 0
let security = 0
async function control(name: string, fn: () => Promise<void>) { await fn(); controls++; console.log('PASS control: ' + name) }
async function guard(name: string, fn: () => Promise<void>) { await fn(); security++; console.log('PASS safety: ' + name) }

await control('ordinary owner gets only own open and ordered done tasks', async () => {
  const x = await exercise({ owner: SAFE })
  assert.equal(x.result.ok, true)
  assert.deepEqual(x.ledger.users, [SAFE])
  assert.deepEqual(x.ledger.todos, [users[SAFE].whatsapp_id])
  assert.deepEqual(x.result.open.map((r: any) => r.id), ['safe-open'])
  assert.equal(x.result.open[0].label, 'Pay bill')
  assert.deepEqual(x.result.completed.map((r: any) => r.id), ['safe-done-late', 'safe-done-early'])
})
await control('negative WhatsApp session owner still resolves', async () => {
  const x = await exercise({ owner: NEGATIVE })
  assert.deepEqual(x.ledger.users, [NEGATIVE])
  assert.deepEqual(x.result.open.map((r: any) => r.id), ['negative-owner'])
})
await control('no user row yields empty dashboard without a todos query', async () => {
  const x = await exercise({ owner: SAFE, omitUser: true })
  assert.equal(x.result.ok, true)
  assert.equal(x.ledger.todos.length, 0)
})
await control('no tasks yields valid empty dashboard', async () => {
  const x = await exercise({ owner: '222', returnedRow: { telegram_id: '222', whatsapp_id: 'whatsapp:+447700900222' } })
  assert.deepEqual(x.result.open, [])
  assert.deepEqual(x.result.completed, [])
})

await guard('two adjacent signed BIGINT owners never alias private task queries', async () => {
  const a = await exercise({ owner: A })
  const b = await exercise({ owner: B })
  assert.deepEqual(a.ledger.users, [A])
  assert.deepEqual(b.ledger.users, [B])
  assert.deepEqual(a.result.open.map((x: any) => x.id), ['private-A'])
  assert.deepEqual(b.result.open.map((x: any) => x.id), ['private-B'])
  assert.ok(!b.result.open.some((x: any) => x.id === 'private-A'))
})
await guard('wrong row owner never licenses a private todos read', async () => {
  const x = await exercise({ owner: B, returnedRow: users[A] })
  assert.deepEqual(x.ledger.users, [B])
  assert.equal(x.ledger.todos.length, 0)
  assert.deepEqual(x.result.open, [])
})
await guard('already-rounded numeric returned BIGINT fails closed', async () => {
  const x = await exercise({ owner: B, returnedRow: { telegram_id: Number(B), whatsapp_id: users[B].whatsapp_id } })
  assert.equal(x.ledger.todos.length, 0)
})
await guard('unsafe numeric actor fails before ANY database access', async () => {
  const x = await exercise({ owner: Number(B) })
  assert.equal(x.ledger.users.length, 0)
  assert.equal(x.ledger.todos.length, 0)
})
await guard('malformed/truncated/overflowed actors never query private tables', async () => {
  for (const owner of ['123extra', '123.5', ' 123', '123 ', '+123', '0', '-0', '', '9223372036854775808', '-9223372036854775809', '1e2', undefined, null, 123.5]) {
    const x = await exercise({ owner })
    assert.equal(x.ledger.users.length, 0, String(owner))
    assert.equal(x.ledger.todos.length, 0, String(owner))
  }
})
await guard('failed user lookup cannot trigger a todo query', async () => {
  const x = await exercise({ owner: SAFE, userError: { message: 'synthetic DB error' } })
  assert.equal(x.result.ok, false)
  assert.equal(x.ledger.todos.length, 0)
})
await guard('failed todo read does not return possibly partial private data', async () => {
  const x = await exercise({ owner: SAFE, todoError: { message: 'synthetic DB error' } })
  assert.equal(x.result.ok, false)
})
await guard('missing returned owner does not authorize a phone query', async () => {
  const x = await exercise({ owner: SAFE, returnedRow: { telegram_id: null, whatsapp_id: users[SAFE].whatsapp_id } })
  assert.equal(x.ledger.todos.length, 0)
})
assert.equal(controls, 4)
assert.equal(security, 8)
console.log('Original dashboard tasks source: 4 benign controls and 8 mandatory privacy cases PASS')
