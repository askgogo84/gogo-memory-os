// Original-module, no-provider test for the legacy briefing GET authentication boundary.
// Models a misconfigured (empty) CRON_SECRET. Real DB, network, WhatsApp and sends are forbidden.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

function original(path, mocks, env) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const result = {}
  runInNewContext(js, {
    exports: result, module: { exports: result }, URL, Buffer, Date, Number, String,
    Promise, Object, Set, Map, console: { error() {} }, process: { env },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
      throw Error('Unexpected module dependency: ' + name)
    },
    fetch() { throw Error('external network forbidden') },
  }, { filename: path, timeout: 3000 })
  return result
}

const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-not-a-key',
  CRON_SECRET: '',
}
const audit = { reads: 0, sends: 0, tables: [] }
const db = {
  from(name) {
    audit.reads++
    audit.tables.push(name)
    assert.equal(name, 'users', 'GET must only list users for authorized fanout')
    const query = {
      select() { return query },
      eq() { return query },
      not() { return Promise.resolve({ data: [], error: null }) },
    }
    return query
  },
}
const auth = original('lib/security/cron-auth.ts', { crypto: require('node:crypto') }, env)
const route = original('app/api/briefing/route.ts', {
  'next/server': {
    NextResponse: { json(body, options = {}) { return { body, status: options.status || 200 } } },
  },
  '@supabase/supabase-js': {
    createClient(url, key) {
      assert.equal(url, env.NEXT_PUBLIC_SUPABASE_URL)
      assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY)
      return db
    },
  },
  '@/lib/whatsapp': {
    async sendWhatsApp() { audit.sends++; throw Error('NO LIVE OR SYNTHETIC DELIVERY AUTHORIZED') },
  },
  '@/lib/security/cron-auth': {
    isCronAuthorized: req => auth.isCronAuthorized(req, env),
    isInternalServiceAuthorized: req => auth.isInternalServiceAuthorized(req, env),
  },
}, env)

function request(secret, authorization) {
  const query = secret === null ? '' : '?secret=' + encodeURIComponent(secret)
  const url = 'https://app.askgogo.in/api/briefing' + query
  return {
    url, nextUrl: { searchParams: new URL(url).searchParams },
    headers: {
      get(name) { return name.toLowerCase() === 'authorization' ? (authorization ?? null) : null },
    },
  }
}
async function checkDenied(label, secret, authHeader) {
  const before = audit.reads
  const response = await route.GET(request(secret, authHeader))
  assert.equal(response.status, 401, label + ': must deny before DB access')
  assert.equal(audit.reads, before, label + ': no service-role DB access')
  assert.equal(audit.sends, 0, label + ': no outbound sends')
}

async function run() {
  // With an empty/missing environment secret, ?secret= (empty string) must not authorize.
  env.CRON_SECRET = ''
  await checkDenied('empty config + empty query', '')
  await checkDenied('empty config + missing query', null)
  await checkDenied('empty config + Bearer only', null, 'Bearer ')
  await checkDenied('empty config + guessed Bearer', null, 'Bearer guessed')
  delete env.CRON_SECRET
  await checkDenied('undefined config + empty query', '')
  await checkDenied('undefined config + arbitrary credential', 'guessed', 'Bearer guessed')

  env.CRON_SECRET = 'synthetic-valid-secret-123'
  await checkDenied('valid config + empty query', '')
  await checkDenied('valid config + incorrect query', 'wrong')
  await checkDenied('valid config + no credentials', null)
  await checkDenied('valid config + wrong Bearer', null, 'Bearer wrong')
  await checkDenied('valid config + wrong Bearer and query', 'wrong', 'Bearer wrong')

  for (const [label, secret, authHeader] of [
    ['legacy exact query credential', env.CRON_SECRET, null],
    ['correct bearer header', null, 'Bearer ' + env.CRON_SECRET],
  ]) {
    const before = audit.reads
    const response = await route.GET(request(secret, authHeader))
    assert.equal(response.status, 200, label + ': authorized empty-user probe')
    assert.equal(response.body.sent, 0)
    assert.equal(audit.reads, before + 1, label + ': one authorized users read')
    assert.equal(audit.sends, 0, label + ': zero actual sends')
  }
  console.log('PASS original briefing GET: empty/missing/wrong secrets denied before DB/send; valid legacy query and Bearer accepted with zero users (inert fixtures only)')
}
run().catch(err => { console.error(err); process.exitCode = 1 })
