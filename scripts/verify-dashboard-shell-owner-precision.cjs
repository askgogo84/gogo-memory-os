// Exercise ORIGINAL dashboard shell source with an inert two-tenant service-role DB.
// No real users, Supabase, provider, network, credentials, or customer data.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

const A = '9007199254740992'
const B = '9007199254740993'
const rows = [
  { telegram_id: A, name: 'Alyssa Private', gmail_connected: true, google_calendar_connected: false },
  { telegram_id: B, name: 'Ben Private', gmail_connected: false, google_calendar_connected: false },
  { telegram_id: '123', name: 'Carol Private', gmail_connected: false, google_calendar_connected: true },
  { telegram_id: '-2301', name: 'Nina Private', gmail_connected: false, google_calendar_connected: false },
]
const reads = [], usages = []

const supabaseAdmin = {
  from(table) {
    assert.ok(['users', 'agent_runs', 'agent_watchers'].includes(table), 'unexpected table ' + table)
    const predicates = {}
    const query = {
      select() { return query },
      eq(column, value) { predicates[column] = value; return query },
      neq(column, value) { predicates['not_' + column] = value; return query },
      maybeSingle: async () => {
        assert.equal(table, 'users')
        assert.equal(Object.keys(predicates).join(','), 'telegram_id', 'user lookup needs one exact owner')
        reads.push({ table, owner: predicates.telegram_id })
        return {
          data: rows.find(row => row.telegram_id === String(predicates.telegram_id)) || null,
          error: null,
        }
      },
      then(resolve, reject) {
        assert.notEqual(table, 'users')
        reads.push({ table, owner: predicates.telegram_id })
        const expected = table === 'agent_runs' ? A : B
        const count = String(predicates.telegram_id) === expected ? 2 : 0
        return Promise.resolve({ count, error: null }).then(resolve, reject)
      },
    }
    return query
  },
}
function loadOriginal(path, mocks) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  runInNewContext(js, {
    exports, module: { exports }, Buffer, Number, String, BigInt,
    Promise, console: { error() {} }, process: { env: {} },
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
      throw Error('unexpected source import ' + name)
    },
    fetch() { throw Error('forbidden network call') },
  }, { filename: path, timeout: 3000 })
  return exports
}
const identity = loadOriginal('lib/dashboard/owner-identity.ts', {
  'node:crypto': { randomBytes() { throw Error('owner allocation forbidden') } },
})
const shell = loadOriginal('lib/dashboard/shell-data.ts', {
  '@/lib/supabase-admin': { supabaseAdmin },
  '@/lib/dashboard/queries': {
    async getUsageSummary(owner) {
      usages.push(owner)
      return { ok: true, planLabel: 'Synthetic plan', usage: { aiToday: 1, docsThisMonth: 0 },
        limits: { aiPerDay: 12, docsPerMonth: 10 } }
    },
  },
  './owner-identity': identity,
})

async function run() {
  const valid = [
    [A, 'Alyssa', true, 'string'],
    [B, 'Ben', false, 'string'],
    ['123', 'Carol', true, 'number'],
    ['-2301', 'Nina', false, 'number'],
  ]
  for (const [owner, firstName, googleConnected, predicateType] of valid) {
    const start = reads.length
    const result = await shell.getShellData(owner)
    const observed = reads.slice(start)
    assert.equal(result.name, firstName, 'never read another account profile: ' + owner)
    assert.equal(result.setup.find(s => s.key === 'google').done, googleConnected)
    assert.equal(observed.length, 3, 'expected users, agent_runs, agent_watchers only')
    for (const record of observed) assert.equal(String(record.owner), owner, 'all private queries bound to exact owner')
    assert.equal(typeof observed.find(r => r.table === 'users').owner, predicateType,
      'BIGINT beyond safe integer must be exact string; legacy safe owner remains number')
    assert.equal(usages.at(-1), owner)
  }
  for (const invalid of ['123junk', '00123', '+123', '0', '-0', '', 'abc',
    '9007199254740993tail', '9223372036854775808', '-9223372036854775809']) {
    const previousReads = reads.length, previousUsage = usages.length
    const result = await shell.getShellData(invalid)
    assert.equal(result.name, '', 'malformed owner must not resolve another profile')
    assert.equal(result.setup.length, 0)
    assert.equal(reads.length, previousReads, 'invalid session cannot make private DB reads: ' + invalid)
    assert.equal(usages.length, previousUsage, 'invalid session cannot read usage: ' + invalid)
  }
  const before = reads.length
  const roundedNumber = await shell.getShellData(Number(B))
  assert.equal(roundedNumber.name, '', 'unsafe numeric owner must fail closed')
  assert.equal(reads.length, before)
  console.log('Dashboard shell owner precision: original-source two BIGINT accounts, safe and negative IDs, malformed/rounded rejection; inert DB only')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
