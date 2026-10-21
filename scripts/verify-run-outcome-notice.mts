// One WhatsApp outcome message per finished / failed / stale-swept agent run (19 Oct).
// Inert DB and transport only: no network, no Supabase, no Twilio.
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// Placeholders only so the module-level Supabase client constructs; every DB call goes to fakeDb.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'ci-placeholder-service-role-key'
const { completionNotice, notifyRunOutcome } = await import('../lib/agent/run-notify')

const failures: string[] = []
async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); console.log(`ok - ${name}`) } catch (err: any) { failures.push(`not ok - ${name}: ${err?.message || err}`) }
}

// ---- inert Supabase-like client: rows per table, records every write ----
// Honours `col->>key` JSON-path filters for eq/is, like PostgREST, so the claim guard is real.
type Write = { table: string; op: string; value: any; filters: Record<string, any> }
const IS = Symbol('is')
function field(row: any, k: string) {
  const m = k.match(/^(\w+)->>(\w+)$/)
  if (!m) return row[k]
  const v = row[m[1]]?.[m[2]]
  return v === undefined || v === null ? null : String(v)
}
function fakeDb(tables: Record<string, any[]>) {
  const writes: Write[] = []
  const db = {
    writes,
    from(table: string) {
      const filters: Record<string, any> = {}
      let op = 'select', value: any = null
      const matches = (row: any, k: string, v: any) => {
        if (v && typeof v === 'object' && IS in v) return field(row, k) === null
        const have = field(row, k)
        return Array.isArray(v) ? v.includes(have) : String(have) === String(v)
      }
      const rows = () => (tables[table] || []).filter((row) => Object.entries(filters).every(([k, v]) => matches(row, k, v)))
      const result = () => {
        if (op === 'insert') return { data: { id: `${table}-new` }, error: null }
        if (op === 'update') {
          const hit = rows()
          for (const row of hit) Object.assign(row, structuredClone(value))
          return { data: hit, error: null }
        }
        return { data: rows(), error: null }
      }
      const q: any = {
        select: () => q,
        insert: (v: any) => { op = 'insert'; value = v; writes.push({ table, op, value: v, filters }); return q },
        update: (v: any) => { op = 'update'; value = v; writes.push({ table, op, value: v, filters }); return q },
        eq: (k: string, v: any) => { filters[k] = v; return q },
        in: (k: string, v: any[]) => { filters[k] = v; return q },
        lt: () => q, lte: () => q, gte: () => q, order: () => q, limit: () => q, not: () => q,
        // Only JSON-path null checks are modelled; plain-column .is() stays inert as before.
        is: (k: string, v: any) => { if (k.includes('->>') && v === null) filters[k] = { [IS]: true }; return q },
        maybeSingle: async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error } },
        single: async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error } },
        then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
      }
      return q
    },
  }
  return db
}

// ---- copy ----
await check('completed copy names the task and adds a real summary', () => {
  assert.equal(completionNotice({ status: 'completed', title: 'Compare Goa hotels', summary: 'Taj Exotica is cheapest for your dates.' }), 'Done: Compare Goa hotels. Taj Exotica is cheapest for your dates.')
  assert.equal(completionNotice({ status: 'completed', title: 'Compare Goa hotels.', summary: 'Completed and verified.' }), 'Done: Compare Goa hotels.', 'boilerplate summary is not repeated')
})
await check('failed copy is plain, does not leak error codes, and promises no repeat', () => {
  const text = completionNotice({ status: 'failed', title: 'Book dentist', error: 'autonomous_verification_failed' })
  assert.equal(text, 'Stopped: Book dentist. I couldn’t verify the result. Nothing was repeated or submitted again.')
  const generic = completionNotice({ status: 'failed', title: 'Book dentist', error: 'TypeError: cannot read token_abc123 of undefined' })
  assert.doesNotMatch(generic, /TypeError|token_abc123/)
  assert.match(generic, /^Stopped: Book dentist\. .+\. Nothing was repeated or submitted again\.$/)
})
await check('stale copy says it stopped responding', () => {
  assert.equal(completionNotice({ status: 'failed', title: 'Track my parcel', error: 'stale_run_recovered' }), 'Stopped: Track my parcel. It stopped responding, so I closed it. Nothing was repeated or submitted again.')
})
await check('unknown / uncertain outcome never claims success', () => {
  for (const run of [
    { status: 'outcome_unknown', title: 'Web check-in' },
    { status: 'completed', title: 'Web check-in', metadata_json: { outcome_state: 'unknown' } },
    { status: 'failed', title: 'Web check-in', metadata_json: { reconciliation_required: true } },
    { status: 'running', title: 'Web check-in' },
  ]) {
    const text = completionNotice(run)
    assert.equal(text, "I couldn't confirm whether Web check-in finished. I haven't retried it.")
    assert.doesNotMatch(text, /^Done/)
  }
})
await check('titles carrying codes or passwords are never echoed', () => {
  const text = completionNotice({ status: 'completed', title: 'Sign in with OTP 482913', summary: 'Your password is hunter2' })
  assert.equal(text, 'Done: your task.')
  assert.doesNotMatch(text, /482913|hunter2/)
})
await check('titles with a raw numeric code near sign-in / verify / code / use words are redacted', () => {
  for (const title of ['use 482913 to sign in', 'Enter 5512 to verify', 'Login code 90817265', 'Verify with 123456', '7741 is the code for the portal']) {
    const text = completionNotice({ status: 'completed', title, summary: 'Finished.' })
    assert.equal(text, 'Done: your task. Finished.', title)
    assert.doesNotMatch(text, /\d{4}/)
  }
  assert.equal(completionNotice({ status: 'failed', title: 'use 482913 to sign in', error: 'x' }).startsWith('Stopped: your task.'), true)
  assert.equal(completionNotice({ status: 'completed', title: 'Done', summary: 'Use 482913 to sign in next time' }), 'Done: Done.', 'summary with a code is not echoed')
  // Ordinary numbers stay.
  assert.equal(completionNotice({ status: 'completed', title: 'Book a table for 4 at Toit' }), 'Done: Book a table for 4 at Toit.')
  assert.equal(completionNotice({ status: 'completed', title: 'Compare flights BLR-DEL under 6000' }), 'Done: Compare flights BLR-DEL under 6000.')
})

// ---- notifyRunOutcome ----
function notifyHarness(meta: Record<string, any> = {}, opts: { sendFails?: boolean; type?: string } = {}) {
  const row = { id: 'run-1', telegram_id: '123', type: opts.type || 'autonomous', status: 'completed', title: 'Plan Sunday', metadata_json: { ...meta } }
  const db = fakeDb({ agent_runs: [row] })
  const sent: { to: string; text: string }[] = []
  const deps = {
    db,
    resolveWhatsappId: async (tg: string) => (tg === '123' ? 'whatsapp:+910000000000' : null),
    send: async (to: string, text: string) => { sent.push({ to, text }); if (opts.sendFails) throw Object.assign(new Error('inert definite provider rejection'), { status: 400 }) },
    now: () => new Date('2026-10-19T10:00:00Z'),
  }
  return { row, db, sent, deps }
}

await check('sends once and records outcome_notified_at; second call is a no-op', async () => {
  const h = notifyHarness()
  const first = await notifyRunOutcome({ ...h.row }, h.deps)
  assert.deepEqual(first, { status: 'sent' })
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].to, 'whatsapp:+910000000000')
  assert.equal(h.sent[0].text, 'Done: Plan Sunday.')
  assert.equal(h.row.metadata_json.outcome_notified_at, '2026-10-19T10:00:00.000Z')
  // A stale in-memory copy (no flag) must still be stopped by the fresh DB read.
  const second = await notifyRunOutcome({ ...h.row, metadata_json: {} }, h.deps)
  assert.equal(second.status, 'skipped')
  assert.equal(h.sent.length, 1)
})
await check('send failure leaves the flag unset and does not throw', async () => {
  const h = notifyHarness({}, { sendFails: true })
  const result = await notifyRunOutcome({ ...h.row }, h.deps)
  assert.deepEqual(result, { status: 'failed', reason: 'send_failed' })
  assert.equal(h.row.metadata_json.outcome_notified_at, undefined)
  assert.equal(h.row.metadata_json.outcome_notice_claimed_at, undefined, 'failed send releases the claim')
  assert.equal(h.row.metadata_json.outcome_notice_claim_id, undefined)
  // Released, so a later attempt can still deliver it.
  const retry = await notifyRunOutcome({ ...h.row }, { ...h.deps, send: async (to: string, text: string) => { h.sent.push({ to, text }) } })
  assert.deepEqual(retry, { status: 'sent' })
  assert.ok(h.row.metadata_json.outcome_notified_at)
})
await check('two racing notify calls send exactly one message', async () => {
  const h = notifyHarness()
  const results = await Promise.all([notifyRunOutcome({ ...h.row }, h.deps), notifyRunOutcome({ ...h.row }, h.deps)])
  const claims = h.db.writes.filter((w) => w.op === 'update' && w.value?.metadata_json?.outcome_notice_claim_id)
  assert.equal(claims.length, 2, 'both callers got past the read and tried to claim')
  assert.ok(claims.every((w) => 'metadata_json->>outcome_notice_claimed_at' in w.filters && 'metadata_json->>outcome_notified_at' in w.filters), 'claim is guarded on both keys')
  assert.ok(claims.every((w) => w.filters.id === 'run-1' && w.filters.telegram_id === '123'), 'claim is owner bound')
  assert.equal(h.sent.length, 1, 'only the claimer sends')
  assert.deepEqual(results.map((r) => r.status).sort(), ['sent', 'skipped'])
  assert.ok(results.some((r) => r.status === 'skipped' && (r as any).reason === 'claimed_elsewhere'))
  assert.ok(h.row.metadata_json.outcome_notified_at)
  assert.equal(h.row.metadata_json.outcome_notice_claim_id, undefined, 'claim keys cleared once flagged')
})
await check('metadata written by another path between claim and flag is preserved', async () => {
  const h = notifyHarness({ keep_me: 1 })
  const result = await notifyRunOutcome({ ...h.row }, {
    ...h.deps,
    send: async (to: string, text: string) => {
      h.sent.push({ to, text })
      // Another writer (e.g. the worker recording its result) lands while the message is in flight.
      h.row.metadata_json = { ...h.row.metadata_json, result_ref: 'artifact-42', keep_me: 2 }
    },
  })
  assert.deepEqual(result, { status: 'sent' })
  assert.equal(h.row.metadata_json.result_ref, 'artifact-42')
  assert.equal(h.row.metadata_json.keep_me, 2)
  assert.equal(h.row.metadata_json.outcome_notified_at, '2026-10-19T10:00:00.000Z')
})
await check('fresh and stale send intents both require reconciliation, never takeover', async () => {
  for (const at of ['2026-10-19T09:58:00.000Z','2026-10-19T08:00:00.000Z']) {
    const h=notifyHarness({outcome_notice_claimed_at:at,outcome_notice_claim_id:'previous-worker'})
    assert.deepEqual(await notifyRunOutcome({...h.row},h.deps),{status:'skipped',reason:'reconciliation_required'})
    assert.equal(h.sent.length,0)
  }
})
await check('provider timeout after acceptance never permits a duplicate notice', async () => {
  const h=notifyHarness();let effects=0
  const deps={...h.deps,send:async()=>{effects++;throw Object.assign(new Error('timeout after effect'),{status:504})}}
  assert.deepEqual(await notifyRunOutcome({...h.row},deps),{status:'failed',reason:'outcome_unknown'})
  assert.ok(h.row.metadata_json.outcome_notice_claim_id)
  await notifyRunOutcome({...h.row},deps)
  assert.equal(effects,1)
})
await check('a claim write that matches no row means someone else owns it: no send', async () => {
  const h = notifyHarness()
  const racing = { ...h.db, from(table: string) {
    const q = h.db.from(table)
    const update = q.update
    q.update = (v: any) => { h.row.metadata_json = { ...h.row.metadata_json, outcome_notified_at: 'by-another-path' }; return update(v) }
    return q
  } }
  assert.deepEqual(await notifyRunOutcome({ ...h.row }, { ...h.deps, db: racing }), { status: 'skipped', reason: 'claimed_elsewhere' })
  assert.equal(h.sent.length, 0)
})
await check('DB errors never throw', async () => {
  const h = notifyHarness()
  const broken = { from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }; return q } }
  assert.deepEqual(await notifyRunOutcome({ ...h.row }, { ...h.deps, db: broken }), { status: 'failed', reason: 'run_read_failed' })
  const throwing = { from: () => { throw new Error('boom') } }
  assert.deepEqual(await notifyRunOutcome({ ...h.row }, { ...h.deps, db: throwing }), { status: 'failed', reason: 'unexpected' })
  assert.equal(h.sent.length, 0)
})
await check('secure_browser runs are skipped (their worker already notifies)', async () => {
  for (const h of [notifyHarness({ plan_type: 'secure_browser' }), notifyHarness({}, { type: 'secure_browser' })]) {
    const result = await notifyRunOutcome({ ...h.row }, h.deps)
    assert.equal(result.status, 'skipped')
    assert.equal(h.sent.length, 0)
  }
})
await check('runs whose worker already sent its result (notified:true) are skipped', async () => {
  const h = notifyHarness({ notified: true })
  assert.equal((await notifyRunOutcome({ ...h.row }, h.deps)).status, 'skipped')
  assert.equal(h.sent.length, 0)
})
await check('message carries no vault/credential metadata', async () => {
  const h = notifyHarness({ vault_ref: 'vault-secret-xyz', credentials: { password: 'pw-123' } })
  await notifyRunOutcome({ ...h.row }, h.deps)
  assert.equal(h.sent.length, 1)
  assert.doesNotMatch(h.sent[0].text, /vault-secret-xyz|pw-123/)
})
await check('a missing owner phone is skipped quietly', async () => {
  const h = notifyHarness()
  const result = await notifyRunOutcome({ ...h.row, telegram_id: '999' }, { ...h.deps, db: fakeDb({ agent_runs: [{ ...h.row, telegram_id: '999' }] }) })
  assert.equal(result.status, 'skipped')
  assert.equal(h.sent.length, 0)
})

// ---- wiring through the actual modules ----
function loadModule(path: string, requireMap: Record<string, any>, extra: Record<string, any> = {}) {
  const exports: any = {}
  const output = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(output, {
    exports,
    require: (name: string) => {
      if (name in requireMap) return requireMap[name]
      throw new Error(`unexpected import in ${path}: ${name}`)
    },
    console, Date, Promise, Math, Number, String, Array, Set, Map, Object, JSON, Error, Boolean,
    ...extra,
  })
  return exports
}

await check('sweepStaleRunningRuns sends one stale notice per closed run and keeps its numeric return', async () => {
  const runs = [
    { id: 'stale-1', telegram_id: '123', type: 'autonomous', status: 'running', title: 'Track my parcel', metadata_json: {} },
    { id: 'stale-2', telegram_id: '123', type: 'secure_browser', status: 'running', title: 'Read Amazon order', metadata_json: { plan_type: 'secure_browser' } },
  ]
  const db = fakeDb({ agent_runs: runs, agent_steps: [] })
  const notified: any[] = []
  const stale = loadModule('lib/agent/stale-runs.ts', {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    './run-notify': { notifyRunOutcome: async (run: any) => { notified.push(run); return { status: 'sent' } } },
  })
  const closed = await stale.sweepStaleRunningRuns()
  assert.equal(closed, 2)
  assert.equal(notified.length, 2, 'every closed row is handed to notifyRunOutcome (which itself skips secure_browser)')
  assert.equal(notified[0].id, 'stale-1')
  assert.equal(notified[0].telegram_id, '123')
  assert.equal(notified[0].title, 'Track my parcel')
  assert.equal(notified[0].error, 'stale_run_recovered')
  assert.equal(notified[0].status, 'failed')
  // End to end with the real notifier and inert transport: one message, browser run skipped.
  const realRuns = [
    { id: 'stale-3', telegram_id: '123', type: 'autonomous', status: 'running', title: 'Track my parcel', metadata_json: {} },
    { id: 'stale-4', telegram_id: '123', type: 'secure_browser', status: 'running', title: 'Read Amazon order', metadata_json: { plan_type: 'secure_browser' } },
  ]
  const realDb = fakeDb({ agent_runs: realRuns, agent_steps: [] })
  const sent: string[] = []
  const notifier = loadModule('lib/agent/run-notify.ts', { '@/lib/supabase-admin': { supabaseAdmin: realDb }, '@/lib/services/delivery-state': { isDefiniteProviderRejection: (e:any) => e?.status >= 400 && e?.status < 500 && e?.status !== 408 && !e?.partialSend } })
  const wrapped = { notifyRunOutcome: (run: any) => notifier.notifyRunOutcome(run, { resolveWhatsappId: async () => 'whatsapp:+910000000000', send: async (_to: string, text: string) => { sent.push(text) } }) }
  const stale2 = loadModule('lib/agent/stale-runs.ts', { '@/lib/supabase-admin': { supabaseAdmin: realDb }, '@/lib/services/delivery-state': { isDefiniteProviderRejection: (e:any) => e?.status >= 400 && e?.status < 500 && e?.status !== 408 && !e?.partialSend }, './run-notify': wrapped })
  assert.equal(await stale2.sweepStaleRunningRuns(), 2)
  assert.deepEqual(sent, ['Stopped: Track my parcel. It stopped responding, so I closed it. Nothing was repeated or submitted again.'])
  assert.ok(realRuns[0].metadata_json && (realRuns[0].metadata_json as any).outcome_notified_at)
})

function runtimeHarness(stepStatus: 'completed' | 'failed') {
  const runs = [{ id: 'auto-1', telegram_id: '123', type: 'autonomous', status: 'running', title: 'Plan my Sunday', summary: 'I’m working through this request.', metadata_json: { persistent_general_plan: true } }]
  const steps = [{ id: 's1', run_id: 'auto-1', telegram_id: '123', ordinal: 1, tool_name: 'memory.verified', title: 'Check memory', status: stepStatus, error: stepStatus === 'failed' ? 'autonomous_verification_failed' : null, output_json: { runtime: { stepKey: 'a', dependsOn: [], lane: 'default', maxAttempts: 4, attempt: 1 } } }]
  const db = fakeDb({ agent_runs: runs, agent_steps: steps, agent_activity: [] })
  const notified: any[] = []
  const runtime = loadModule('lib/agent/autonomous-runtime.ts', {
    'node:crypto': { createHash },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    './approval-binding': { assertApprovalBinding: () => { throw Error('Unexpected runtime approval use') } },
    './approval-ttl': { isApprovalExpired: () => { throw Error('Unexpected runtime approval use') } },
    './specialist-registry': { selectSpecialistRoute: () => ({ primary: 'research', supporting: [] }) },
    './run-notify': { notifyRunOutcome: async (run: any) => { notified.push(run); return { status: 'sent' } } },
  })
  const actor = { userId: 'u', legacyTelegramId: 123, whatsappId: 'inert', name: 'Fixture' }
  return { runtime, notified, actor }
}

await check('reconcileRun completed branch notifies when driven in the background', async () => {
  const h = runtimeHarness('completed')
  const result = await h.runtime.executeAutonomousRun({ actor: h.actor, runId: 'auto-1', registry: {}, notifyOutcome: true })
  assert.equal(result.status, 'completed')
  assert.equal(h.notified.length, 1)
  assert.equal(h.notified[0].id, 'auto-1')
  assert.equal(h.notified[0].telegram_id, '123')
  assert.equal(h.notified[0].status, 'completed')
  assert.equal(h.notified[0].title, 'Plan my Sunday')
})
await check('reconcileRun failed branch notifies with the failing step reason', async () => {
  const h = runtimeHarness('failed')
  const result = await h.runtime.executeAutonomousRun({ actor: h.actor, runId: 'auto-1', registry: {}, notifyOutcome: true })
  assert.equal(result.status, 'failed')
  assert.equal(h.notified.length, 1)
  assert.equal(h.notified[0].status, 'failed')
  assert.equal(h.notified[0].error, 'autonomous_verification_failed')
})
await check('a run finished inside the live request is not double-messaged', async () => {
  const h = runtimeHarness('completed')
  await h.runtime.executeAutonomousRun({ actor: h.actor, runId: 'auto-1', registry: {} })
  assert.equal(h.notified.length, 0)
})

await check('background resume path asks for the notice; live path does not', () => {
  const persistent = readFileSync('lib/agent/persistent-general-plan.ts', 'utf8')
  assert.match(persistent, /drivePersistentRun\(params\.actor, params\.runId, missionText, params\.maxWaves \|\| 10, true\)/)
  assert.match(persistent, /drivePersistentRun\(params\.actor, created\.runId, params\.text, 10\)/)
  assert.match(persistent, /executeAutonomousRun\(\{[^}]*notifyOutcome \}\)/)
})
await check('autonomy pulse does not re-announce notified runs', () => {
  const pulse = readFileSync('lib/agent/autonomy-pulse.ts', 'utf8')
  assert.match(pulse, /if\(\(r\.metadata_json as any\)\?\.outcome_notified_at\)continue/)
})

if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
else console.log('Run outcome notice verification passed (inert DB and transport only).')
