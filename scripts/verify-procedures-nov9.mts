// Same Brain 3.0 Phase 3: procedure engine. Validation rejects graphs that bypass policy; the interpreter never executes
// without a bound, unexpired approval, never replays an uncertain write, never passes VERIFY on a bare mutation id, and
// the durable adapter compiles onto the existing runtime plan (approval + verification on the mutation step).
import assert from 'node:assert/strict'
import { validateProcedure, type ProcedureDefinition } from '../lib/procedures/schema'
import { advance, createRun, evaluateCondition, executeGuard, expected, approvalFingerprint, retryDelayMinutes, type ProcedureRun } from '../lib/procedures/engine'
import { CANCELLATION_INCIDENT, CONDITIONS, EMAIL_FOLLOW_UP, MEETING_PREP, TEMPLATES, TRAVEL_DAY } from '../lib/procedures/templates'
import { ProcedureRegistry, defaultRegistry, proceduresEnabledFor } from '../lib/procedures/registry'
import { compileToPlan } from '../lib/procedures/compile'
let n = 0; const ok = (s: string) => { n++; console.log('PASS', s) }
let t = Date.parse('2026-11-09T10:00:00Z'); const now = () => new Date(t).toISOString(); const tick = (ms: number) => { t += ms }

{ // all templates validate; registry refuses invalid graphs
  for (const d of TEMPLATES) assert.deepEqual(validateProcedure(d), [], d.id)
  const reg = defaultRegistry(); assert.equal(reg.list().length, 4); assert.equal(reg.latest('travel.day')?.version, 1)
  const noApproval: ProcedureDefinition = { ...EMAIL_FOLLOW_UP, id: 'bad.email', edges: EMAIL_FOLLOW_UP.edges.map(e => e.from === 'draft' ? { from: 'draft', to: 'send' } : e).filter(e => e.from !== 'approve') , nodes: EMAIL_FOLLOW_UP.nodes.filter(x => x.id !== 'approve') }
  const issues = validateProcedure(noApproval); assert.ok(issues.some(i => i.code === 'execute_without_approval'))
  const noVerify: ProcedureDefinition = { ...EMAIL_FOLLOW_UP, id: 'bad.verify', nodes: EMAIL_FOLLOW_UP.nodes.filter(x => x.id !== 'verify'), edges: EMAIL_FOLLOW_UP.edges.filter(e => e.from !== 'verify').map(e => e.to === 'verify' ? { ...e, to: 'done' } : e) }
  assert.ok(validateProcedure(noVerify).some(i => i.code === 'execute_without_verify'))
  const cyc: ProcedureDefinition = { ...MEETING_PREP, id: 'bad.cycle', edges: [...MEETING_PREP.edges, { from: 'brief', to: 'read_event' }] }
  assert.ok(validateProcedure(cyc).some(i => i.code === 'unbounded_cycle'))
  assert.throws(() => new ProcedureRegistry().register(noApproval), /procedure_invalid:bad.email.*execute_without_approval/)
  const unbound: ProcedureDefinition = { ...EMAIL_FOLLOW_UP, id: 'bad.unbound', nodes: EMAIL_FOLLOW_UP.nodes.map(x => x.type === 'APPROVAL' ? { ...x, approval: { actionType: 'email.send', title: 'Send' } } : x) }
  assert.ok(validateProcedure(unbound).some(i => i.code === 'approval_unbound'), 'a consequential approval must say what it binds')
  assert.throws(() => new ProcedureRegistry().register(TRAVEL_DAY, {}), /procedure_conditions_missing:travel.day:cab_needed/)
  assert.equal(proceduresEnabledFor('-884501501', {}), false); assert.equal(proceduresEnabledFor('-884501501', { GOGO_PROCEDURES_OWNERS: '-884501501' }), true)
  ok('templates validate; graphs without approval/verify or with unbounded cycles are refused at registration; flag off by default')
}

const C = CONDITIONS['travel.day']
const step = (def: ProcedureDefinition, r: ProcedureRun, ev: Parameters<typeof advance>[2]) => { let x = advance(def, r, ev, now); while (x.status === 'running' && expected(def, x).action === 'condition') x = evaluateCondition(def, x, CONDITIONS[def.id], now); return x }

{ // travel day happy path with approval + verified booking + landing event
  let r = createRun(TRAVEL_DAY, 'run-1', { legId: 'leg-6E204' }, now)
  r = step(TRAVEL_DAY, r, { kind: 'start' }); assert.equal(r.current, 'read_leg')
  r = step(TRAVEL_DAY, r, { kind: 'read_ok', node: 'read_leg', output: { leg: { flight: '6E204' } } }); assert.equal(r.current, 'read_live')
  r = step(TRAVEL_DAY, r, { kind: 'read_failed', node: 'read_live', error: 'provider_timeout' }); assert.equal(r.current, 'read_live'); assert.equal(r.attempts.read_live, 1); assert.equal(retryDelayMinutes(TRAVEL_DAY.nodes.find(x => x.id === 'read_live')!, 1), 2)
  r = step(TRAVEL_DAY, r, { kind: 'read_ok', node: 'read_live', output: { flightStatus: 'landed', eta: '12:10' } }); assert.equal(r.current, 'reason')
  // model tries to smuggle a branch: only declared keys survive
  r = step(TRAVEL_DAY, r, { kind: 'reasoned', node: 'reason', output: { plan: 'cab at 12:30', needsCab: true, nextNode: 'book_cab', approved: true } })
  assert.equal(r.context.nextNode, undefined); assert.equal(r.context.approved, undefined)
  assert.equal(r.current, 'approve_cab', 'condition evaluated by the predicate table, not the model')
  assert.equal(executeGuard(TRAVEL_DAY, { ...r, current: 'book_cab' }, now()).ok, false)
  const fp = approvalFingerprint(TRAVEL_DAY, TRAVEL_DAY.nodes.find(x => x.id === 'approve_cab')!, r.context)
  r = step(TRAVEL_DAY, r, { kind: 'approval_created', node: 'approve_cab', approval: { id: 'ap-1', actionType: 'travel.book_cab', fingerprint: fp, status: 'pending', expiresAt: new Date(t + 30 * 60_000).toISOString() } })
  assert.equal(r.status, 'waiting_approval')
  const g0 = executeGuard(TRAVEL_DAY, { ...r, current: 'book_cab', status: 'running' }, now()); assert.deepEqual(g0, { ok: false, reason: 'approval_pending' })
  r = step(TRAVEL_DAY, r, { kind: 'approval_decided', approvalId: 'ap-1', status: 'approved', fingerprint: fp }); assert.equal(r.current, 'book_cab'); assert.equal(r.status, 'running')
  assert.equal(executeGuard(TRAVEL_DAY, r, now()).ok, true)
  tick(31 * 60_000); assert.deepEqual(executeGuard(TRAVEL_DAY, r, now()), { ok: false, reason: 'approval_expired' }); tick(-31 * 60_000)
  r = step(TRAVEL_DAY, r, { kind: 'executed', node: 'book_cab', objectRef: 'cab-778' }); assert.equal(r.current, 'verify_cab')
  // a bare id / 200 is not proof
  r = step(TRAVEL_DAY, r, { kind: 'verified', node: 'verify_cab', objectRef: 'cab-778', evidence: null }); assert.equal(r.current, 'verify_cab'); assert.equal(r.attempts.verify_cab, 1)
  r = step(TRAVEL_DAY, r, { kind: 'verified', node: 'verify_cab', objectRef: 'cab-778', evidence: { source: 'travel', kind: 'provider_readback', objectRef: 'cab-999', providerRef: 'SAV-1', verified: true } }); assert.equal(r.current, 'verify_cab', 'evidence for a different object is rejected')
  r = step(TRAVEL_DAY, r, { kind: 'verified', node: 'verify_cab', objectRef: 'cab-778', evidence: { source: 'travel', kind: 'provider_readback', objectRef: 'cab-778', providerRef: 'SAV-1', verified: true } })
  assert.equal(r.current, 'wait_landing'); assert.equal(r.status, 'waiting_event')
  r = step(TRAVEL_DAY, r, { kind: 'event', name: 'cab.arrived' }); assert.equal(r.status, 'waiting_event', 'wrong event ignored')
  r = step(TRAVEL_DAY, r, { kind: 'event', name: 'flight.landed', payload: { landedAt: '12:05' } }); assert.equal(r.status, 'completed')
  const classes = r.trace.map(x => `${x.node}:${x.outcome}:${x.evidenceClass || '-'}`)
  assert.ok(classes.includes('read_live:ok:verified') && classes.includes('reason:ok:inferred') && classes.includes('book_cab:executed:reported') && classes.includes('verify_cab:verified:verified'))
  ok('travel day: retry on read, model cannot pick a branch, approval binds and expires, VERIFY needs matching provider evidence, event resumes')
}

{ // fault injection: uncertain write never replays; rejected approval skips; binding mismatch fails closed
  let r = createRun(TRAVEL_DAY, 'run-2', { legId: 'leg-1' }, now)
  for (const ev of [{ kind: 'start' }, { kind: 'read_ok', node: 'read_leg', output: { leg: {} } }, { kind: 'read_ok', node: 'read_live', output: { flightStatus: 'delayed', eta: '13:00' } }, { kind: 'reasoned', node: 'reason', output: { plan: 'p', needsCab: true } }] as const) r = step(TRAVEL_DAY, r, ev as any)
  const fp = approvalFingerprint(TRAVEL_DAY, TRAVEL_DAY.nodes.find(x => x.id === 'approve_cab')!, r.context)
  r = step(TRAVEL_DAY, r, { kind: 'approval_created', node: 'approve_cab', approval: { id: 'ap-2', actionType: 'travel.book_cab', fingerprint: fp, status: 'pending', expiresAt: new Date(t + 60_000).toISOString() } })
  r = step(TRAVEL_DAY, r, { kind: 'approval_decided', approvalId: 'ap-2', status: 'approved', fingerprint: fp })
  r = step(TRAVEL_DAY, r, { kind: 'execute_failed', node: 'book_cab', error: 'socket hang up after POST', outcomeKnown: false })
  assert.equal(r.status, 'escalated'); assert.deepEqual(r.uncertain, ['book_cab'])
  assert.deepEqual(executeGuard(TRAVEL_DAY, { ...r, current: 'book_cab', status: 'running' }, now()), { ok: false, reason: 'outcome_unknown_never_replay' })
  // rejected approval → no booking, run continues to wait for landing
  let r2 = createRun(TRAVEL_DAY, 'run-3', { legId: 'leg-1' }, now)
  for (const ev of [{ kind: 'start' }, { kind: 'read_ok', node: 'read_leg', output: { leg: {} } }, { kind: 'read_ok', node: 'read_live', output: { flightStatus: 'on time', eta: '11:00' } }, { kind: 'reasoned', node: 'reason', output: { plan: 'p', needsCab: true } }] as const) r2 = step(TRAVEL_DAY, r2, ev as any)
  const fp2 = approvalFingerprint(TRAVEL_DAY, TRAVEL_DAY.nodes.find(x => x.id === 'approve_cab')!, r2.context)
  r2 = step(TRAVEL_DAY, r2, { kind: 'approval_created', node: 'approve_cab', approval: { id: 'ap-3', actionType: 'travel.book_cab', fingerprint: fp2, status: 'pending', expiresAt: new Date(t + 60_000).toISOString() } })
  r2 = step(TRAVEL_DAY, r2, { kind: 'approval_decided', approvalId: 'ap-3', status: 'rejected', fingerprint: fp2 }); assert.equal(r2.current, 'wait_landing')
  // approval created for a different action type or fingerprint fails closed
  let r3 = createRun(TRAVEL_DAY, 'run-4', { legId: 'leg-1' }, now)
  for (const ev of [{ kind: 'start' }, { kind: 'read_ok', node: 'read_leg', output: { leg: {} } }, { kind: 'read_ok', node: 'read_live', output: { flightStatus: 'x', eta: 'y' } }, { kind: 'reasoned', node: 'reason', output: { plan: 'p', needsCab: true } }] as const) r3 = step(TRAVEL_DAY, r3, ev as any)
  const bad = step(TRAVEL_DAY, r3, { kind: 'approval_created', node: 'approve_cab', approval: { id: 'ap-4', actionType: 'payments.pay', fingerprint: 'x', status: 'pending', expiresAt: now() } }); assert.equal(bad.status, 'failed'); assert.equal(bad.error, 'approval_action_type_mismatch')
  const fp3 = approvalFingerprint(TRAVEL_DAY, TRAVEL_DAY.nodes.find(x => x.id === 'approve_cab')!, r3.context)
  r3 = step(TRAVEL_DAY, r3, { kind: 'approval_created', node: 'approve_cab', approval: { id: 'ap-5', actionType: 'travel.book_cab', fingerprint: fp3, status: 'pending', expiresAt: now() } })
  const tampered = step(TRAVEL_DAY, r3, { kind: 'approval_decided', approvalId: 'ap-5', status: 'approved', fingerprint: fp3 + ':other-target' }); assert.equal(tampered.status, 'failed'); assert.equal(tampered.error, 'approval_binding_mismatch')
  // approval timeout → expired edge
  const expired = step(TRAVEL_DAY, r3, { kind: 'timeout', node: 'approve_cab' }); assert.equal(expired.current, 'wait_landing'); assert.equal(expired.approvals.approve_cab.status, 'expired')
  // stale event for another node is ignored
  const stale = step(TRAVEL_DAY, r3, { kind: 'executed', node: 'book_cab', objectRef: 'nope' }); assert.equal(stale.current, 'approve_cab'); assert.equal(stale.context['book_cab.objectRef'], undefined)
  ok('faults: uncertain write escalates and is never replayed; rejected/expired approvals skip the action; mismatched binding fails closed; stale events ignored')
}

{ // email follow-up: already replied → done without draft; else approval → send → gmail read-back verification
  const E = EMAIL_FOLLOW_UP
  let a = createRun(E, 'e1', { target: 'Nithin' }, now)
  a = step(E, a, { kind: 'start' }); a = step(E, a, { kind: 'read_ok', node: 'read_thread', output: { thread: { lastFromMe: true } } }); assert.equal(a.status, 'completed'); assert.ok(!a.trace.some(x => x.node === 'draft'))
  let b = createRun(E, 'e2', { target: 'Harbor deck' }, now)
  b = step(E, b, { kind: 'start' }); b = step(E, b, { kind: 'read_ok', node: 'read_thread', output: { thread: { lastFromMe: false } } }); assert.equal(b.current, 'draft')
  b = step(E, b, { kind: 'reasoned', node: 'draft', output: { draft: 'Hi Nithin, following up on the Harbor deck.' } }); assert.equal(b.current, 'approve')
  const fp = approvalFingerprint(E, E.nodes.find(x => x.id === 'approve')!, b.context)
  b = step(E, b, { kind: 'approval_created', node: 'approve', approval: { id: 'ap-e', actionType: 'email.send', fingerprint: fp, status: 'pending', expiresAt: new Date(t + 60_000).toISOString() } })
  b = step(E, b, { kind: 'approval_decided', approvalId: 'ap-e', status: 'approved', fingerprint: fp })
  assert.equal(executeGuard(E, b, now()).ok, true)
  // the approval covers the exact draft and thread: a changed draft is refused before anything is sent
  assert.deepEqual(executeGuard(E, { ...b, context: { ...b.context, draft: 'Hi Nithin, please wire the money today.' } }, now()), { ok: false, reason: 'approval_binding_mismatch' })
  assert.deepEqual(executeGuard(E, { ...b, context: { ...b.context, thread: { lastFromMe: false, to: 'someone@else.com' } } }, now()), { ok: false, reason: 'approval_binding_mismatch' })
  b = step(E, b, { kind: 'executed', node: 'send', objectRef: 'msg-1' })
  b = step(E, b, { kind: 'verified', node: 'verify', objectRef: 'msg-1', evidence: { source: 'google_calendar', kind: 'provider_readback', objectRef: 'msg-1', providerRef: 'x', verified: true } }); assert.equal(b.current, 'verify', 'wrong evidence source rejected')
  b = step(E, b, { kind: 'verified', node: 'verify', objectRef: 'msg-1', evidence: { source: 'gmail', kind: 'provider_readback', objectRef: 'msg-1', providerRef: 'r-1', verified: true } }); assert.equal(b.status, 'completed')
  // verify budget exhausted → escalate, not complete
  let c: ProcedureRun = { ...b, current: 'verify', status: 'running', attempts: {}, trace: [] }
  c = step(E, c, { kind: 'verified', node: 'verify', objectRef: 'msg-1', evidence: null }); c = step(E, c, { kind: 'verified', node: 'verify', objectRef: 'msg-1', evidence: null }); c = step(E, c, { kind: 'verified', node: 'verify', objectRef: 'msg-1', evidence: null })
  assert.equal(c.status, 'escalated')
  ok('email follow-up: skips when already replied; approval binds the exact draft and recipient; only gmail read-back verifies; exhausted verify escalates')
}

{ // meeting prep is read-only and discloses missing documents; enterprise incident never executes
  const M = MEETING_PREP; let m = createRun(M, 'm1', { eventId: 'ev-1' }, now)
  m = step(M, m, { kind: 'start' }); m = step(M, m, { kind: 'read_ok', node: 'read_event', output: { event: { title: 'Harbor partner meeting' } } })
  m = step(M, m, { kind: 'read_ok', node: 'read_context', output: { participants: ['Nithin'], threads: [], openTasks: ['Send the deck'], documentsAvailable: false } })
  m = step(M, m, { kind: 'reasoned', node: 'brief', output: { brief: 'Harbor: Nithin; deck still owed.', missing: ['documents (not connected)'] } }); assert.equal(m.status, 'completed')
  assert.ok(!M.nodes.some(x => x.type === 'EXECUTE')); assert.ok(!CANCELLATION_INCIDENT.nodes.some(x => x.type === 'EXECUTE' || x.capability === 'merchant'))
  const I = CANCELLATION_INCIDENT; let i = createRun(I, 'i1', { workspaceId: '7e1b6f4a-2c0d-4b58-9c3e-5a1f0d9b2e77', orderRef: 'FK-1' }, now)
  i = step(I, i, { kind: 'start' }); i = step(I, i, { kind: 'read_ok', node: 'read_order', output: { order: { id: 'FK-1' } } })
  i = step(I, i, { kind: 'read_ok', node: 'read_history', output: { recentCancellations: [1, 2, 3], stockSignal: 'low' } })
  i = step(I, i, { kind: 'reasoned', node: 'classify', output: { cause: 'out_of_stock', severity: 'medium' } }); assert.equal(i.current, 'escalate'); assert.equal(i.status, 'escalated')
  const missing = createRun(I, 'i2', { workspaceId: 'w' }, now); assert.equal(missing.status, 'failed'); assert.match(missing.error!, /missing_inputs:orderRef/)
  ok('meeting prep read-only with missing disclosure; enterprise incident has no merchant EXECUTE and escalates on repeat pattern; missing inputs fail at start')
}

{ // durable adapter: approval + verification folded onto the mutation step of the existing runtime plan
  const plan = compileToPlan(TRAVEL_DAY, { legId: 'leg-6E204' }, 'Travel day for 6E204')
  const keys = plan.steps.map(s => s.key)
  assert.ok(!keys.includes('approve_cab') && keys.includes('verify_cab') && !keys.includes('start') && !keys.includes('done'))
  const book = plan.steps.find(s => s.key === 'book_cab')!
  assert.equal(book.toolName, 'procedure.execute'); assert.equal(book.mutation, true); assert.equal(book.requiresApproval, false, 'the handler stages the bound approval on first dispatch'); assert.equal(book.maxAttempts, 1)
  const verify = plan.steps.find(s => s.key === 'verify_cab')!; assert.equal(verify.verificationRequired, true); assert.equal(verify.mutation, undefined); assert.deepEqual(verify.dependsOn, ['book_cab']); assert.ok(verify.maxAttempts >= 2)
  assert.equal(book.approvalAction?.actionType, 'travel.book_cab'); assert.equal(book.approvalAction?.capability, 'travel')
  assert.deepEqual(book.dependsOn, ['cab_needed'])
  assert.deepEqual(plan.steps.find(s => s.key === 'read_live')!.dependsOn, ['read_leg']); assert.equal(plan.steps.find(s => s.key === 'read_live')!.maxAttempts, 4)
  assert.ok(plan.steps.find(s => s.key === 'wait_landing')!.dependsOn.includes('verify_cab'))
  assert.equal((plan.metadata as any).plan_kind, 'procedure-plan-v1')
  const mp = compileToPlan(MEETING_PREP, { eventId: 'e' }, 'prep'); assert.ok(mp.steps.every(s => !s.mutation && !s.requiresApproval))
  ok('compile: EXECUTE is a single-attempt mutation step with a bound approvalAction; VERIFY is its own retryable step; reads keep retry budgets; no mutation in read-only procedures')
}
console.log(`verify-procedures-nov9: ${n} passed`)
