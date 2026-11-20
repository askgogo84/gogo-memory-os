// Test-only original-function safety specification. Expected RED until task failure time detection is fixed.
// All records and database responses are fictional; no network, credentials or real provider operations.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const NOW = new Date('2026-11-04T00:35:00.000Z')
function originalFunction(path, name) {
  const source = readFileSync(path, 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const node = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)
  assert.ok(node, 'Cannot extract original function: ' + name)
  const result = ts.transpileModule(node.getText(ast).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  })
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
  return result.outputText
}
const original = [
  originalFunction('lib/ops/run.ts', 'failedTasks'),
  originalFunction('lib/ops/alerts.ts', 'taskAlerts'),
].join('\n')
const ago = mins => new Date(NOW.getTime() - mins * 60_000).toISOString()
const row = (status, startMins, failureMins, updatedMins = failureMins) => ({
  status,
  started_at: ago(startMins),
  failed_at: ago(failureMins),
  completed_at: ago(failureMins),
  updated_at: ago(updatedMins),
})
function fixture(rows, error = false) {
  const queryFields = []
  const sandbox = {
    Number, Error,
    supabaseAdmin: {
      from(table) {
        assert.equal(table, 'agent_runs')
        const query = { status: null }
        return {
          select(columns, options) {
            assert.equal(columns, 'id')
            assert.equal(options?.count, 'exact')
            assert.equal(options?.head, true)
            return this
          },
          eq(field, value) {
            assert.equal(field, 'status')
            query.status = value
            return this
          },
          gte(field, since) {
            queryFields.push(field)
            if (error) return Promise.resolve({ count: null, error: { message: 'synthetic_read_failure' } })
            assert.ok(['started_at','failed_at','completed_at','updated_at'].includes(field), 'Unexpected failure-time query field: ' + field)
            const count = rows.filter(r => r.status === query.status && Date.parse(r[field]) >= Date.parse(since)).length
            return Promise.resolve({ count, error: null })
          },
        }
      },
    },
  }
  vm.runInNewContext(original + '\nthis.readFailures = failedTasks; this.thresholds = taskAlerts', sandbox, { timeout: 1000 })
  return {
    count: mins => sandbox.readFailures(new Date(NOW.getTime() - mins * 60_000)),
    alert: (f15, f60) => sandbox.thresholds(f15, f60),
    queryFields,
  }
}

let controlsPass = 0, controlsFail = 0, negativesPass = 0, negativesFail = 0
async function check(kind, description, fn) {
  try {
    await fn()
    if (kind === 'CONTROL') controlsPass++; else negativesPass++
    console.log('PASS ' + kind + ': ' + description)
  } catch (e) {
    if (kind === 'CONTROL') controlsFail++; else negativesFail++
    console.error('EXPECTED TASK FAILURE-TIME RED ' + kind + ': ' + description + ': ' + String(e?.message || e))
  }
}
await check('CONTROL', 'recently started and failed run counts', async () => {
  assert.equal(await fixture([row('failed',8,3)]).count(15), 1)
})
await check('CONTROL', 'non-failed status never counts', async () => {
  assert.equal(await fixture([row('completed',8,3)]).count(15), 0)
})
await check('CONTROL', 'old actual failure never counts', async () => {
  assert.equal(await fixture([row('failed',3000,2900)]).count(60), 0)
})
await check('CONTROL', 'database read error is propagated, never silently called no failures', async () => {
  await assert.rejects(fixture([row('failed',8,3)], true).count(15), /failed_tasks_read_failed:synthetic_read_failure/)
})
await check('CONTROL', 'old failure touched recently for bookkeeping is not a new failure', async () => {
  assert.equal(await fixture([row('failed',3000,2900,2)]).count(15), 0)
})
await check('REQUIRED', 'run started yesterday but failed 3m ago counts within 15m', async () => {
  assert.equal(await fixture([row('failed',1440,3)]).count(15), 1, 'must filter by terminal failure timestamp, not initial run start')
})
await check('REQUIRED', 'five old-start recent failures cross hourly P2 threshold', async () => {
  const f = fixture(Array.from({length:5}, (_,i) => row('failed',1800+i,25+i)))
  const count = await f.count(60)
  assert.equal(count, 5, 'hourly detector misses long-running newly failed tasks')
  assert.equal(f.alert(0,count)[0]?.severity, 'P2')
})
await check('REQUIRED', 'ten old-start recent failures cross 15m P1 threshold', async () => {
  const f = fixture(Array.from({length:10}, (_,i) => row('failed',1800+i,3+(i%3))))
  const count = await f.count(15)
  assert.equal(count, 10, 'spike detector misses long-running newly failed tasks')
  assert.equal(f.alert(count,count)[0]?.severity, 'P1')
})
console.log('ORIGINAL_SOURCE_OPS_TASK_FAILURE_TIME: controls_pass=' + controlsPass + '/5 controls_fail=' + controlsFail +
  ' required_pass=' + negativesPass + '/3 required_fail=' + negativesFail + '/3')
if (controlsFail || negativesFail) process.exitCode = 1
