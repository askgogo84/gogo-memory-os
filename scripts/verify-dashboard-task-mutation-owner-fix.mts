// DRAFT-only original-source security regression: fake DB and fake HTTP requests.
// No real accounts, Supabase, messages, credentials, or network activity.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity'

const source = readFileSync(new URL('../app/api/dashboard/tasks/route.ts', import.meta.url), 'utf8')
assert.match(source, /export async function POST/)
assert.match(source, /export async function PATCH/)
const transpiled = ts.transpileModule(source, {
  fileName: 'app/api/dashboard/tasks/route.ts',
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
assert.equal((transpiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)

const A = '9007199254740992'
const B = '9007199254740993'
const NORMAL = '123'
const NEGATIVE = '-2251799813685249'
assert.equal(Number(A), Number(B), 'synthetic identities must collide through unsafe parseInt/Number')

type Row = { telegram_id: unknown; whatsapp_id: string | null }
type Fixture = {
  owner?: unknown
  blockOrigin?: boolean
  returnedRow?: Row | null
  userError?: unknown
  mutationError?: unknown
  body?: unknown
}
const users: Record<string, Row> = {
  [A]: { telegram_id: A, whatsapp_id: 'whatsapp:+14155552671' },
  [B]: { telegram_id: B, whatsapp_id: 'whatsapp:+914155552671' },
  [NORMAL]: { telegram_id: NORMAL, whatsapp_id: 'whatsapp:+447700900123' },
  [NEGATIVE]: { telegram_id: NEGATIVE, whatsapp_id: 'whatsapp:+447700900456' },
}

async function exercise(method: 'POST' | 'PATCH', fixture: Fixture) {
  const ledger: { userReads: unknown[]; inserts: unknown[]; updates: unknown[] } = {
    userReads: [], inserts: [], updates: [],
  }
  const taskRecords: Record<string, { id: string; text: string; done: boolean }> = {
    'todo-A': { id: 'todo-A', text: 'Fictional A', done: false },
    'todo-B': { id: 'todo-B', text: 'Fictional B', done: false },
  }
  const taskOwners: Record<string, string> = {
    'todo-A': 'whatsapp:+14155552671',
    'todo-B': 'whatsapp:+914155552671',
  }
  const fakeDb = {
    from(table: string) {
      assert.ok(['users','todos'].includes(table), 'unexpected privileged table: ' + table)
      let op: 'insert' | 'update' | null = null
      let inserted: any = null
      let updated: any = null
      const filters: Record<string, unknown> = {}
      const query = {
        select(columns: string) {
          assert.equal(columns, table === 'users' ? 'telegram_id,whatsapp_id' : 'id')
          return query
        },
        eq(key: string, value: unknown) {
          filters[key] = value
          if (table === 'users') {
            assert.equal(key, 'telegram_id')
            assert.equal(typeof value, 'string', 'exact persisted owner must go to DB as decimal text')
            ledger.userReads.push(value)
          } else assert.ok(key === 'whatsapp_id' || key === 'id')
          return query
        },
        insert(payload: any) {
          assert.equal(table, 'todos')
          op = 'insert'
          inserted = payload
          ledger.inserts.push(payload)
          return query
        },
        update(payload: any) {
          assert.equal(table, 'todos')
          op = 'update'
          updated = payload
          return query
        },
        async single() {
          assert.equal(table, 'todos')
          assert.equal(op, 'insert')
          if (fixture.mutationError) return { data: null, error: fixture.mutationError }
          return { data: { id: 'new-synthetic-task' }, error: null }
        },
        async maybeSingle() {
          if (table === 'users') {
            assert.equal(filters.telegram_id !== undefined, true, 'missing owner predicate')
            if (fixture.userError) return { data: null, error: fixture.userError }
            const row = Object.prototype.hasOwnProperty.call(fixture, 'returnedRow')
              ? fixture.returnedRow : users[String(filters.telegram_id)] || null
            return { data: row, error: null }
          }
          assert.equal(op, 'update')
          assert.equal(typeof filters.whatsapp_id, 'string')
          ledger.updates.push({ id: filters.id, whatsapp_id: filters.whatsapp_id, patch: updated })
          if (fixture.mutationError) return { data: null, error: fixture.mutationError }
          const id = String(filters.id)
          return { data: taskRecords[id] && taskOwners[id] === filters.whatsapp_id ? { id } : null, error: null }
        },
      }
      return query
    },
  }
  const response = (body: any, options?: { status?: number }) => ({ status: options?.status || 200, body })
  const exports: Record<string, any> = {}
  const imports: Record<string, unknown> = {
    'next/server': { NextResponse: { json: response } },
    '@/lib/dashboard/session': { getSession: async () => fixture.owner == null ? null : ({ telegramId: fixture.owner }) },
    '@/lib/dashboard/guard': { verifySameOrigin: () => fixture.blockOrigin ? response({ ok: false }, { status: 403 }) : null },
    '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
  }
  runInNewContext(transpiled.outputText, {
    exports,
    require: (name: string) => {
      assert.ok(Object.prototype.hasOwnProperty.call(imports, name), 'unexpected import ' + name)
      return imports[name]
    },
    console: { error() {} },
  }, { timeout: 1500 })
  const request = { json: async () => fixture.body ?? (method === 'POST' ? { text: '  Pay   rent  ' } : { id: 'todo-B', done: true }) }
  const result = await exports[method](request)
  return { result: JSON.parse(JSON.stringify(result)), ledger: JSON.parse(JSON.stringify(ledger)) }
}

let controls = 0
let security = 0
async function control(label: string, fn: () => Promise<void>) { await fn(); controls++; console.log('PASS control: ' + label) }
async function guard(label: string, fn: () => Promise<void>) { await fn(); security++; console.log('PASS safety: ' + label) }

await control('ordinary user can create a sanitized to-do under own WhatsApp row', async () => {
  const x = await exercise('POST', { owner: NORMAL })
  assert.equal(x.result.status, 200)
  assert.deepEqual(x.ledger.userReads, [NORMAL])
  assert.equal(x.ledger.inserts[0].whatsapp_id, users[NORMAL].whatsapp_id)
  assert.equal(x.ledger.inserts[0].text, 'Pay rent')
  assert.equal(x.ledger.inserts[0].done, false)
})
await control('negative WhatsApp session owner retains scoped write support', async () => {
  const x = await exercise('POST', { owner: NEGATIVE })
  assert.deepEqual(x.ledger.userReads, [NEGATIVE])
  assert.equal(x.result.status, 200)
  assert.equal(x.ledger.inserts[0].whatsapp_id, users[NEGATIVE].whatsapp_id)
})
await control('normal owner can PATCH their own to-do', async () => {
  const x = await exercise('PATCH', { owner: A, body: { id: 'todo-A', done: true } })
  assert.equal(x.result.status, 200)
  assert.deepEqual(x.ledger.updates.map(x => x.whatsapp_id), [users[A].whatsapp_id])
  assert.equal(x.ledger.updates[0].patch.done, true)
})
await control('a missing task ID returns 404 rather than modifying a different task', async () => {
  const x = await exercise('PATCH', { owner: A, body: { id: 'does-not-exist', done: false } })
  assert.equal(x.result.status, 404)
  assert.equal(x.ledger.updates.length, 1)
  assert.equal(x.ledger.updates[0].whatsapp_id, users[A].whatsapp_id)
})

await guard('adjacent BIGINT account A/B POST targets stay distinct', async () => {
  const a = await exercise('POST', { owner: A })
  const b = await exercise('POST', { owner: B })
  assert.deepEqual(a.ledger.userReads, [A])
  assert.deepEqual(b.ledger.userReads, [B])
  assert.equal(a.ledger.inserts[0].whatsapp_id, users[A].whatsapp_id)
  assert.equal(b.ledger.inserts[0].whatsapp_id, users[B].whatsapp_id)
})
await guard('account B cannot PATCH account A task via forged id', async () => {
  const x = await exercise('PATCH', { owner: B, body: { id: 'todo-A', done: true } })
  assert.equal(x.result.status, 404)
  assert.deepEqual(x.ledger.updates.map(y => y.whatsapp_id), [users[B].whatsapp_id])
})
await guard('user lookup unexpectedly returns another owner: no POST', async () => {
  const x = await exercise('POST', { owner: B, returnedRow: users[A] })
  assert.equal(x.result.status, 409)
  assert.equal(x.ledger.inserts.length, 0)
})
await guard('user lookup unexpectedly returns another owner: no PATCH', async () => {
  const x = await exercise('PATCH', { owner: B, returnedRow: users[A] })
  assert.equal(x.result.status, 409)
  assert.equal(x.ledger.updates.length, 0)
})
await guard('rounded numeric DB owner cannot authorize a to-do write', async () => {
  for (const method of ['POST','PATCH'] as const) {
    const x = await exercise(method, { owner: B, returnedRow: { telegram_id: Number(B), whatsapp_id: users[B].whatsapp_id } })
    assert.equal(x.result.status, 409)
    assert.equal(x.ledger.inserts.length + x.ledger.updates.length, 0)
  }
})
await guard('missing returned owner and missing phone both fail closed', async () => {
  for (const row of [null, { telegram_id: null, whatsapp_id: users[B].whatsapp_id }, { telegram_id: B, whatsapp_id: null }]) {
    const x = await exercise('POST', { owner: B, returnedRow: row })
    assert.equal(x.result.status, 409)
    assert.equal(x.ledger.inserts.length, 0)
  }
})
await guard('invalid or overflowing session owners never reach privileged DB', async () => {
  for (const owner of ['123extra', '123.4', ' 123', '123 ', '+123', '0', '-0', '9223372036854775808', '-9223372036854775809', '1e2', '', 123.4, Number(B)]) {
    const x = await exercise('POST', { owner })
    assert.equal(x.result.status, 409, String(owner))
    assert.deepEqual(x.ledger.userReads, [])
    assert.deepEqual(x.ledger.inserts, [])
  }
})
await guard('unauthenticated and cross-origin calls do not resolve owners or write', async () => {
  for (const method of ['POST', 'PATCH'] as const) {
    const noSession = await exercise(method, { owner: undefined })
    const crossOrigin = await exercise(method, { owner: A, blockOrigin: true })
    assert.equal(noSession.result.status, 401)
    assert.equal(crossOrigin.result.status, 403)
    for (const x of [noSession, crossOrigin]) {
      assert.equal(x.ledger.userReads.length, 0)
      assert.equal(x.ledger.inserts.length + x.ledger.updates.length, 0)
    }
  }
})
await guard('missing task text, id or boolean done never writes', async () => {
  const a = await exercise('POST', { owner: A, body: { text: ' ' } })
  const b = await exercise('PATCH', { owner: A, body: { id: 'todo-A', done: 'yes' } })
  const c = await exercise('PATCH', { owner: A, body: { done: true } })
  assert.equal(a.result.status, 400)
  assert.equal(b.result.status, 400)
  assert.equal(c.result.status, 400)
  assert.equal(a.ledger.inserts.length + b.ledger.updates.length + c.ledger.updates.length, 0)
})
await guard('failed user read never reaches a mutation', async () => {
  for (const method of ['POST','PATCH'] as const) {
    let ledger: any
    try {
      ledger = await exercise(method, { owner: A, userError: { message: 'fictional db outage' } })
    } catch (error: any) {
      assert.match(String(error?.message || error), /fictional db outage|object Object/)
      continue
    }
    assert.equal(ledger.ledger.inserts.length + ledger.ledger.updates.length, 0)
    throw new Error('owner DB outage must not return a success')
  }
})
await guard('provider/DB mutation failure cannot return a successful receipt', async () => {
  for (const method of ['POST','PATCH'] as const) {
    const x = await exercise(method, { owner: A, body: method === 'PATCH' ? { id: 'todo-A', done: true } : { text: 'test' }, mutationError: { message: 'fictional write failure' } })
    assert.equal(x.result.status, 500)
    assert.equal(x.result.body.ok, false)
  }
})

assert.equal(controls, 4)
assert.equal(security, 11)
console.log('Original-source fictional dashboard todo POST/PATCH: 4 positive and 11 owner-isolation safety scenarios PASS')
