// Same Brain 3.0 Phase 3 live path: the step handlers drive the interpreter over the existing runtime's step shape.
// Approval is staged (bound) before any execute; execute runs only after the owner's yes is released onto the step;
// a write that is not wired fails closed; VERIFY is its own retryable step; untaken branches are skipped.
import assert from 'node:assert/strict'
import { procedureRegistryFor, ProcedureExecuteError, type ProcedureIO, type ProcedureStore } from '../lib/procedures/runtime'
import { compileToPlan } from '../lib/procedures/compile'
import { createRun, type ProcedureRun } from '../lib/procedures/engine'
import { TRAVEL_DAY, MEETING_PREP } from '../lib/procedures/templates'
import { defaultRegistry } from '../lib/procedures/registry'
let n = 0; const ok = (s: string) => { n++; console.log('PASS', s) }
const actor: any = { legacyTelegramId: -884501501, whatsappId: '918884501501', timezone: 'Asia/Kolkata' }
const nowIso = () => new Date().toISOString()

function fakeStore(initial: ProcedureRun) {
  let state = initial, seq = 1
  const approvals = new Map<string, { status: string; fingerprint: string }>()
  const traces: any[] = []
  const store: ProcedureStore = {
    async loadState() { return { state, seq } },
    async saveState(_r, _t, s, expectedSeq) { if (expectedSeq !== seq) return false; state = s; seq++; return true },
    async stageApproval({ node, fingerprint }) { const id = `ap-${approvals.size + 1}`; approvals.set(id, { status: 'pending', fingerprint }); assert.equal(node.type, 'APPROVAL'); return { id } },
    async approvalStatus(_t, _r, id) { return (approvals.get(id)?.status as any) || null },
    async recordTrace(_a, s) { traces.push({ status: s.status, classes: s.trace.map(t => t.evidenceClass || null) }) },
  }
  return { store, get state() { return state }, approvals, traces }
}
const ctxFor = (runId: string, stepKey: string, extra: Partial<any> = {}) => ({ actor, runId, objective: 'test', step: { id: `s-${stepKey}`, run_id: runId, ordinal: 1, tool_name: `procedure.x`, title: stepKey, status: 'running', output_json: {} } as any, runtime: { stepKey, dependsOn: [], lane: 'default', maxAttempts: 3, attempt: 1, requiresApproval: false, verificationRequired: false, mutation: false, idempotencyKey: `idem-${stepKey}`, approvalId: null, approvalGrantedId: null, ...extra } as any, idempotencyKey: `idem-${stepKey}` })

{ // travel day: reads → reason → condition → approval staged → released → execute not wired fails closed
  const reads: Record<string, any> = { read_leg: { leg: { id: 'l1', flightNo: '6E204' } }, read_live: { flightStatus: 'landed', eta: '12:10' } }
  const io: ProcedureIO = {
    async read({ node }) { if (node.id === 'read_live' && reads.failOnce) { reads.failOnce = false; throw new Error('provider_timeout') } return reads[node.id] },
    async reason() { return { plan: 'cab at 12:30', needsCab: true, nextNode: 'book_cab' } },
    preview() { return [{ label: 'Action', value: 'Book the cab' }] },
    async execute({ node }) { throw new ProcedureExecuteError(`execute_not_wired:${node.id}`, true) },
    async verify() { return null }, async waitEvent() { return null },
  }
  reads.failOnce = true
  const f = fakeStore(createRun(TRAVEL_DAY, 'run-t', { legId: 'l1' }, nowIso))
  const reg = procedureRegistryFor(TRAVEL_DAY, io, f.store, defaultRegistry())
  const plan = compileToPlan(TRAVEL_DAY, { legId: 'l1' }, 'travel day')
  assert.ok(plan.steps.find(s => s.key === 'verify_cab'), 'VERIFY is its own step'); assert.equal(plan.steps.find(s => s.key === 'book_cab')!.requiresApproval, false, 'approval is staged by the handler, not pre-required')
  let r = await reg['procedure.read'](ctxFor('run-t', 'read_leg')); assert.equal(r.status, 'completed'); assert.equal(f.state.current, 'read_live')
  r = await reg['procedure.parallel_read'](ctxFor('run-t', 'read_live')); assert.equal(r.status, 'retryable_failure', 'provider timeout retries via the runtime'); assert.equal(f.state.attempts.read_live, 1)
  r = await reg['procedure.parallel_read'](ctxFor('run-t', 'read_live')); assert.equal(r.status, 'completed')
  r = await reg['procedure.reason'](ctxFor('run-t', 'reason')); assert.equal(r.status, 'completed'); assert.equal(f.state.context.nextNode, undefined, 'undeclared model keys dropped')
  assert.equal(f.state.current, 'approve_cab', 'condition evaluated inside the reason step hand-off')
  r = await reg['procedure.condition'](ctxFor('run-t', 'cab_needed')); assert.equal(r.status, 'completed'); assert.equal((r as any).output.skipped, true, 'condition already consumed: step completes as skipped')
  r = await reg['procedure.execute'](ctxFor('run-t', 'book_cab')); assert.equal(r.status, 'waiting_approval'); assert.equal((r as any).approvalId, 'ap-1'); assert.equal(f.state.status, 'waiting_approval')
  // re-dispatch before release: still waiting, nothing executed
  r = await reg['procedure.execute'](ctxFor('run-t', 'book_cab')); assert.equal(r.status, 'waiting_approval')
  // owner approves but the runtime has not released it onto the step → still refused
  f.approvals.get('ap-1')!.status = 'approved'
  r = await reg['procedure.execute'](ctxFor('run-t', 'book_cab')); assert.equal(r.status, 'waiting_approval', 'approved in the table but not released to this step: no execute')
  r = await reg['procedure.execute'](ctxFor('run-t', 'book_cab', { approvalGrantedId: 'ap-1' })); assert.equal(r.status, 'blocked'); assert.match((r as any).error, /execute_not_wired:book_cab/)
  assert.equal(f.state.status, 'failed'); assert.ok(!f.state.uncertain.length, 'known failure is not recorded as uncertain')
  assert.equal(f.traces.length, 1); assert.equal(f.traces[0].status, 'failed')
  ok('travel day live path: retry on read, model keys filtered, approval staged then released, unwired write fails closed, trace written')
}

{ // uncertain write escalates and the step is blocked; a later dispatch never re-executes
  let calls = 0
  const io: ProcedureIO = { async read({ node }) { return node.id === 'read_leg' ? { leg: { flightNo: '6E204' } } : { flightStatus: 'delayed', eta: '13:00' } }, async reason() { return { plan: 'p', needsCab: true } }, preview() { return [] }, async execute() { calls++; throw new ProcedureExecuteError('socket hang up after POST', false) }, async verify() { return null }, async waitEvent() { return null } }
  const f = fakeStore(createRun(TRAVEL_DAY, 'run-u', { legId: 'l1' }, nowIso)); const reg = procedureRegistryFor(TRAVEL_DAY, io, f.store)
  for (const k of ['read_leg', 'read_live', 'reason']) await reg['procedure.read'](ctxFor('run-u', k))
  let r = await reg['procedure.execute'](ctxFor('run-u', 'book_cab')); assert.equal(r.status, 'waiting_approval')
  f.approvals.get('ap-1')!.status = 'approved'
  r = await reg['procedure.execute'](ctxFor('run-u', 'book_cab', { approvalGrantedId: 'ap-1' })); assert.equal(r.status, 'blocked'); assert.match((r as any).error, /outcome_unknown/)
  assert.equal(f.state.status, 'escalated'); assert.deepEqual(f.state.uncertain, ['book_cab'])
  r = await reg['procedure.execute'](ctxFor('run-u', 'book_cab', { approvalGrantedId: 'ap-1' })); assert.equal(calls, 1, 'never re-executed'); assert.equal(r.status, 'completed'); assert.equal((r as any).output.skipped, true)
  r = await reg['procedure.escalate'](ctxFor('run-u', 'escalate')); assert.equal(r.status, 'completed', 'terminal state: nothing more runs')
  ok('uncertain write: escalated, blocked, never replayed on re-dispatch')
}

{ // rejected approval skips the booking; meeting prep is read-only and completes with a brief
  const io: ProcedureIO = { async read({ node }) { return node.id === 'read_leg' ? { leg: { flightNo: '6E204' } } : { flightStatus: 'on time', eta: '11:00' } }, async reason() { return { plan: 'p', needsCab: true } }, preview() { return [] }, async execute() { throw new Error('must_not_run') }, async verify() { return null }, async waitEvent() { return { landedAt: '11:05' } } }
  const f = fakeStore(createRun(TRAVEL_DAY, 'run-r', { legId: 'l1' }, nowIso)); const reg = procedureRegistryFor(TRAVEL_DAY, io, f.store)
  for (const k of ['read_leg', 'read_live', 'reason']) await reg['procedure.read'](ctxFor('run-r', k))
  await reg['procedure.execute'](ctxFor('run-r', 'book_cab')); f.approvals.get('ap-1')!.status = 'rejected'
  let r = await reg['procedure.execute'](ctxFor('run-r', 'book_cab')); assert.equal(r.status, 'completed'); assert.equal((r as any).output.approval, 'rejected'); assert.equal(f.state.current, 'wait_landing')
  r = await reg['procedure.verify'](ctxFor('run-r', 'verify_cab')); assert.equal((r as any).output.skipped, true)
  r = await reg['procedure.wait_event'](ctxFor('run-r', 'wait_landing')); assert.equal(r.status, 'completed'); assert.equal(f.state.status, 'completed')
  const mio: ProcedureIO = { async read({ node }) { return node.id === 'read_event' ? { event: { title: 'Harbor partner meeting', attendees: [{ email: 'nithin@tipplr.in', displayName: 'Nithin' }] } } : { participants: [{ email: 'nithin@tipplr.in', name: 'Nithin', notes: [] }], threads: null, openTasks: ['Send the deck'], documentsAvailable: false } }, async reason() { return { brief: 'Harbor: Nithin. Deck owed. Not checked: documents, email', missing: ['documents', 'email threads'] } }, preview() { return [] }, async execute() { throw new Error('no') }, async verify() { return null }, async waitEvent() { return null } }
  const m = fakeStore(createRun(MEETING_PREP, 'run-m', { eventId: 'next' }, nowIso)); const mreg = procedureRegistryFor(MEETING_PREP, mio, m.store)
  for (const k of ['read_event', 'read_context', 'brief']) assert.equal((await mreg['procedure.read'](ctxFor('run-m', k))).status, 'completed')
  assert.equal(m.state.status, 'completed'); assert.deepEqual(m.state.context.missing, ['documents', 'email threads']); assert.equal(m.traces[0].status, 'completed')
  ok('rejected approval skips the write and the run still completes; meeting prep completes read-only with missing items disclosed')
}
{ // email.follow_up production wiring: same consent/access as chat, exact read-back, unknown outcomes never retried
  const { readFileSync } = await import('node:fs')
  const { gmailSendFailureKnown } = await import('../lib/procedures/io')
  for (const r of ['gmail_send_failed_400', 'gmail_send_failed_403', 'gmail_send_scope_required']) assert.equal(gmailSendFailureKnown(r), true, r)
  for (const r of ['gmail_send_failed_500', 'socket hang up', 'ETIMEDOUT', '']) assert.equal(gmailSendFailureKnown(r), false, r)
  const io = readFileSync('lib/procedures/io.ts', 'utf8')
  assert.match(io, /case 'email\.follow_up:read_thread'[\s\S]*resolveThread\(actor,/, 'thread resolved with the chat path (consent + access checks)')
  assert.match(io, /gmailAccess\(actor, \{ requireSend: true \}\)/, 'send needs the Gmail Send connection')
  assert.match(io, /verifyGmailSentMessage\(access\.accessToken, objectRef, threadId\)[\s\S]*source: 'gmail', kind: 'provider_readback'/, 'verified only by SENT label + thread read-back')
  assert.match(io, /execute_not_wired:\$\{def\.id\}:\$\{node\.id\}`, true\)/, 'other writes (cab booking) still fail closed')
  assert.ok(!/claude|anthropic|completeWithFallback/i.test(io.slice(io.indexOf("'email.follow_up:draft'"), io.indexOf("'email.follow_up:draft'") + 600)), 'draft is deterministic, not model-written')
  ok('email follow-up wiring: chat-path consent/access, Send connection required, read-back evidence, 4xx = not sent, anything else = unknown (never retried)')
}
{ // chat entry + approval release wiring
  const { readFileSync } = await import('node:fs')
  const { parseFollowUpAsk } = await import('../lib/procedures/entry')
  assert.deepEqual(parseFollowUpAsk('follow up with Nithin on the Harbor deck'), { target: 'Nithin on the Harbor deck' })
  assert.deepEqual(parseFollowUpAsk('Send a follow-up email to Divya.'), { target: 'Divya' })
  assert.equal(parseFollowUpAsk('what did Nithin say about the deck'), null); assert.equal(parseFollowUpAsk('follow up'), null)
  const entry = readFileSync('lib/procedures/entry.ts', 'utf8'); assert.match(entry, /proceduresEnabledFor\(String\(actor\.legacyTelegramId\)\)\) return null/)
  const route = readFileSync('app/api/agent/approvals/[id]/route.ts', 'utf8')
  assert.match(route, /decision === 'approve' && data\.run_id && payload\?\.plan_type === 'procedure'/, 'release only for procedure approvals, only on a yes')
  assert.match(route, /releaseApprovedAutonomousStep\(\{ actor, runId: String\(data\.run_id\), stepKey: String\(payload\.step_key\) \}\)[\s\S]*resumeProcedureRun/, 'runtime re-checks the binding on release, then the run resumes')
  assert.ok(route.indexOf('guardApprovalFreshness') < route.indexOf('releaseApprovedAutonomousStep'), 'expired approvals are closed before any release')
  const chat = readFileSync('app/api/dashboard/chat/route.ts', 'utf8'); assert.match(chat, /tryProcedureAsk\(actor,text\)/)
  ok('chat "follow up with …" starts email.follow_up for flagged owners; a yes releases the bound approval onto its step and resumes the run')
}
console.log(`verify-procedures-runtime-nov9: ${n} passed`)
