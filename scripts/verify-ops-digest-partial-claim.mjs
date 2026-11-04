// Original-function synthetic P2 Ops partial-claim race regression. No credentials, providers or network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Extract the real shipped TypeScript functions; never test a copied model of the implementation.
function extract(path, names) {
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return names.map(name => {
    const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
    assert.ok(node, 'missing original function ' + name + ' in ' + path)
    const out = ts.transpileModule(node.getText(ast).replace(/^export\\s+/, ''), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      reportDiagnostics: true,
    })
    assert.equal((out.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
    return out.outputText
  }).join('\\n')
}
const shipped = [
  extract('lib/ops/alerts.ts', ['shouldSendDigest', 'digestEligible']),
  extract('lib/ops/run.ts', ['claimNotification', 'definiteSendFailure', 'releaseClaim', 'runOpsAlertsPass']),
].join('\\n')

const NOW = new Date('2026-11-04T00:07:00.000Z') // skips the billing-Gmail read
const prior = new Date(NOW.getTime() - 60_000).toISOString()
function incident(id, no, notifiedAt = null) {
  return {
    id, no, fingerprint: 'synthetic:' + id, severity: 'P2', status: 'open', source: 'errors',
    muted_until: null, notified_at: notifiedAt, last_seen: prior,
    title: 'FICTIONAL ' + id, occurrences: 1,
  }
}
function setup({ bothClaimed = false, outcome = 'success' } = {}) {
  // The prior-read snapshot was taken BEFORE another worker claimed "already".
  const rows = [
    incident('already', 10, prior),
    incident('mine', 11, bothClaimed ? prior : null),
  ]
  const sends = [], writes = [], releases = []
  const db = {
    from(table) {
      assert.equal(table, 'ops_alerts')
      const filters = []
      let update = null
      const q = {
        update(change) { update = change; return q },
        in(key, vals) { filters.push(r => vals.map(String).includes(String(r[key]))); return q },
        eq(key, val) { filters.push(r => String(r[key]) === String(val)); return q },
        is(key, val) { filters.push(r => r[key] === val); return q },
        not(key, op, values) {
          assert.equal(key, 'status'); assert.equal(op, 'in')
          const denied = String(values).replace(/[()]/g, '').split(',')
          filters.push(r => !denied.includes(r.status)); return q
        },
        or(expr) {
          const m = expr.match(/^notified_at\\.is\\.null,notified_at\\.lt\\.(.+)$/)
          assert.ok(m, 'unknown conditional cursor filter: ' + expr)
          filters.push(r => r.notified_at == null || Date.parse(r.notified_at) < Date.parse(m[1]))
          return q
        },
        select() {
          assert.ok(update, 'test uses only conditional updates')
          const hit = rows.filter(r => filters.every(f => f(r)))
          for (const r of hit) Object.assign(r, update)
          const ids = hit.map(r => r.id)
          if (update.notified_at === null) releases.push(ids)
          else writes.push(ids)
          return Promise.resolve({ data: hit.map(r => ({ id: r.id })), error: null })
        },
      }
      return q
    },
  }
  const sandbox = {
    Date, Set, Map, Number, String, Promise, Error, MIN: 60_000,
    supabaseAdmin: db,
    meterRows: async () => [], meterAlerts: () => [],
    failedTasks: async () => 0, taskAlerts: () => [],
    billingSignals: async () => { throw Error('unexpected billing provider read') },
    openAlerts: async () => rows.map(r => ({ ...r, notified_at: null })), // intentionally stale prior read
    raiseAlerts: async () => ({ ok: true }), resolveQuiet: async () => 0,
    shouldNotifyP1: () => false,
    formatP1: () => { throw Error('unexpected P1') },
    formatP1Line: () => { throw Error('unexpected P1') },
    formatDigest: list => 'Digest(' + list.map(a => a.id).join(',') + ')',
    sendToOps: async (body, template) => {
      sends.push({ body, template })
      if (outcome === 'definite') throw Object.assign(new Error('synthetic 400'), { status: 400 })
      if (outcome === 'unknown') throw new Error('synthetic provider timeout')
      return 'template'
    },
  }
  vm.runInNewContext(shipped + '\\nthis.run = runOpsAlertsPass', sandbox, { timeout: 1000 })
  return { rows, sends, writes, releases, run: now => sandbox.run(now) }
}
let passed = 0
async function check(name, fn) {
  await fn()
  console.log('PASS ' + name)
  passed++
}
await check('partially won claim: digest and template contain ONLY owned row', async () => {
  const x = setup(), r = await x.run(NOW)
  assert.equal(r.sent, 1)
  assert.equal(x.sends.length, 1)
  assert.equal(x.sends[0].body, 'Digest(mine)')
  assert.match(x.sends[0].template, /Ops digest: 1 open\\. 11\\. FICTIONAL mine\\./)
  assert.doesNotMatch(x.sends[0].template, /FICTIONAL already/)
  assert.deepEqual(x.writes, [['mine']])
  assert.equal(x.rows[0].notified_at, prior, 'other worker claim untouched')
  assert.equal(x.rows[1].notified_at, NOW.toISOString(), 'our claim committed')
})
await check('definite 4xx returns ONLY this pass claim, not another workers claim', async () => {
  const x = setup({ outcome: 'definite' }), r = await x.run(NOW)
  assert.equal(r.sent, 0)
  assert.deepEqual(x.writes, [['mine']])
  assert.deepEqual(x.releases, [['mine']])
  assert.equal(x.rows[0].notified_at, prior)
  assert.equal(x.rows[1].notified_at, null)
  assert.equal(x.sends.length, 1)
  assert.ok(r.errors.some(e => e.startsWith('digest_send_failed:')))
})
await check('unknown send outcome retains claim; stale second pass does not blind retry', async () => {
  const x = setup({ outcome: 'unknown' })
  await x.run(NOW)
  const r = await x.run(new Date(NOW.getTime() + 5 * 60_000))
  assert.equal(x.sends.length, 1)
  assert.equal(r.sent, 0)
  assert.equal(x.rows[1].notified_at, NOW.toISOString())
  assert.deepEqual(x.releases, [])
})
await check('all rows already claimed: no digest and no unowned release', async () => {
  const x = setup({ bothClaimed: true })
  const r = await x.run(NOW)
  assert.equal(r.sent, 0)
  assert.equal(x.sends.length, 0)
  assert.deepEqual(x.writes, [[]].filter(x => x.length)) // no update matches
  assert.deepEqual(x.releases, [])
})
console.log('OPS_DIGEST_PARTIAL_CLAIM: PASS=' + passed + ' FAIL=0')
