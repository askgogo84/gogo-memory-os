// Synthetic, sealed original-source regression for dormant email-attention event expiry.
// All records, email data, dates and DB/provider responses are fictional. No external I/O.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const NOW = Date.parse('2026-11-02T00:00:00.000Z')
const DAY = 86_400_000
const CUTOFF = new Date(NOW - 30 * DAY).toISOString()
const at = days => new Date(NOW - days * DAY).toISOString()
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const TestDate = class extends Date { static now() { return NOW } }
const src = readFileSync('app/api/cron/email-attention-retention/route.ts', 'utf8')
const setup = JSON.parse(readFileSync('vercel.json', 'utf8'))
const job = setup.crons.filter(c => c.path === '/api/cron/email-attention-retention')
const result = { controls: 0, mandatory: 0, failures: [] }
async function check(name, fn, mandatory = true) {
  try { await fn(); result[mandatory ? 'mandatory' : 'controls']++; console.log('PASS ' + (mandatory ? 'MANDATORY' : 'CONTROL') + ': ' + name) }
  catch (err) { const message = String(err?.message || err); result.failures.push({ name, message }); console.error('FAIL: ' + name + ' -- ' + message) }
}

function fixture(records, options = {}) {
  const db = { rows: records.map(row => ({...row})), calls: [], failRead: false, failDelete: false, beforeDelete: null }
  const capturedErrors = []
  const env = { CRON_SECRET: 'synthetic-cron-secret' }
  const fakeClient = {
    from(table) {
      assert.equal(table, 'email_attention_events', 'cleanup must not touch another table')
      let mode = 'read'
      let fields = ''
      const filters = []
      let cap = Infinity
      let order = null
      const chain = {
        select(s) { fields = s; return chain },
        delete() { mode = 'delete'; return chain },
        eq(col, val) { filters.push(['eq', col, val]); return chain },
        lt(col, val) { filters.push(['lt', col, val]); return chain },
        in(col, val) { filters.push(['in', col, val]); return chain },
        order(col, opts) { order = [col, opts]; return chain },
        limit(n) { cap = n; return chain },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            db.calls.push({ mode, table, fields, filters: filters.map(x => [...x]), cap, order })
            if (mode === 'read' && db.failRead) return { data: null, error: { message: 'synthetic read failed' } }
            if (mode === 'delete' && db.failDelete) return { data: null, error: { message: 'synthetic delete failed' } }
            if (mode === 'delete' && db.beforeDelete) db.beforeDelete(db.rows)
            function matches(row) {
              return filters.every(([op, col, val]) => op === 'eq' ? row[col] === val
                : op === 'lt' ? Date.parse(row[col]) < Date.parse(val)
                : op === 'in' ? val.includes(row[col]) : false)
            }
            const matchesRows = db.rows.filter(matches)
            if (mode === 'delete') {
              const removed = []
              for (let j = db.rows.length - 1; j >= 0; j--) {
                if (matches(db.rows[j])) removed.push({ id: db.rows[j].id })
              }
              db.rows = db.rows.filter(row => !matches(row))
              return { data: removed, error: null }
            }
            if (order) matchesRows.sort((a,b) => String(a[order[0]]).localeCompare(String(b[order[0]])))
            return { data: matchesRows.slice(0, cap).map(r => ({ id: r.id })), error: null }
          }).then(resolve, reject)
        },
      }
      return chain
    },
  }
  const exportsObj = {}
  const transpiled = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const modules = {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ status: options.status || 200, body }) } },
    '@/lib/security/cron-auth': {
      isCronAuthorized: request => Boolean(env.CRON_SECRET) &&
        request.headers.get('authorization') === 'Bearer ' + env.CRON_SECRET,
    },
    '@/lib/supabase-admin': { supabaseAdmin: fakeClient },
  }
  runInNewContext(transpiled, {
    exports: exportsObj, require: name => {
      assert.ok(Object.prototype.hasOwnProperty.call(modules, name), 'unexpected import ' + name)
      return modules[name]
    },
    process: { env }, Date: TestDate,
    console: { error: message => capturedErrors.push(String(message)) },
  }, { filename: 'sealed-email-attention-retention-route.js', timeout: 2000 })
  const request = (token = 'synthetic-cron-secret') => ({
    url: 'https://example.invalid/api/cron/email-attention-retention',
    headers: { get: key => key === 'authorization' ? (token ? 'Bearer ' + token : null) : null },
  })
  return { db, env, capturedErrors, GET: exportsObj.GET, request }
}

const old = (n, owner, days, kind = 'shown') => ({
  id: id(n), telegram_id: owner, kind, created_at: at(days),
  payload: { items: [{ from: 'Synthetic Person <sender@example.invalid>',
    subject: 'Fictional private business review', snippet: 'Fictional confidential example text' }] },
})
await check('cron is independently scheduled exactly once and uses no new credentials', () => {
  assert.equal(job.length, 1)
  assert.match(job[0].schedule, /^[0-9*,\/-]+(?:\s+[0-9*,\/-]+){4}$/)
  assert.match(src, /isCronAuthorized/)
  assert.match(src, /\.select\('id'\)/)
  assert.doesNotMatch(src, /\.select\(['"]\*['"]\)|\.select\(['"]payload|sendWhatsApp|sendAskGogoEmail/)
}, false)
await check('authenticated existing bearer cron succeeds on empty table', async () => {
  const f = fixture([])
  const r = await f.GET(f.request())
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(JSON.stringify(r.body)), { ok: true, examined: 0, deleted: 0, moreMayRemain: false })
}, false)
await check('no auth / bad auth / unset secret denies before service-role query', async () => {
  const f = fixture([old(1, 101, 31)])
  assert.equal((await f.GET(f.request(null))).status, 401)
  assert.equal((await f.GET(f.request('wrong'))).status, 401)
  f.env.CRON_SECRET = undefined
  assert.equal((await f.GET(f.request())).status, 401)
  assert.equal(f.db.calls.length, 0)
})
await check('expired shown events from distinct dormant owners disappear; all newer rows survive', async () => {
  const f = fixture([old(1, 101, 31), old(2, -202, 50), old(3, 303, 5), old(4, 404, 30), old(5, 505, 70, 'important')])
  const r = await f.GET(f.request())
  assert.equal(r.status, 200)
  assert.equal(r.body.deleted, 2)
  assert.deepEqual(f.db.rows.map(x => x.id).sort(), [id(3), id(4), id(5)].sort())
  assert.equal(f.db.calls[0].fields, 'id')
  const del = f.db.calls.find(c => c.mode === 'delete')
  assert.equal(del.fields, 'id')
  assert.ok(del.filters.some(x => x[0] === 'eq' && x[1] === 'kind' && x[2] === 'shown'))
  assert.ok(del.filters.some(x => x[0] === 'lt' && x[1] === 'created_at' && x[2] === CUTOFF))
  assert.ok(del.filters.some(x => x[0] === 'in' && x[1] === 'id' && x[2].length === 2))
  assert.equal(JSON.stringify(r.body).includes('example.invalid'), false)
})
await check('concurrent refresh to newer timestamp after candidate selection survives revalidated delete', async () => {
  const f = fixture([old(1, 111, 31), old(2, 222, 35)])
  f.db.beforeDelete = rows => { rows.find(x => x.id === id(1)).created_at = at(1) }
  const r = await f.GET(f.request())
  assert.equal(r.status, 200)
  assert.equal(r.body.deleted, 1)
  assert.deepEqual(f.db.rows.map(x => x.id), [id(1)])
})
await check('bounded oldest-first batch prevents unbounded destructive operation', async () => {
  const f = fixture(Array.from({length: 105}, (_,i) => old(i+1, i % 2 ? 19 : 20, 31+i)))
  const r = await f.GET(f.request())
  assert.equal(r.status, 200)
  assert.equal(r.body.examined, 100)
  assert.equal(r.body.deleted, 100)
  assert.equal(r.body.moreMayRemain, true)
  assert.equal(f.db.rows.length, 5)
  assert.equal(f.db.calls[0].cap, 100)
})
await check('repeated invocation idempotent: old content does not reappear or resurrect', async () => {
  const f = fixture([old(1, 101, 32)])
  assert.equal((await f.GET(f.request())).body.deleted, 1)
  assert.equal((await f.GET(f.request())).body.deleted, 0)
  assert.equal(f.db.rows.length, 0)
})
await check('select error is visible as failure, not silent success or a destructive action', async () => {
  const f = fixture([old(1, 101, 40)])
  f.db.failRead = true
  const r = await f.GET(f.request())
  assert.equal(r.status, 503)
  assert.equal(r.body.error, 'retention_read_failed')
  assert.equal(f.db.rows.length, 1)
  assert.equal(f.db.calls.some(c => c.mode === 'delete'), false)
})
await check('delete error is visible; private DB error never enters the response', async () => {
  const f = fixture([old(1, 101, 40)])
  f.db.failDelete = true
  const r = await f.GET(f.request())
  assert.equal(r.status, 503)
  assert.equal(r.body.error, 'retention_delete_failed')
  assert.equal(f.db.rows.length, 1)
  assert.equal(JSON.stringify(r.body).includes('synthetic'), false)
})
await check('unexpected malformed selected database ID fails closed without broad delete', async () => {
  const f = fixture([{...old(1, 101, 40), id:'not-a-uuid'}])
  const r = await f.GET(f.request())
  assert.equal(r.status, 503)
  assert.equal(r.body.error, 'retention_ids_invalid')
  assert.equal(f.db.calls.some(c => c.mode === 'delete'), false)
})
console.log('EMAIL_ATTENTION_SHOWN_RETENTION_FIX ' + JSON.stringify({controls:result.controls,mandatory:result.mandatory,failed:result.failures.length,synthetic:true}))
if (result.failures.length) process.exitCode = 1
