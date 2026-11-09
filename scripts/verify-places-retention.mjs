// Original-function regression for saved home/office owner isolation and retention truthfulness.
// Executes TypeScript source with inert PostgREST; no customer DB, LLM, network or real sends.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const requireReal = createRequire(import.meta.url)
const ts = requireReal('typescript')
const source = readFileSync('lib/agent/places-context.ts', 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const ownerA = '9007199254740993'
const ownerB = '9007199254740992'

function fixture({ rows = [], deletionFails = false, silentDelete = false, verifyFails = false, insertFails = false } = {}) {
  const state = {
    rows: rows.map(r => ({ ...r })),
    queriedOwners: [],
    deletionFails, silentDelete, verifyFails, insertFails,
    next: 100,
  }
  class Query {
    constructor(mode, value) { this.mode = mode; this.value = value; this.filters = []; this.max = null }
    select(fields) { this.fields = fields; return this }
    eq(key, value) { this.filters.push(r => String(r[key]) === String(value)); if (key === 'telegram_id') state.queriedOwners.push(value); return this }
    neq(key, value) { this.filters.push(r => String(r[key]) !== String(value)); return this }
    ilike(key, pattern) {
      // Only the exact prefix filters used by the source are permitted.
      assert.match(pattern, /^(?:Home|Office) area:%$/)
      const prefix = pattern.slice(0, -1).toLowerCase()
      this.filters.push(r => String(r[key] || '').toLowerCase().startsWith(prefix))
      return this
    }
    limit(n) { this.max = n; return this }
    single() { return Promise.resolve(this.run()) }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject) }
    run() {
      if (this.mode === 'insert') {
        if (state.insertFails) return { data: null, error: { message: 'inert insert denied' } }
        const row = { ...this.value, id: String(++state.next) }
        state.rows.push(row)
        return { data: { id: row.id }, error: null }
      }
      const matching = state.rows.filter(r => this.filters.every(f => f(r)))
      if (this.mode === 'delete') {
        if (state.deletionFails) return { data: null, error: { message: 'inert delete denied' } }
        if (!state.silentDelete) {
          const keys = new Set(matching)
          state.rows = state.rows.filter(r => !keys.has(r))
        }
        return { data: null, error: null }
      }
      if (this.mode === 'select') {
        if (state.verifyFails) return { data: null, error: { message: 'inert verification denied' } }
        const sliced = this.max == null ? matching : matching.slice(0, this.max)
        return { data: sliced.map(r => this.fields === 'id' ? { id: r.id } : { ...r }), error: null }
      }
      throw new Error('unexpected fake operation')
    }
  }
  const db = { from(table) {
    assert.equal(table, 'memories', 'no unrelated table or production provider is reachable')
    return {
      insert: value => new Query('insert', value),
      delete: () => new Query('delete'),
      select: fields => new Query('select').select(fields),
    }
  }}
  const mocks = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    './places-search': { answerPlaces: async () => null, homeAreaFrom: () => null, nearbyRewrite: () => null },
    './taste': { listTaste: async () => [] },
  }
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: name => {
      assert.ok(Object.hasOwn(mocks, name), 'unexpected dependency ' + name)
      return mocks[name]
    },
    console, Date, fetch: () => { throw new Error('unexpected network fetch') },
  }, { filename: 'places-context.original.js', timeout: 4000 })
  assert.equal(typeof module.exports.savePlace, 'function')
  assert.equal(typeof module.exports.tryPlaceCommand, 'function')
  return { state, places: module.exports }
}

function row(id, owner, content) { return { id: String(id), telegram_id: owner, content } }
const newHome = { kind: 'home', area: 'Whitefield', pincode: '560066' }

{
  const f = fixture({ rows: [
    row(1, ownerA, 'Home area: Rajajinagar'),
    row(2, ownerA, 'Home area: Koramangala'),
    row(3, ownerA, 'Office area: MG Road'),
    row(4, ownerB, 'Home area: Jayanagar'),
  ] })
  assert.equal(await f.places.savePlace(ownerA, newHome), true)
  assert.deepEqual(f.state.rows.filter(r => r.telegram_id === ownerA && r.content.startsWith('Home area:')).map(r => r.content), ['Home area: Whitefield (560066)'], 'all prior home addresses must be removed for exact owner')
  assert.equal(f.state.rows.find(r => r.id === '3').content, 'Office area: MG Road', 'office retains separate scope')
  assert.equal(f.state.rows.find(r => r.id === '4').content, 'Home area: Jayanagar', 'other owner unchanged')
  assert.ok(f.state.queriedOwners.every(x => x === ownerA), 'query filters always use exact owner')
}
{
  const f = fixture({ rows: [row(1, ownerA, 'Home area: Rajajinagar')], deletionFails: true })
  assert.equal(await f.places.savePlace(ownerA, newHome), false, 'database deletion error must not be reported as verified success')
  const reply = await f.places.tryPlaceCommand({ telegramId: ownerA, text: 'I live in Whitefield' })
  assert.match(reply, /couldn't verify.*home.*updated/i, 'chat must report uncertain retention instead of falling through to false success')
}
{
  const f = fixture({ rows: [row(1, ownerA, 'Home area: Rajajinagar')], silentDelete: true })
  assert.equal(await f.places.savePlace(ownerA, newHome), false, 'acknowledged but ineffective delete must fail readback')
  assert.ok(f.state.rows.some(r => r.content === 'Home area: Rajajinagar'))
}
{
  const f = fixture({ rows: [row(1, ownerA, 'Home area: Rajajinagar')], verifyFails: true })
  assert.equal(await f.places.savePlace(ownerA, newHome), false, 'failed verification must be uncertain')
}
{
  const f = fixture({ insertFails: true })
  assert.equal(await f.places.savePlace(ownerA, newHome), false)
  assert.equal(f.state.rows.length, 0)
}
{
  const f = fixture()
  assert.equal(await f.places.savePlace(ownerA, newHome), true, 'first save without previous address')
  assert.equal(f.state.rows.length, 1)
}
{
  const f = fixture({ rows: [row(1, ownerB, 'Home area: Jayanagar')] })
  const unsafeOwner = Number.MAX_SAFE_INTEGER + 1
  assert.equal(await f.places.savePlace(unsafeOwner, newHome), false, 'rounded numeric BIGINT must fail closed')
  assert.equal(await f.places.tryPlaceCommand({ telegramId: unsafeOwner, text: 'I live in Whitefield' }), null, 'never read/write rounded owner')
  assert.equal(await f.places.answerPlacesWithContext({ telegramId: unsafeOwner, text: 'find pizza nearby' }), null)
  assert.equal(f.state.rows.length, 1)
  assert.equal(f.state.queriedOwners.length, 0, 'unsafe owner causes no service-role query')
}
console.log('Saved-place exact-owner insert/delete/readback and uncertain-outcome regressions passed')
