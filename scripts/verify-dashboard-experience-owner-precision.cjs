// Original-route, two-owner isolation fixture for dashboard Experience GET and POST.
// Synthetic session/DB only: no network, credentials, real account, or provider actions.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

const A = '9007199254740992'
const B = '9007199254740993'
const values = new Map([
  [A, { personality: 'calm_companion', comfort_drink: 'coffee' }],
  [B, { personality: 'sharp_professional', comfort_drink: 'tea' }],
  ['123', { personality: 'quiet_minimalist', comfort_drink: 'water' }],
  ['-2301', { personality: 'calm_companion', comfort_drink: 'matcha' }],
])
const dbReads = []
const dbWrites = []
let failRead = false
let failWrite = false
let sessionOwner = B

const supabaseAdmin = {
  from(table) {
    assert.equal(table, 'user_experience_preferences', 'test must never touch another DB table')
    const predicate = {}
    const query = {
      select(cols) {
        assert.equal(cols, 'personality, comfort_drink')
        return query
      },
      eq(column, id) {
        assert.equal(column, 'telegram_id')
        predicate.owner = id
        return query
      },
      async maybeSingle() {
        assert.notEqual(predicate.owner, undefined, 'read must have exact owner filter')
        dbReads.push(predicate.owner)
        if (failRead) return { data: null, error: { message: 'synthetic read failure' } }
        return { data: values.get(String(predicate.owner)) || null, error: null }
      },
      async upsert(data, options) {
        assert.equal(options.onConflict, 'telegram_id')
        assert.ok(data.telegram_id !== undefined, 'upsert requires explicit owner')
        dbWrites.push({ ...data })
        if (failWrite) return { error: { message: 'synthetic write failure' } }
        values.set(String(data.telegram_id), {
          personality: data.personality,
          comfort_drink: data.comfort_drink,
        })
        return { error: null }
      },
    }
    return query
  },
}

function original(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const originalExports = {}
  runInNewContext(js, {
    exports: originalExports,
    module: { exports: originalExports },
    URL, Number, BigInt, Set, String, Date, Promise,
    console: { error() {} }, process: { env: {} },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
      throw Error('unexpected original-module dependency: ' + name)
    },
    fetch() { throw Error('network forbidden') },
  }, { filename: path, timeout: 3000 })
  return originalExports
}
const exactOwner = original('lib/dashboard/exact-owner-id.ts', {})
const route = original('app/api/dashboard/experience/route.ts', {
  'next/server': {
    NextResponse: {
      json(body, opts = {}) { return { status: opts.status || 200, body } },
    },
  },
  '@/lib/dashboard/session': { getSession: async () => sessionOwner !== null ? { telegramId: sessionOwner } : null },
  '@/lib/supabase-admin': { supabaseAdmin },
  '@/lib/dashboard/exact-owner-id': exactOwner,
})
const request = (body, origin = 'https://app.askgogo.in') => ({
  headers: { get(name) { return name === 'origin' ? origin : null } },
  nextUrl: { host: 'app.askgogo.in' },
  async json() { return body },
})

async function run() {
  for (const [owner, name, drink, predicateType] of [
    [A, 'calm_companion', 'coffee', 'string'],
    [B, 'sharp_professional', 'tea', 'string'],
    ['123', 'quiet_minimalist', 'water', 'number'],
    ['-2301', 'calm_companion', 'matcha', 'number'],
  ]) {
    sessionOwner = owner
    const response = await route.GET()
    assert.equal(response.status, 200, 'GET must succeed only with exact owner')
    assert.equal(response.body.personality, name, 'GET must not expose adjacent tenant')
    assert.equal(response.body.comfortDrink, drink)
    assert.equal(String(dbReads.at(-1)), owner, 'owner comparison must be exact')
    assert.equal(typeof dbReads.at(-1), predicateType, 'BIGINT precision or legacy safe-number type')
  }

  sessionOwner = B
  let response = await route.POST(request({ personality: 'straight_talking_coach', comfortDrink: 'coconut_water' }))
  assert.equal(response.status, 200)
  assert.equal(dbWrites.at(-1).telegram_id, B, 'POST must bind exact owner B')
  assert.equal(values.get(B).comfort_drink, 'coconut_water')
  assert.equal(values.get(A).comfort_drink, 'coffee', 'POST for B must not alter owner A')

  sessionOwner = A
  response = await route.GET()
  assert.equal(response.body.comfortDrink, 'coffee', 'A must not observe B preferences')
  response = await route.POST(request({ personality: 'quiet_minimalist', comfortDrink: 'water' }))
  assert.equal(response.status, 200)
  assert.equal(dbWrites.at(-1).telegram_id, A)
  assert.equal(values.get(B).comfort_drink, 'coconut_water', 'A must not alter B')

  sessionOwner = '123'
  response = await route.POST(request({ personality: 'calm_companion', comfortDrink: 'coffee' }))
  assert.equal(response.status, 200)
  assert.equal(dbWrites.at(-1).telegram_id, 123, 'legacy safe-number semantics preserved')

  for (const invalid of [
    '123junk', '00123', '+123', '0', '-0', '', 'not-an-id', '9007199254740993junk',
    '9223372036854775808', '-9223372036854775809', '1e3', ' 123 ',
  ]) {
    sessionOwner = invalid
    const beforeReads = dbReads.length, beforeWrites = dbWrites.length
    response = await route.GET()
    assert.equal(response.status, 400, 'GET malformed owner denied: ' + invalid)
    response = await route.POST(request({ personality: 'calm_companion', comfortDrink: 'tea' }))
    assert.equal(response.status, 400, 'POST malformed owner denied: ' + invalid)
    assert.equal(dbReads.length, beforeReads, 'invalid owner must not read DB: ' + invalid)
    assert.equal(dbWrites.length, beforeWrites, 'invalid owner must not mutate DB: ' + invalid)
  }

  sessionOwner = B
  const beforeWrites = dbWrites.length
  response = await route.POST(request({ personality: 'invalid', comfortDrink: 'tea' }))
  assert.equal(response.status, 400, 'invalid preference must be rejected')
  response = await route.POST(request({ personality: 'calm_companion', comfortDrink: 'tea' }, null))
  assert.equal(response.status, 403, 'missing Origin must reject write')
  assert.equal(dbWrites.length, beforeWrites, 'no rejected write reaches DB')
  failRead = true
  response = await route.GET()
  assert.equal(response.status, 500, 'read failure cannot masquerade as default profile')
  failRead = false
  failWrite = true
  response = await route.POST(request({ personality: 'calm_companion', comfortDrink: 'tea' }))
  assert.equal(response.status, 500, 'write failure cannot claim save succeeded')
  failWrite = false
  sessionOwner = null
  response = await route.GET()
  assert.equal(response.status, 401, 'unsigned GET denied')
  response = await route.POST(request({ personality: 'calm_companion', comfortDrink: 'tea' }))
  assert.equal(response.status, 401, 'unsigned POST denied')

  assert.ok(dbReads.includes(A) && dbReads.includes(B))
  assert.ok(dbWrites.some(x => x.telegram_id === A) && dbWrites.some(x => x.telegram_id === B))
  assert.equal(values.get(A).comfort_drink, 'water')
  console.log('Dashboard Experience ORIGINAL GET/POST: two adjacent BIGINT owners isolated, safe/negative owners preserved, malformed IDs deny reads/writes, origin and DB failure boundaries PASS (inert only)')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
