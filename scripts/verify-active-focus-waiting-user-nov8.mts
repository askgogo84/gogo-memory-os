// Active Focus (8 Nov): a step that needs the person (sign-in, OTP, captcha, handback, payment) pauses the run without
// spending an attempt, without outcome_unknown and without retrying; resume continues the same step with the same
// idempotency key. Inert storage harness copied from verify-runtime-fencing-review (no provider I/O).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { runMeteredTask } from '../lib/metering/core'
import * as approvalBinding from '../lib/agent/approval-binding'
import * as approvalTtl from '../lib/agent/approval-ttl'
const actor = { userId: 'fixture-owner', legacyTelegramId: 123, whatsappId: 'inert', name: 'Fixture' }
function harness() {
  const run: any = { id: 'run', telegram_id: '123', status: 'running', title: 'Fixture', metadata_json: { objective: 'Fixture' } }
  const step: any = { id: 'step', run_id: 'run', telegram_id: '123', ordinal: 1, tool_name: 'fixture', title: 'Sign in to IRCTC', status: 'queued', output_json: { runtime: { stepKey: 'first', dependsOn: [], lane: 'default', attempt: 0, maxAttempts: 2, mutation: true, verificationRequired: true, idempotencyKey: 'stable-key' } } }
  const tables: any = { agent_runs: [run], agent_steps: [step], agent_activity: [], agent_approvals: [] }
  const db = { from(table: string) {
    let op = 'read', value: any, single = false; const filters: Array<(row: any) => boolean> = []
    const field = (row: any, key: string) => key.split(/->>?/).reduce((v: any, k: string) => v?.[k], row)
    const result = () => { let rows = tables[table].filter((row: any) => filters.every(f => f(row))); if (op === 'update') rows.forEach((row: any) => Object.assign(row, structuredClone(value))); if (op === 'insert') { const values = Array.isArray(value) ? value : [value]; tables[table].push(...structuredClone(values)); rows = values } return { data: structuredClone(single ? (rows[0] || null) : rows), error: null } }
    const q: any = { select: () => q, order: () => q, update: (v: any) => { op = 'update'; value = v; return q }, insert: (v: any) => { op = 'insert'; value = v; return q },
      eq: (k: string, v: any) => { filters.push(r => String(field(r, k)) === String(v)); return q }, in: (k: string, v: any[]) => { filters.push(r => v.includes(field(r, k))); return q },
      is: (k: string, v: any) => { filters.push(r => v === null ? field(r, k) == null : field(r, k) === v); return q }, lte: (k: string, v: any) => { filters.push(r => field(r, k) <= v); return q },
      maybeSingle: async () => { single = true; return result() }, then: (a: any, b: any) => Promise.resolve().then(result).then(a, b) }
    return q
  } }
  const exports: any = {}
  const source = ts.transpileModule(readFileSync('lib/agent/autonomous-runtime.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(source, { exports, Date, Promise, console, require: (id: string) => { if (id === '@/lib/metering/core') return { runMeteredTask }; if (id === './approval-binding') return approvalBinding; if (id === './approval-ttl') return approvalTtl; if (id === 'node:crypto') return { createHash }; if (id === '@/lib/supabase-admin') return { supabaseAdmin: db }; if (id === './specialist-registry') return { selectSpecialistRoute: () => ({ primary: 'research', supporting: [] }) }; if (id === './run-notify') return { notifyRunOutcome: async () => {} }; throw Error('Unexpected dependency ' + id) } })
  return { run, step, tables, rt: exports, execute: (handler: any) => exports.executeAutonomousRun({ actor, runId: 'run', registry: { fixture: handler } }) }
}

// 1. A sign-in wall pauses the run: step queued+waitingUser, attempt given back, lease released, run paused with state waiting_user, no retry on later waves.
{
  const h = harness(); let calls = 0
  const r1 = await h.execute(async () => { calls++; return { status: 'waiting_user', reason: 'sign_in', resumeUrl: 'https://app.askgogo.in/dashboard/activity/run/browser', note: 'IRCTC login page' } })
  assert.equal(r1.status, 'waiting_user'); assert.equal(calls, 1)
  const rt = h.step.output_json.runtime
  assert.equal(h.step.status, 'queued'); assert.equal(rt.attempt, 0, 'waiting is not an attempt spent'); assert.equal(rt.leaseUntil, null); assert.equal(rt.waitingUser.reason, 'sign_in'); assert.equal(rt.idempotencyKey, 'stable-key')
  assert.equal(h.run.status, 'paused'); assert.equal(h.run.metadata_json.state, 'waiting_user'); assert.equal(h.run.metadata_json.waiting_user.stepKey, 'first'); assert.match(h.run.metadata_json.waiting_user.resumeUrl, /activity\/run\/browser/)
  assert.ok(!h.step.output_json.reconciliation_required, 'no outcome_unknown: nothing was mutated')
  assert.ok(h.tables.agent_activity.some((a: any) => a.event_type === 'autonomous_run_waiting_user' && /sign in on the page/.test(a.message)))
  const r2 = await h.execute(async () => { calls++; return { status: 'completed', verified: true } })
  assert.equal(calls, 1, 'a waiting step is never re-dispatched until resumed'); assert.equal(r2.status, 'waiting_user'); assert.equal(h.run.status, 'paused')
  assert.equal(h.tables.agent_activity.filter((a: any) => a.event_type === 'autonomous_run_waiting_user').length, 1, 'the person is told once')
  console.log('✓ sign-in wall → paused/waiting_user; no attempt spent, no retry, no outcome_unknown, told once')

  // 2. Resume: the same step runs with the same key; completes; run completes.
  assert.equal(JSON.stringify(await h.rt.resumeWaitingUserStep({ actor, runId: 'run', stepKey: 'nope' })), JSON.stringify({ resumed: false, reason: 'step_not_found' }))
  assert.equal(JSON.stringify(await h.rt.resumeWaitingUserStep({ actor, runId: 'run', stepKey: 'first' })), JSON.stringify({ resumed: true }))
  assert.equal(h.run.status, 'running'); assert.equal(h.run.metadata_json.waiting_user, undefined); assert.equal(h.step.output_json.runtime.waitingUser, null)
  assert.equal(JSON.stringify(await h.rt.resumeWaitingUserStep({ actor, runId: 'run', stepKey: 'first' })), JSON.stringify({ resumed: false, reason: 'not_waiting' }))
  let seenKey = ''
  const r3 = await h.execute(async (ctx: any) => { calls++; seenKey = ctx.idempotencyKey; return { status: 'completed', verified: true } })
  assert.equal(calls, 2); assert.equal(seenKey, 'stable-key'); assert.equal(r3.status, 'completed'); assert.equal(h.run.status, 'completed'); assert.equal(h.step.output_json.runtime.attempt, 1)
  console.log('✓ resume continues the same step with the same idempotency key; run completes')
}

// 3. Each reason has owner-facing text; a cancelled run cannot be resumed; stale recovery leaves a waiting step alone.
{
  const h = harness()
  for (const r of ['sign_in', 'otp', 'captcha', 'handback', 'payment']) assert.match(h.rt.WAITING_USER_TEXT[r], /Resume/)
  assert.match(h.rt.WAITING_USER_TEXT.otp, /never in chat/)
  await h.execute(async () => ({ status: 'waiting_user', reason: 'otp' }))
  h.run.status = 'failed'; h.run.error = 'user_cancelled'
  assert.equal(JSON.stringify(await h.rt.resumeWaitingUserStep({ actor, runId: 'run', stepKey: 'first' })), JSON.stringify({ resumed: false, reason: 'run_not_active' }))
  h.run.status = 'paused'; h.run.error = null
  await h.rt.recoverStaleAutonomousSteps({ actor, runId: 'run', staleMinutes: 2 })
  assert.equal(h.step.status, 'queued'); assert.equal(h.step.output_json.runtime.waitingUser.reason, 'otp'); assert.equal(h.run.status, 'paused')
  console.log('✓ owner text per reason; cancelled runs stay cancelled; stale recovery does not touch a waiting step')
}
console.log('Active Focus waiting_user (8 Nov) checks passed')
