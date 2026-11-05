// Security fixture: execute the ORIGINAL dashboard Tasks read and POST/PATCH
// handlers against two inert owners. No DB, HTTP, credentials or provider calls.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

const A = '9007199254740992'
const B = '9007199254740993'
const BAD = '123junk'
const OVERFLOW = '9223372036854775808'
const wa = { [A]: 'whatsapp:+15550100001', [B]: 'whatsapp:+15550100002', 123: 'whatsapp:+15550100003' }
const users = new Map(Object.entries(wa).map(([id, whatsapp_id]) => [id, { whatsapp_id }]))
const todos = [
  { id: 'todo-A', whatsapp_id: wa[A], text: 'A_PRIVATE_TASK', done: false, created_at: '2026-11-05T07:00:00Z', done_at: null },
  { id: 'todo-B', whatsapp_id: wa[B], text: 'B_PRIVATE_TASK', done: false, created_at: '2026-11-05T07:00:00Z', done_at: null },
  { id: 'todo-123', whatsapp_id: wa[123], text: 'SAFE_PRIVATE_TASK', done: false, created_at: '2026-11-05T07:00:00Z', done_at: null },
]
const calls = []
const writes = []

const db = {
  from(table) {
    assert.ok(table === 'users' || table === 'todos', 'no unexpected DB table')
    const predicates = {}
    let operation = 'read'
    let payload
    const query = {
      select() { return query },
      eq(key, value) { predicates[key] = value; return query },
      order() { return query },
      limit() { return query },
      insert(row) { operation = 'insert'; payload = row; return query },
      update(patch) { operation = 'update'; payload = patch; return query },
      async maybeSingle() {
        const result = execute()
        return { data: Array.isArray(result.data) ? result.data[0] || null : result.data, error: result.error }
      },
      async single() {
        const result = execute()
        return { data: Array.isArray(result.data) ? result.data[0] || null : result.data, error: result.error }
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => execute()).then(resolve, reject)
      },
    }
    function execute() {
      calls.push({ table, operation, predicates: { ...predicates } })
      if (table === 'users') {
        assert.equal(operation, 'read')
        assert.equal(Object.keys(predicates).join(','), 'telegram_id', 'users lookup must be exactly owner-bound')
        assert.notEqual(typeof predicates.telegram_id, 'undefined', 'owner predicate required')
        return { data: users.get(String(predicates.telegram_id)) || null, error: null }
      }
      assert.ok(typeof predicates.whatsapp_id === 'string' || operation === 'insert',
        'tasks must be constrained by a proven WhatsApp identity')
      if (operation === 'insert') {
        assert.equal(typeof payload.whatsapp_id, 'string', 'inserting without proven owner forbidden')
        const row = { id: 'new-' + (writes.length + 1), ...payload }
        todos.push(row)
        writes.push({ operation, row: { ...row } })
        return { data: { id: row.id }, error: null }
      }
      if (operation === 'update') {
        assert.ok(predicates.id && predicates.whatsapp_id, 'update requires ID plus exact linked WhatsApp owner')
        const row = todos.find(t => t.id === predicates.id && t.whatsapp_id === predicates.whatsapp_id)
        if (!row) return { data: null, error: null }
        Object.assign(row, payload)
        writes.push({ operation, row: { ...row } })
        return { data: { id: row.id }, error: null }
      }
      assert.equal(typeof predicates.whatsapp_id, 'string')
      return { data: todos.filter(t => t.whatsapp_id === predicates.whatsapp_id), error: null }
    }
    return query
  }
}
function original(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exp = {}
  runInNewContext(js, {
    exports: exp, module: { exports: exp }, Date, Number, BigInt, Buffer, String,
    console: { error() {} }, Promise,
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
      throw Error('unexpected imported dependency: ' + name)
    },
    fetch() { throw Error('test forbids network') },
  }, { filename: path, timeout: 3000 })
  return exp
}
const ownerFns = original('lib/dashboard/owner-identity.ts', {
  'node:crypto': { randomBytes() { throw Error('random allocations forbidden') } },
})
let sessionOwner = B
const deps = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/dashboard/owner-identity': ownerFns,
  '@/lib/dashboard/session': { getSession: async () => ({ telegramId: sessionOwner }) },
  '@/lib/dashboard/guard': { verifySameOrigin: () => null },
  'next/server': { NextResponse: { json: (body, init = {}) => ({ status: init.status || 200, body }) } },
}
const tasks = original('lib/dashboard/tasks.ts', deps)
const route = original('app/api/dashboard/tasks/route.ts', deps)
function request(body) { return { async json() { return body } } }
const names = list => (list || []).map(row => row.label)
function assertNoNewReadsOrWrites(callback, label) {
  return (async () => {
    const beforeCalls = calls.length, beforeWrites = writes.length
    const response = await callback()
    assert.equal(calls.length, beforeCalls, label + ': invalid owner must not read DB')
    assert.equal(writes.length, beforeWrites, label + ': invalid owner must not write DB')
    return response
  })()
}
async function run() {
  let view = await tasks.getDashboardTasks(B)
  assert.equal(view.ok, true)
  assert.deepEqual(names(view.open), ['B_PRIVATE_TASK'], 'B task list cannot expose A')
  assert.equal(calls.at(-2).predicates.telegram_id, B, 'B owner must be exact decimal string')
  view = await tasks.getDashboardTasks(A)
  assert.deepEqual(names(view.open), ['A_PRIVATE_TASK'], 'A task list cannot expose B')
  sessionOwner = B
  let response = await route.POST(request({ text: 'B_NEW_TASK' }))
  assert.equal(response.status, 200)
  assert.equal(writes.at(-1).row.whatsapp_id, wa[B], 'POST may never write A task')
  response = await route.PATCH(request({ id: 'todo-A', done: true }))
  assert.equal(response.status, 404, 'B cannot update another owner todo')
  assert.equal(todos.find(x => x.id === 'todo-A').done, false)
  response = await route.PATCH(request({ id: 'todo-B', done: true }))
  assert.equal(response.status, 200)
  assert.equal(todos.find(x => x.id === 'todo-B').done, true)
  sessionOwner = '123'
  response = await route.POST(request({ text: 'SAFE_NEW_TASK' }))
  assert.equal(response.status, 200)
  assert.equal(writes.at(-1).row.whatsapp_id, wa[123], 'safe existing numeric IDs still work')

  for (const invalid of [BAD, '+123', '01', '0', OVERFLOW, '9007199254740993junk', 'not-an-owner']) {
    sessionOwner = invalid
    const badView = await assertNoNewReadsOrWrites(() => tasks.getDashboardTasks(invalid), 'read ' + invalid)
    assert.equal(badView.ok, true)
    assert.equal(badView.open.length, 0, 'invalid owner must have no visible tasks')
    const badPost = await assertNoNewReadsOrWrites(() => route.POST(request({ text: 'MUST_NOT_CREATE' })), 'post ' + invalid)
    assert.equal(badPost.status, 409)
    const badPatch = await assertNoNewReadsOrWrites(() => route.PATCH(request({ id: 'todo-A', done: true })), 'patch ' + invalid)
    assert.equal(badPatch.status, 409)
  }
  const ownerCalls = calls.filter(c => c.table === 'users').map(c => c.predicates.telegram_id)
  assert.ok(ownerCalls.includes(A) && ownerCalls.includes(B))
  assert.ok(!ownerCalls.includes(BAD))
  assert.equal(todos.find(x => x.id === 'todo-A').text, 'A_PRIVATE_TASK')
  console.log('Dashboard tasks original read and POST/PATCH: two adjacent BIGINT owners isolated, safe owner preserved, invalid owners fail closed; inert DB, no provider I/O')
}
run().catch(e => { console.error(e); process.exitCode = 1 })
