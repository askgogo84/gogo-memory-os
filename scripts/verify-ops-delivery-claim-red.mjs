import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Executes the ORIGINAL runOpsAlertsPass, compiled in an inert VM.
// It never imports production providers, opens a socket, or sends WhatsApp.
const source = readFileSync('lib/ops/run.ts', 'utf8')
const file = ts.createSourceFile('lib/ops/run.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const fn = file.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'runOpsAlertsPass')
assert.ok(fn, 'original runOpsAlertsPass must be found: update test if source is refactored')
const compiled = ts.transpileModule(fn.getText(file).replace(/^export\s+/, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  reportDiagnostics: true,
})
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)

function fixture({ updateError = false, outcome = 'accepted' } = {}) {
  const alert = {
    id: 19, no: 19, fingerprint: 'errors:spike:synthetic:provider', severity: 'P1',
    status: 'open', notified_at: null, muted_until: null, source: 'errors', title: 'Fictional outage',
  }
  let attempts = 0
  let writes = 0
  const sandbox = {
    Date, Map, Set, console, MIN: 60000,
    meterRows: async () => [], failedTasks: async () => 0,
    meterAlerts: () => [], taskAlerts: () => [],
    billingSignals: async () => { throw Error('unexpected billing/Gmail read') },
    openAlerts: async () => [alert],
    raiseAlerts: async () => ({ ok: true }), resolveQuiet: async () => 0,
    shouldNotifyP1: a => a.severity === 'P1' && a.status === 'open' && !a.notified_at,
    shouldSendDigest: () => false,
    formatP1: () => 'INERT_P1', formatP1Line: () => 'INERT_P1_LINE',
    formatDigest: () => 'INERT_DIGEST',
    sendToOps: async () => {
      attempts++
      if (outcome === 'unknown') throw new Error('provider_timeout_outcome_unknown')
      return 'template'
    },
    supabaseAdmin: {
      from(table) {
        assert.equal(table, 'ops_alerts')
        return {
          update(change) {
            writes++
            return {
              eq(key, id) {
                assert.equal(key, 'id')
                assert.equal(id, alert.id)
                if (updateError) return Promise.resolve({ error: { message: 'synthetic_record_write_failed' } })
                alert.notified_at = change.notified_at
                return Promise.resolve({ error: null })
              },
              in() { throw new Error('P2 not used in this synthetic P1 fixture') },
            }
          },
        }
      },
    },
  }
  vm.runInNewContext(compiled.outputText + '\nthis.originalRun = runOpsAlertsPass', sandbox, { timeout: 1000 })
  return { run: sandbox.originalRun, attempts: () => attempts, writes: () => writes }
}

const now = new Date('2026-11-04T00:07:00Z') // Non-billing 5-minute pass: no Gmail.
let passed = 0, failed = 0
async function check(name, work) {
  try { await work(); console.log('PASS ' + name); passed++ }
  catch (err) { console.error('EXPECTED SECURITY RED ' + name + ': ' + err.message); failed++ }
}

await check('normal accepted send with durable cursor does not repeat at five minutes', async () => {
  const x = fixture()
  const first = await x.run(now)
  const second = await x.run(new Date(now.getTime() + 300000))
  assert.equal(first.sent, 1)
  assert.equal(second.sent, 0)
  assert.equal(x.attempts(), 1)
  assert.equal(x.writes(), 1)
})
await check('failed cursor update after accepted send must not report safely recorded delivery', async () => {
  const x = fixture({ updateError: true })
  const result = await x.run(now)
  assert.notEqual(result.sent, 1, 'failed durability must not appear as recorded confirmed delivery')
  assert.ok(result.errors.length, 'returned DB update failure must be surfaced')
})
await check('accepted send with failed cursor must not blindly resend on next pass', async () => {
  const x = fixture({ updateError: true })
  await x.run(now)
  await x.run(new Date(now.getTime() + 300000))
  assert.equal(x.attempts(), 1, 'reconcile unknown recorded outcome before retry')
})
await check('unknown provider outcome must not blindly retry next pass', async () => {
  const x = fixture({ outcome: 'unknown' })
  await x.run(now)
  await x.run(new Date(now.getTime() + 300000))
  assert.equal(x.attempts(), 1, 'timeouts might be accepted: require reconciliation')
})
await check('two concurrent cron workers must acquire one durable send claim', async () => {
  const x = fixture()
  await Promise.all([x.run(now), x.run(now)])
  assert.equal(x.attempts(), 1, 'concurrent passes must not double-send')
})

console.log('Original-function synthetic P1 safety: PASS=' + passed + ' FAIL=' + failed)
if (failed) process.exitCode = 1
