// Inert regression: exercise the real compiled admin users POST route, with no
// network/service-role credentials, production accounts or tier mutations.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Row = { id: string; telegram_id: number | null; whatsapp_id: string; name: string; tier: string }
const state: {
  users: Row[]; readError: boolean; updateError: boolean; insertError: boolean
  staleIdentity: boolean; lookupCalls: string[][]; updates: Array<{ fields: any; filters: any[] }>
  inserts: any[]; authentication: boolean
} = {
  users: [], readError: false, updateError: false, insertError: false,
  staleIdentity: false, lookupCalls: [], updates: [], inserts: [], authentication: true,
}
function reset(rows: Row[] = []) {
  state.users = structuredClone(rows)
  state.readError = state.updateError = state.insertError = state.staleIdentity = false
  state.lookupCalls = []; state.updates = []; state.inserts = []; state.authentication = true
}
const user = (id: string, whatsapp_id: string, telegram_id: number | null = null): Row =>
  ({ id, telegram_id, whatsapp_id, name: 'Inert ' + id, tier: 'free' })

const db = {
  from(table: string) {
    assert.equal(table, 'users', 'tests may only touch fake users table')
    let mode: 'read' | 'update' | 'insert' = 'read'
    let forms: string[] = []
    let limit = 0
    let updateFields: any
    let insertFields: any
    const filters: Array<{ key: string; value: unknown }> = []
    const query: any = {
      select(_columns?: string) { return query },
      in(key: string, values: string[]) {
        assert.equal(mode, 'read'); assert.equal(key, 'whatsapp_id')
        assert.ok(Array.isArray(values)); forms = values
        state.lookupCalls.push(values)
        return query
      },
      limit(value: number) { assert.equal(value, 2, 'never truncate ambiguity to first matching account'); limit = value; return query },
      update(fields: any) { mode = 'update'; updateFields = fields; return query },
      eq(key: string, value: unknown) { assert.equal(mode, 'update'); filters.push({ key, value }); return query },
      insert(fields: any) { mode = 'insert'; insertFields = fields; state.inserts.push(fields); return query },
      async maybeSingle() {
        assert.equal(mode, 'update')
        state.updates.push({ fields: updateFields, filters })
        if (state.updateError) return { data: null, error: { message: 'synthetic update rejected' } }
        if (state.staleIdentity) return { data: null, error: null }
        const matches = state.users.filter(row => filters.every(f => (row as any)[f.key] === f.value))
        assert.ok(matches.length <= 1, 'update must identify at most one row')
        const row = matches[0]
        if (!row) return { data: null, error: null }
        Object.assign(row, updateFields)
        return { data: { ...row }, error: null }
      },
      async single() {
        assert.equal(mode, 'insert')
        if (state.insertError) return { data: null, error: { message: 'synthetic unique collision' } }
        const row = { id: 'new-id', telegram_id: null, ...insertFields }
        state.users.push(row)
        return { data: row, error: null }
      },
      then(resolve: (result: unknown) => void, reject: (reason: unknown) => void) {
        assert.equal(mode, 'read')
        assert.equal(limit, 2)
        return Promise.resolve(state.readError
          ? { data: null, error: { message: 'synthetic lookup failure' } }
          : { data: state.users.filter(row => forms.includes(row.whatsapp_id)).slice(0, limit), error: null },
        ).then(resolve, reject)
      },
    }
    return query
  },
}

const source = readFileSync(new URL('../app/api/admin/users/route.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports: Record<string, any> = {}
runInNewContext(compiled, {
  exports, Response,
  process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fake-never-used' } },
  require(id: string) {
    if (id === 'next/server') return {
      NextResponse: { json: (body: unknown, options: { status?: number } = {}) =>
        new Response(JSON.stringify(body), { status: options.status || 200 }) },
    }
    if (id === '@supabase/supabase-js') return { createClient: () => db }
    if (id === '@/lib/admin/auth') return {
      requireAdminSession: async () => state.authentication
        ? { ok: true } : { ok: false, reason: 'forbidden', status: 403 },
    }
    if (id === '@/lib/dashboard/guard') return { verifySameOrigin: () => null }
    throw new Error('unexpected dependency: ' + id)
  },
}, { filename: 'app/api/admin/users/route.ts', timeout: 1500 })
assert.equal(typeof exports.POST, 'function', 'exercise real transpiled POST handler')

let checks = 0
async function check(label: string, fn: () => Promise<void>) {
  reset()
  await fn()
  checks++
  console.log('PASS admin tier owner isolation: ' + label)
}
async function tier(phone: unknown, nextTier = 'pro') {
  const response: Response = await exports.POST({
    json: async () => ({ action: 'set_tier', phone, tier: nextTier, name: 'Fixture Name' }),
  })
  return { status: response.status, body: await response.json() as any }
}

await check('same trailing ten digits in different countries never update foreign owner', async () => {
  state.users = [user('foreign', 'whatsapp:+14155552671', 100)]
  const response = await tier('+914155552671')
  assert.equal(response.status, 200)
  assert.equal(response.body.action, 'created')
  assert.equal(state.users[0].tier, 'free')
  assert.equal(state.inserts.length, 1)
  assert.equal(state.inserts[0].whatsapp_id, 'whatsapp:+914155552671')
  assert.equal(state.updates.length, 0)
})
await check('unique exact full international phone updates only targeted row ID', async () => {
  state.users = [user('foreign', 'whatsapp:+14155552671', 100),
    user('owner', '+914155552671', 200)]
  const response = await tier('+914155552671', 'founder_pro')
  assert.equal(response.status, 200)
  assert.equal(response.body.action, 'updated')
  assert.equal(response.body.user.id, 'owner')
  assert.equal(state.users[0].tier, 'free')
  assert.equal(state.users[1].tier, 'founder_pro')
  assert.deepEqual(state.updates[0].filters.map(x => x.key), ['id', 'whatsapp_id'])
  assert.equal(state.updates[0].filters[0].value, 'owner')
  assert.equal(state.inserts.length, 0)
})
await check('ambiguous rows of the same complete phone fail closed', async () => {
  state.users = [user('a', 'whatsapp:+919876543210', 10), user('b', '+919876543210', 11)]
  const response = await tier('+919876543210')
  assert.equal(response.status, 409)
  assert.equal(state.updates.length + state.inserts.length, 0)
})
await check('database read outage never provisions or updates a user', async () => {
  state.readError = true
  const response = await tier('+919876543210')
  assert.equal(response.status, 503)
  assert.equal(state.updates.length + state.inserts.length, 0)
})
await check('null legacy telegram ID still updates only its exact UUID row', async () => {
  state.users = [user('uuid-owner', 'whatsapp:+6591234567', null)]
  const response = await tier('+6591234567')
  assert.equal(response.status, 200)
  assert.equal(response.body.user.id, 'uuid-owner')
  assert.deepEqual(state.updates[0].filters.map(x => x.key), ['id', 'whatsapp_id'])
})
await check('write error cannot be reported as a successful entitlement update', async () => {
  state.users = [user('owner', 'whatsapp:+919876543210', 10)]
  state.updateError = true
  const response = await tier('+919876543210')
  assert.equal(response.status, 503)
  assert.ok(!response.body.ok)
})
await check('stale phone binding at update returns conflict, not success', async () => {
  state.users = [user('owner', 'whatsapp:+919876543210', 10)]
  state.staleIdentity = true
  const response = await tier('+919876543210')
  assert.equal(response.status, 409)
  assert.ok(!response.body.ok)
})
await check('new owner provisioning only follows complete zero-match lookup', async () => {
  const response = await tier('+6591234567')
  assert.equal(response.status, 200)
  assert.equal(response.body.action, 'created')
  assert.equal(state.inserts[0].whatsapp_id, 'whatsapp:+6591234567')
  assert.equal(state.lookupCalls.length, 1)
  assert.deepEqual(state.lookupCalls[0], [
    '+6591234567', 'whatsapp:+6591234567', '6591234567', 'whatsapp:6591234567',
  ])
})
await check('insert error never returns success', async () => {
  state.insertError = true
  const response = await tier('+6591234567')
  assert.equal(response.status, 503)
  assert.ok(!response.body.ok)
})
await check('unverified local, unprefixed and malformed phones are rejected before DB access', async () => {
  for (const value of ['9876543210', '919876543210', '+919876543210;ext=4',
    'whatsapp:9876543210', '+0000000000', '+912345', null, 919876543210]) {
    const response = await tier(value)
    assert.equal(response.status, value === null ? 400 : 400)
    assert.equal(state.lookupCalls.length, 0)
  }
})
await check('authorization remains before any user lookup or write', async () => {
  state.authentication = false
  const response = await tier('+919876543210')
  assert.equal(response.status, 403)
  assert.equal(state.lookupCalls.length + state.updates.length + state.inserts.length, 0)
})
assert.doesNotMatch(source.slice(source.indexOf('export async function POST')), /\.ilike\(/,
  'admin write path cannot fuzzy-match another owner')
assert.match(source, /\.eq\('id', existing\.id\)/)
assert.match(source, /\.eq\('whatsapp_id', existing\.whatsapp_id\)/)
console.log(`admin tier exact-owner regression passed (${checks} inert cases)`)
