// Literal original-handler regression; all data/credentials are synthetic.
// Never invokes a real DB, provider, production endpoint or customer account.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function loadOriginal(path, mocks, env) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exportsObject = {}
  runInNewContext(js, {
    exports: exportsObject,
    module: { exports: exportsObject },
    URL, Date, Intl, Buffer, String, Number, Promise, Object, Set, Map, console,
    process: { env },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
      throw Error('Unexpected dependency: ' + name)
    },
    fetch() { throw Error('network access forbidden') },
  }, { filename: path, timeout: 3000 })
  return exportsObject
}

const env = { CRON_SECRET: '' }
const probe = { reads: 0, queried: [] }
const syntheticRow = {
  id: 101,
  telegram_id: '123',
  chat_id: 'synthetic-chat',
  whatsapp_to: 'synthetic-recipient',
  message: 'synthetic private reminder',
  remind_at: '2026-11-06T10:00:00.000Z',
  created_at: '2026-11-05T08:00:00.000Z',
  sent: false,
  is_recurring: false,
  recurring_pattern: null,
}
const db = {
  from(table) {
    probe.reads++
    assert.equal(table, 'reminders', 'debug route may only inspect synthetic reminders')
    const query = {
      select(columns) {
        probe.queried.push(columns)
        assert.match(columns, /message/)
        return query
      },
      order(key) {
        assert.equal(key, 'created_at')
        return query
      },
      limit(value) {
        assert.equal(value, 20)
        return Promise.resolve({ data: [syntheticRow], error: null })
      },
    }
    return query
  },
}
const cron = loadOriginal('lib/security/cron-auth.ts', {
  crypto: require('node:crypto'),
}, env)
const route = loadOriginal('app/api/debug/reminders/route.ts', {
  'next/server': {
    NextResponse: { json(body, options = {}) {
      return { body, status: options.status || 200 }
    } },
  },
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/security/cron-auth': { isCronAuthorized: request => cron.isCronAuthorized(request, env) },
}, env)

function request(querySecret, authorization) {
  const query = querySecret === null ? '' : '?secret=' + encodeURIComponent(querySecret)
  const url = 'https://app.askgogo.in/api/debug/reminders' + query
  return {
    url,
    headers: {
      get(name) {
        return name.toLowerCase() === 'authorization' ? (authorization ?? null) : null
      },
    },
  }
}

async function denied(label, querySecret, authorization) {
  const before = probe.reads
  const result = await route.GET(request(querySecret, authorization))
  assert.equal(result.status, 401, label + ' must be denied')
  assert.equal(probe.reads, before, label + ' must not read any private rows')
  assert.equal(result.body.reminders, undefined, label + ' must not disclose results')
}

async function accepted(label, querySecret, authorization) {
  const before = probe.reads
  const result = await route.GET(request(querySecret, authorization))
  assert.equal(result.status, 200, label + ' should preserve authorized debug contract')
  assert.equal(result.body.count, 1)
  assert.equal(result.body.reminders[0].message, syntheticRow.message)
  assert.equal(result.body.reminders[0].whatsapp_to, syntheticRow.whatsapp_to)
  assert.equal(probe.reads, before + 1, label + ' should make exactly one synthetic read')
}

async function run() {
  // The original route wrongly allowed ?secret= when CRON_SECRET was the empty string.
  env.CRON_SECRET = ''
  await denied('empty configuration + empty query', '')
  await denied('empty configuration + missing query', null)
  await denied('empty configuration + empty Bearer', null, 'Bearer ')
  await denied('empty configuration + forged Bearer', null, 'Bearer guessed')
  delete env.CRON_SECRET
  await denied('missing configuration + empty query', '')
  await denied('missing configuration + forged query', 'guessed')
  env.CRON_SECRET = 'synthetic-valid-secret-123'
  await denied('correct config + blank query', '')
  await denied('correct config + missing credentials', null)
  await denied('correct config + wrong query', 'not-valid')
  await denied('correct config + wrong header', null, 'Bearer not-valid')
  await denied('correct config + both wrong', 'not-valid', 'Bearer not-valid')
  await accepted('legacy exact query', env.CRON_SECRET, null)
  await accepted('Bearer header', null, 'Bearer ' + env.CRON_SECRET)
  assert.equal(probe.reads, 2, 'only two explicitly authorized inert DB reads')
  console.log('PASS original debug/reminders GET: blank/missing/wrong cron secrets denied before private reads; exact query/Bearer accepted with synthetic rows only')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
