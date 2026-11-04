// Test-only RED regression for the deployed Ops Alerts P2 mute preference.
// Reads and executes the ORIGINAL TypeScript function bodies, with inert stubs.
// No provider requests, credentials, persistence, user data or production actions.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const NOW = new Date('2026-11-04T00:25:00.000Z') // non-billing pass; fixed UTC clock
const source = readFileSync('lib/ops/run.ts', 'utf8')
const helpers = readFileSync('lib/ops/alerts.ts', 'utf8')

function originalFunction(code, name, filename) {
  const file = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = file.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)
  assert.ok(declaration, `Expected original ${name} declaration; inspect test after refactor`)
  const compiled = ts.transpileModule(declaration.getText(file).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  })
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  return compiled.outputText
}

const original = [
  originalFunction(helpers, 'shouldSendDigest', 'lib/ops/alerts.ts'),
  originalFunction(source, 'runOpsAlertsPass', 'lib/ops/run.ts'),
].join('\n')

function alert(id, status = 'open', mutedUntil = null) {
  return {
    id, no: id, fingerprint: `fictional:${id}`, severity: 'P2', source: 'errors',
    status, muted_until: mutedUntil, notified_at: null,
    last_seen: new Date(NOW.getTime() - 60_000).toISOString(),
    title: `Fictional P2 ${id}`, occurrences: 1,
  }
}

function fixture(alerts) {
  const digests = []
  const sends = []
  const writes = []
  const sandbox = {
    MIN: 60_000,
    Date,
    Set,
    Map,
    Promise,
    meterRows: async () => [],
    failedTasks: async () => 0,
    meterAlerts: () => [],
    taskAlerts: () => [],
    billingSignals: async () => [],
    openAlerts: async () => alerts,
    raiseAlerts: async () => ({ ok: true }),
    resolveQuiet: async () => 0,
    shouldNotifyP1: () => false,
    formatDigest: list => {
      digests.push(list.map(a => a.id))
      return `Synthetic digest: ${list.map(a => a.title).join(', ')}`
    },
    sendToOps: async (body, template) => { sends.push({ body, template }); return 'template' },
    supabaseAdmin: {
      from(table) {
        assert.equal(table, 'ops_alerts')
        return {
          update(change) {
            assert.ok(change.notified_at)
            return {
              in(field, ids) {
                assert.equal(field, 'id')
                writes.push([...ids])
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      },
    },
  }
  vm.runInNewContext(original + '\\nthis.originalRun = runOpsAlertsPass', sandbox, { timeout: 1000 })
  return { run: () => sandbox.originalRun(NOW), digests, sends, writes }
}

let passed = 0
let failed = 0
async function check(label, run) {
  try {
    await run()
    passed++
    console.log(`PASS ${label}`)
  } catch (e) {
    failed++
    console.error(`EXPECTED OPT-OUT SAFETY RED ${label}: ${String(e?.message || e)}`)
  }
}
const ACTIVE = alert(101)
const MUTED = alert(102, 'muted', new Date(NOW.getTime() + 3_600_000).toISOString())
const EXPIRED = alert(103, 'muted', new Date(NOW.getTime() - 60_000).toISOString())
const ACKED = alert(104, 'acked')

await check('CONTROL: eligible P2 incident creates one synthetic digest', async () => {
  const x = fixture([ACTIVE])
  const r = await x.run()
  assert.equal(r.sent, 1)
  assert.deepEqual(x.digests, [[101]])
  assert.deepEqual(x.writes, [[101]])
  assert.equal(x.sends.length, 1)
})
await check('CONTROL: wholly muted P2 incident does not notify', async () => {
  const x = fixture([MUTED])
  const r = await x.run()
  assert.equal(r.sent, 0)
  assert.equal(x.sends.length, 0)
  assert.equal(x.writes.length, 0)
})
await check('CONTROL: an expired P2 mute may resume digest eligibility', async () => {
  const x = fixture([EXPIRED])
  const r = await x.run()
  assert.equal(r.sent, 1)
  assert.deepEqual(x.digests, [[103]])
  assert.deepEqual(x.writes, [[103]])
})
await check('CONTROL: acknowledged P2 incident stays out of a due digest', async () => {
  const x = fixture([ACTIVE, ACKED])
  await x.run()
  assert.deepEqual(x.digests, [[101]])
  assert.deepEqual(x.writes, [[101]])
})
await check('REQUIRED: mixed digest must exclude still-muted P2 from formatted body', async () => {
  const x = fixture([ACTIVE, MUTED])
  await x.run()
  assert.deepEqual(x.digests, [[101]], 'formatDigest must not receive muted incident 102')
  assert.equal(x.sends.length, 1)
  assert.ok(!x.sends[0].body.includes('Fictional P2 102'), 'muted details must not appear in the body')
})
await check('REQUIRED: mixed digest template must exclude still-muted P2 details and count', async () => {
  const x = fixture([ACTIVE, MUTED])
  await x.run()
  assert.equal(x.sends.length, 1)
  assert.ok(!x.sends[0].template.includes('Fictional P2 102'), 'template must not include muted details')
  assert.match(x.sends[0].template, /Ops digest: 1 open\./, 'count must describe eligible alerts')
})
await check('REQUIRED: mixed digest must not advance a still-muted P2 notified cursor', async () => {
  const x = fixture([ACTIVE, MUTED])
  await x.run()
  assert.deepEqual(x.writes, [[101]], 'only eligible P2 record may be marked notified')
})
console.log(`ORIGINAL_SOURCE_OPS_P2_MUTE: controls=4 required=3 PASS=${passed} FAIL=${failed}`)
if (failed) process.exitCode = 1
