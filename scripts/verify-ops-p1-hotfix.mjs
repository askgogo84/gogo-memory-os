// Ops Alerts P1/P2 hotfix (4 Nov, #274 review). Runs the REAL shipped functions, extracted from source and compiled into
// an inert VM, against an in-memory table that applies conditional updates the way PostgREST does. Every scenario from
// the reviewer's RED drafts #1250 (claim / unknown outcome / concurrency), #1251 (muted P2 digest) and #1252 (failure
// time) is here unchanged in intent; only the database fake is richer, because the fix uses conditional updates.
// Synthetic rows only: no Supabase, Gmail, WhatsApp, network or credentials.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function extract(path, names) {
  const source = readFileSync(path, 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return names.map(name => {
    const node = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)
    assert.ok(node, `shipped function ${name} not found in ${path}`)
    const out = ts.transpileModule(node.getText(ast).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true })
    assert.equal((out.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, name)
    return out.outputText
  }).join('\n')
}
const shipped = [
  extract('lib/ops/alerts.ts', ['shouldNotifyP1', 'shouldSendDigest', 'digestEligible', 'taskAlerts']),
  extract('lib/ops/run.ts', ['claimNotification', 'failedTasks', 'runOpsAlertsPass']),
].join('\n')

/** A table that evaluates eq / is / in / gte / or(notified_at.is.null,notified_at.lt.X) filters at execution time. */
function table(rows, { failWrites = false, failReads = false } = {}) {
  const writes = []
  const test = (r, f) => f.every(([op, field, v]) =>
    op === 'eq' ? String(r[field]) === String(v)
      : op === 'is' ? (v === null ? r[field] == null : r[field] === v)
      : op === 'in' ? v.map(String).includes(String(r[field]))
      : op === 'gte' ? r[field] != null && Date.parse(r[field]) >= Date.parse(v)
      : op === 'or' ? (r.notified_at == null || Date.parse(r.notified_at) < Date.parse(v.match(/notified_at\.lt\.(.+)$/)[1]))
      : false)
  return {
    writes,
    from(name) {
      const filters = []
      let change = null, countMode = false
      const q = {
        select(_cols, opts) { if (opts?.count) countMode = true; if (change) return run(); return q },
        update(c) { change = c; return q },
        eq(f, v) { filters.push(['eq', f, v]); return q },
        is(f, v) { filters.push(['is', f, v]); return q },
        in(f, v) { filters.push(['in', f, v]); return q },
        gte(f, v) { filters.push(['gte', f, v]); return q },
        or(expr) { assert.match(expr, /^notified_at\.is\.null,notified_at\.lt\./); filters.push(['or', 'notified_at', expr]); return q },
        then(res, rej) { return run().then(res, rej) },
      }
      const run = () => {
        const mine = rows.filter(r => (r._table || 'ops_alerts') === name)
        if (change) {
          if (failWrites) return Promise.resolve({ data: null, error: { message: 'synthetic_write_failed' } })
          const hit = mine.filter(r => test(r, filters))
          for (const r of hit) Object.assign(r, change)
          writes.push(hit.map(r => r.id))
          return Promise.resolve({ data: hit.map(r => ({ id: r.id })), error: null })
        }
        if (failReads) return Promise.resolve({ count: null, data: null, error: { message: 'synthetic_read_failure' } })
        const hit = mine.filter(r => test(r, filters))
        return Promise.resolve(countMode ? { count: hit.length, error: null } : { data: hit, error: null })
      }
      return q
    },
  }
}

function harness(rows, opts = {}) {
  const db = table(rows, opts)
  const sends = [], digests = []
  const sandbox = {
    MIN: 60_000, Date, Map, Set, Promise, Number, Error, String, console: { log() {}, error() {} },
    meterRows: async () => [], meterAlerts: () => [],
    billingSignals: async () => { throw new Error('unexpected billing/Gmail read') },
    openAlerts: async () => rows.filter(r => !r._table && ['open', 'muted', 'acked'].includes(r.status)).map(r => ({ ...r })),
    raiseAlerts: async () => ({ ok: true }), resolveQuiet: async () => 0,
    formatP1: a => `P1 ${a.title}`, formatP1Line: a => `P1 line ${a.title}`,
    sendToOps: async (body, template) => {
      sends.push({ body, template })
      if (opts.outcome === 'unknown') throw new Error('provider_timeout_outcome_unknown')
      return 'template'
    },
    supabaseAdmin: db,
  }
  sandbox.formatDigest = list => { digests.push(list.map(a => a.id)); return `Synthetic digest: ${list.map(a => a.title).join(', ')}` }
  vm.runInNewContext(shipped + '\nthis.run = runOpsAlertsPass; this.failedTasks = failedTasks; this.taskAlerts = taskAlerts', sandbox, { timeout: 1000 })
  if (!opts.withTasks) sandbox.failedTasks = async () => 0
  return { run: now => sandbox.run(now), sends, digests, writes: db.writes, failedTasks: since => sandbox.failedTasks(since), taskAlerts: sandbox.taskAlerts }
}

let pass = 0, fail = 0
async function check(name, fn) {
  try { await fn(); pass++; console.log('PASS ' + name) } catch (e) { fail++; console.error('FAIL ' + name + ': ' + (e?.message || e)) }
}
const NOW = new Date('2026-11-04T00:07:00Z') // not a billing turn (minute % 30 >= 5): no Gmail
const later = m => new Date(NOW.getTime() + m * 60_000)
const p1 = () => ({ id: 'a19', no: 19, fingerprint: 'errors:spike:synthetic', severity: 'P1', status: 'open', notified_at: null, muted_until: null, source: 'errors', title: 'Fictional outage', last_seen: NOW.toISOString() })

// ---- #1250: durable claim, unknown outcome, concurrency
await check('#1250 accepted send is claimed once and not repeated five minutes later', async () => {
  const rows = [p1()], x = harness(rows)
  const first = await x.run(NOW), second = await x.run(later(5))
  assert.equal(first.sent, 1); assert.equal(second.sent, 0); assert.equal(x.sends.length, 1)
  assert.ok(rows[0].notified_at, 'claim recorded')
})
await check('#1250 a failed claim write sends nothing and surfaces the error', async () => {
  const x = harness([p1()], { failWrites: true })
  const r = await x.run(NOW)
  assert.equal(x.sends.length, 0, 'never send without a recorded claim')
  assert.notEqual(r.sent, 1)
  assert.ok(r.errors.includes('p1_claim_failed'))
})
await check('#1250 failed claim write does not lead to a blind send on the next pass either', async () => {
  const x = harness([p1()], { failWrites: true })
  await x.run(NOW); await x.run(later(5))
  assert.equal(x.sends.length, 0)
})
await check('#1250 unknown provider outcome is not retried on the next pass', async () => {
  const x = harness([p1()], { outcome: 'unknown' })
  const r = await x.run(NOW); await x.run(later(5))
  assert.equal(x.sends.length, 1, 'one attempt only; the claim stands')
  assert.equal(r.sent, 0, 'an unknown outcome is not counted as sent')
  assert.ok(r.errors.some(e => e.startsWith('p1_send_outcome_unknown')))
})
await check('#1250 two concurrent cron passes send once', async () => {
  const x = harness([p1()])
  await Promise.all([x.run(NOW), x.run(NOW)])
  assert.equal(x.sends.length, 1)
})
await check('#1250 control: an unacknowledged P1 still repeats after 6 hours', async () => {
  const x = harness([p1()])
  await x.run(NOW); await x.run(later(6 * 60 + 1))
  assert.equal(x.sends.length, 2)
})

// ---- #1251: muted P2 kept out of the digest body, template and cursor
const p2 = (id, status = 'open', mutedUntil = null) => ({ id, no: id, fingerprint: `fictional:${id}`, severity: 'P2', source: 'errors', status, muted_until: mutedUntil, notified_at: null, last_seen: new Date(NOW.getTime() - 60_000).toISOString(), title: `Fictional P2 ${id}`, occurrences: 1 })
const MUTED = () => p2(102, 'muted', later(60).toISOString()), EXPIRED = () => p2(103, 'muted', later(-1).toISOString())
await check('#1251 control: one eligible P2 makes one digest and marks only it', async () => {
  const x = harness([p2(101)]); const r = await x.run(NOW)
  assert.equal(r.sent, 1); assert.deepEqual(x.digests, [[101]]); assert.deepEqual(x.writes, [[101]])
})
await check('#1251 control: a wholly muted P2 sends nothing and writes nothing', async () => {
  const x = harness([MUTED()]); const r = await x.run(NOW)
  assert.equal(r.sent, 0); assert.equal(x.sends.length, 0); assert.equal(x.writes.length, 0)
})
await check('#1251 control: an expired mute is eligible again', async () => {
  const x = harness([EXPIRED()]); await x.run(NOW)
  assert.deepEqual(x.digests, [[103]]); assert.deepEqual(x.writes, [[103]])
})
await check('#1251 control: an acknowledged P2 stays out', async () => {
  const x = harness([p2(101), p2(104, 'acked')]); await x.run(NOW)
  assert.deepEqual(x.digests, [[101]]); assert.deepEqual(x.writes, [[101]])
})
await check('#1251 mixed digest body leaves out the still-muted P2', async () => {
  const x = harness([p2(101), MUTED()]); await x.run(NOW)
  assert.deepEqual(x.digests, [[101]]); assert.equal(x.sends.length, 1); assert.ok(!x.sends[0].body.includes('Fictional P2 102'))
})
await check('#1251 mixed digest template leaves out the muted P2 and counts only eligible ones', async () => {
  const x = harness([p2(101), MUTED()]); await x.run(NOW)
  assert.ok(!x.sends[0].template.includes('Fictional P2 102')); assert.match(x.sends[0].template, /Ops digest: 1 open\./)
})
await check('#1251 mixed digest advances only the eligible cursor', async () => {
  const x = harness([p2(101), MUTED()]); await x.run(NOW)
  assert.deepEqual(x.writes, [[101]])
})
await check('concurrent digest passes send one digest', async () => {
  const x = harness([p2(101), p2(105)]); await Promise.all([x.run(NOW), x.run(NOW)])
  assert.equal(x.sends.length, 1)
})

// ---- #1252: failed tasks by terminal failure time
const T = new Date('2026-11-04T00:35:00.000Z'), ago = m => new Date(T.getTime() - m * 60_000).toISOString()
const run = (status, startM, endM, updM = endM, stamped = true) => ({ _table: 'agent_runs', id: Math.random(), status, started_at: ago(startM), completed_at: stamped ? ago(endM) : null, updated_at: ago(updM) })
const count = async (rows, mins, opts) => harness(rows, { ...opts, withTasks: true }).failedTasks(new Date(T.getTime() - mins * 60_000))
await check('#1252 control: a recent failure counts', async () => assert.equal(await count([run('failed', 8, 3)], 15), 1))
await check('#1252 control: a non-failed run never counts', async () => assert.equal(await count([run('completed', 8, 3)], 15), 0))
await check('#1252 control: an old failure never counts', async () => assert.equal(await count([run('failed', 3000, 2900)], 60), 0))
await check('#1252 control: a read error is raised, never zero', async () => {
  await assert.rejects(count([run('failed', 8, 3)], 15, { failReads: true }), /failed_tasks_read_failed:synthetic_read_failure/)
})
await check('#1252 control: an old failure touched later for bookkeeping is not new', async () => assert.equal(await count([run('failed', 3000, 2900, 2)], 15), 0))
await check('#1252 a run started yesterday that failed 3 minutes ago counts', async () => assert.equal(await count([run('failed', 1440, 3)], 15), 1))
await check('#1252 five old-start recent failures reach the hourly P2', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => run('failed', 1800 + i, 25 + i))
  const x = harness(rows, { withTasks: true }), n = await x.failedTasks(new Date(T.getTime() - 60 * 60_000))
  assert.equal(n, 5); assert.equal(x.taskAlerts(0, n)[0]?.severity, 'P2')
})
await check('#1252 ten old-start recent failures reach the 15-minute P1', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => run('failed', 1800 + i, 3 + (i % 3)))
  const x = harness(rows, { withTasks: true }), n = await x.failedTasks(new Date(T.getTime() - 15 * 60_000))
  assert.equal(n, 10); assert.equal(x.taskAlerts(n, n)[0]?.severity, 'P1')
})
await check('a failure written without completed_at still counts by its update time', async () => assert.equal(await count([run('failed', 1440, 0, 4, false)], 15), 1))

console.log(`OPS_P1_HOTFIX: PASS=${pass} FAIL=${fail}`)
if (fail) process.exitCode = 1
