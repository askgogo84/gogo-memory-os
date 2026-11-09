// Same Brain 3.0 Phase 3: a pure, deterministic interpreter for procedure graphs. No I/O here: every transition is
// `advance(run, event)` → new run. The durable adapter (compile.ts) maps the same graph onto agent_runs/agent_steps so
// the existing autonomous runtime stays the only orchestrator; this interpreter is the reference semantics it must
// honour, and what the fault-injection tests drive.
//
// Hard rules (tests: scripts/verify-procedures-nov9.mts):
//   - EXECUTE never starts without an approval record bound to the same action (approval id + fingerprint), never
//     after the approval expired, and never twice: an EXECUTE whose outcome is unknown goes to ESCALATE, not retry.
//   - VERIFY passes only on ExecutionEvidence that `hasExecutionEvidence` accepts; a 200 or a returned id is not proof.
//   - Only READ / PARALLEL_READ / VERIFY retry, within the node's retry budget; loops honour their maxIterations.
//   - The model's role is confined to REASON/DECIDE outputs; it cannot name the next node of a CONDITION, that is
//     evaluated from context by the procedure's own predicate table.
import { hasExecutionEvidence, type ExecutionEvidence } from '@/lib/agent/execution-evidence'
import type { ProcedureDefinition, ProcedureNode } from './schema'

export type RunStatus = 'running' | 'waiting_approval' | 'waiting_event' | 'waiting_user' | 'escalated' | 'completed' | 'failed'
export type ApprovalRecord = { id: string; actionType: string; fingerprint: string; status: 'pending' | 'approved' | 'rejected' | 'expired'; expiresAt: string }

export type ProcedureRun = {
  procedureId: string
  procedureVersion: number
  runId: string
  status: RunStatus
  current: string
  context: Record<string, unknown>
  /** node id → attempts so far */
  attempts: Record<string, number>
  /** edge key `from→to` → iterations taken */
  loops: Record<string, number>
  approvals: Record<string, ApprovalRecord>
  /** node id → evidence class recorded for the decision trace */
  trace: TraceEntry[]
  error: string | null
  /** EXECUTE nodes whose outcome is not known: never re-run. */
  uncertain: string[]
}
export type TraceEntry = { at: string; node: string; type: ProcedureNode['type']; outcome: string; evidenceClass?: 'verified' | 'reported' | 'inferred'; detail?: string }

export type RunEvent =
  | { kind: 'start' }
  | { kind: 'read_ok'; node: string; output: Record<string, unknown> }
  | { kind: 'read_failed'; node: string; error: string }
  | { kind: 'reasoned'; node: string; output: Record<string, unknown> }
  | { kind: 'approval_created'; node: string; approval: ApprovalRecord }
  | { kind: 'approval_decided'; approvalId: string; status: 'approved' | 'rejected' | 'expired'; fingerprint: string }
  | { kind: 'executed'; node: string; objectRef: string; output?: Record<string, unknown> }
  | { kind: 'execute_failed'; node: string; error: string; outcomeKnown: boolean }
  | { kind: 'verified'; node: string; evidence: ExecutionEvidence | null; objectRef: string }
  | { kind: 'event'; name: string; payload?: Record<string, unknown> }
  | { kind: 'timeout'; node: string }
  | { kind: 'user_input'; node: string; output: Record<string, unknown> }

/** CONDITION predicates are declared code, keyed by node id. The model never chooses a branch label. */
export type ConditionTable = Record<string, (ctx: Record<string, unknown>) => string>

export type Clock = () => string

export function createRun(def: ProcedureDefinition, runId: string, inputs: Record<string, unknown>, now: Clock): ProcedureRun {
  const missing = def.inputs.filter(k => inputs[k] === undefined || inputs[k] === null || inputs[k] === '')
  const start = def.nodes.find(n => n.type === 'START')!
  const run: ProcedureRun = { procedureId: def.id, procedureVersion: def.version, runId, status: 'running', current: start.id, context: { ...inputs }, attempts: {}, loops: {}, approvals: {}, trace: [], error: null, uncertain: [] }
  if (missing.length) return fail(def, run, `missing_inputs:${missing.join(',')}`, now)
  return run
}

const node = (def: ProcedureDefinition, id: string) => { const n = def.nodes.find(x => x.id === id); if (!n) throw new Error(`procedure_node_missing:${id}`); return n }

function next(def: ProcedureDefinition, run: ProcedureRun, when: string): ProcedureRun {
  const out = def.edges.filter(e => e.from === run.current)
  const edge = out.find(e => e.when === when) || out.find(e => !e.when)
  if (!edge) return { ...run, status: 'failed', error: `no_edge:${run.current}:${when}` }
  const key = `${edge.from}→${edge.to}`
  const loops = { ...run.loops }
  if (edge.loop) { loops[key] = (loops[key] || 0) + 1; if (loops[key] > edge.loop.maxIterations) return { ...run, loops, status: 'escalated', current: edge.to, error: `loop_budget:${key}` } }
  return settle(def, { ...run, loops, current: edge.to })
}

/** Terminal and waiting nodes set status when entered. */
function settle(def: ProcedureDefinition, run: ProcedureRun): ProcedureRun {
  const n = node(def, run.current)
  if (n.type === 'COMPLETE') return { ...run, status: 'completed' }
  if (n.type === 'FAIL') return { ...run, status: 'failed', error: run.error || 'procedure_failed' }
  if (n.type === 'ESCALATE') return { ...run, status: 'escalated' }
  if (n.type === 'WAIT_EVENT') return { ...run, status: 'waiting_event' }
  if (n.type === 'APPROVAL') return { ...run, status: 'running' }
  return { ...run, status: 'running' }
}

function fail(def: ProcedureDefinition, run: ProcedureRun, error: string, now: Clock): ProcedureRun {
  const failNode = def.nodes.find(n => n.type === 'FAIL')
  return { ...run, status: 'failed', error, current: failNode?.id || run.current, trace: [...run.trace, { at: now(), node: run.current, type: node(def, run.current).type, outcome: 'fail', detail: error }] }
}

const withTrace = (run: ProcedureRun, e: TraceEntry): ProcedureRun => ({ ...run, trace: [...run.trace, e] })
const RETRYABLE = new Set(['READ', 'PARALLEL_READ', 'VERIFY'])

export function approvalFingerprint(def: ProcedureDefinition, n: ProcedureNode, ctx: Record<string, unknown>): string {
  const target = n.produces?.[0] || n.id
  return `${def.id}@${def.version}:${n.approval?.actionType || n.id}:${target}:${JSON.stringify(ctx[`${n.id}.binding`] ?? null)}`
}

/** Which node ids the interpreter expects the adapter to act on next, and how. */
export function expected(def: ProcedureDefinition, run: ProcedureRun): { node: ProcedureNode; action: 'read' | 'reason' | 'decide' | 'condition' | 'approval' | 'execute' | 'verify' | 'wait' | 'none' } {
  const n = node(def, run.current)
  if (run.status !== 'running') return { node: n, action: n.type === 'WAIT_EVENT' ? 'wait' : 'none' }
  switch (n.type) {
    case 'START': return { node: n, action: 'none' }
    case 'READ': case 'PARALLEL_READ': return { node: n, action: 'read' }
    case 'REASON': return { node: n, action: 'reason' }
    case 'DECIDE': return { node: n, action: 'decide' }
    case 'CONDITION': return { node: n, action: 'condition' }
    case 'APPROVAL': return { node: n, action: 'approval' }
    case 'EXECUTE': return { node: n, action: 'execute' }
    case 'VERIFY': return { node: n, action: 'verify' }
    default: return { node: n, action: 'none' }
  }
}

/** Approval the current EXECUTE depends on: the nearest APPROVAL node on the path (declared via requires: ['approval:<nodeId>'] or the single APPROVAL in the graph). */
function approvalFor(def: ProcedureDefinition, n: ProcedureNode, run: ProcedureRun): ApprovalRecord | null {
  const ref = (n.requires || []).find(r => r.startsWith('approval:'))?.slice('approval:'.length)
  const id = ref || def.nodes.filter(x => x.type === 'APPROVAL').map(x => x.id).find(x => run.approvals[x])
  return id ? run.approvals[id] || null : null
}

export function advance(def: ProcedureDefinition, run: ProcedureRun, ev: RunEvent, now: Clock, conditions: ConditionTable = {}): ProcedureRun {
  if (run.status === 'completed' || run.status === 'failed') return run
  const n = node(def, run.current)
  const at = now()

  // Events that do not depend on the current node
  if (ev.kind === 'approval_decided') {
    const entry = Object.entries(run.approvals).find(([, a]) => a.id === ev.approvalId)
    if (!entry) return run
    const [nodeId, a] = entry
    if (a.fingerprint !== ev.fingerprint) return fail(def, withTrace(run, { at, node: nodeId, type: 'APPROVAL', outcome: 'binding_mismatch' }), 'approval_binding_mismatch', now)
    const approvals = { ...run.approvals, [nodeId]: { ...a, status: ev.status } }
    const r = withTrace({ ...run, approvals, status: 'running' }, { at, node: nodeId, type: 'APPROVAL', outcome: ev.status, evidenceClass: 'verified' })
    if (run.current !== nodeId) return r // decided out of band; the EXECUTE guard will read it
    return next(def, r, ev.status)
  }
  if (ev.kind === 'event') {
    if (n.type !== 'WAIT_EVENT' || n.event !== ev.name) return run
    return next(def, withTrace({ ...run, status: 'running', context: { ...run.context, ...(ev.payload || {}) } }, { at, node: n.id, type: n.type, outcome: 'event', detail: ev.name }), 'ok')
  }
  if (ev.kind === 'timeout') {
    if (ev.node !== n.id) return run
    const r = withTrace(run, { at, node: n.id, type: n.type, outcome: 'timeout' })
    if (n.type === 'APPROVAL') { const a = run.approvals[n.id]; return next(def, { ...r, approvals: a ? { ...r.approvals, [n.id]: { ...a, status: 'expired' } } : r.approvals }, 'expired') }
    return next(def, { ...r, status: 'running' }, 'timeout')
  }
  if (ev.kind === 'user_input') {
    if (ev.node !== n.id || run.status !== 'waiting_user') return run
    return next(def, withTrace({ ...run, status: 'running', context: { ...run.context, ...ev.output } }, { at, node: n.id, type: n.type, outcome: 'user_input', evidenceClass: 'reported' }), 'ok')
  }

  if (ev.kind === 'start') {
    if (n.type !== 'START') return run
    return next(def, withTrace(run, { at, node: n.id, type: 'START', outcome: 'ok' }), 'ok')
  }
  if ('node' in ev && ev.node !== n.id) return run // stale event for another node: ignored, never applied

  switch (n.type) {
    case 'READ': case 'PARALLEL_READ': {
      if (ev.kind === 'read_ok') {
        const missing = (n.produces || []).filter(k => ev.output[k] === undefined)
        if (missing.length) return retryOrFail(def, run, n, `read_incomplete:${missing.join(',')}`, now)
        return next(def, withTrace({ ...run, context: { ...run.context, ...ev.output } }, { at, node: n.id, type: n.type, outcome: 'ok', evidenceClass: 'verified' }), 'ok')
      }
      if (ev.kind === 'read_failed') return retryOrFail(def, run, n, ev.error, now)
      return run
    }
    case 'REASON': case 'DECIDE': {
      if (ev.kind !== 'reasoned') return run
      // The model's output may fill declared keys only; anything else is dropped so it cannot smuggle a branch or a target.
      const allowed = new Set(n.produces || [])
      const output = Object.fromEntries(Object.entries(ev.output).filter(([k]) => allowed.has(k)))
      const missing = [...allowed].filter(k => output[k] === undefined)
      if (missing.length) return retryOrFail(def, run, n, `reason_incomplete:${missing.join(',')}`, now)
      return next(def, withTrace({ ...run, context: { ...run.context, ...output } }, { at, node: n.id, type: n.type, outcome: 'ok', evidenceClass: 'inferred' }), 'ok')
    }
    case 'APPROVAL': {
      if (ev.kind !== 'approval_created') return run
      if (ev.approval.actionType !== n.approval?.actionType) return fail(def, run, 'approval_action_type_mismatch', now)
      const fp = approvalFingerprint(def, n, run.context)
      if (ev.approval.fingerprint !== fp) return fail(def, run, 'approval_binding_mismatch', now)
      return withTrace({ ...run, status: 'waiting_approval', approvals: { ...run.approvals, [n.id]: { ...ev.approval, status: 'pending' } } }, { at, node: n.id, type: n.type, outcome: 'created' })
    }
    case 'EXECUTE': {
      if (ev.kind === 'executed') {
        const r = withTrace({ ...run, context: { ...run.context, [`${n.id}.objectRef`]: ev.objectRef, ...(ev.output || {}) } }, { at, node: n.id, type: n.type, outcome: 'executed', evidenceClass: 'reported', detail: ev.objectRef })
        return next(def, r, 'ok')
      }
      if (ev.kind === 'execute_failed') {
        if (!ev.outcomeKnown) {
          // Never replay an uncertain write. Mark and escalate.
          const r = withTrace({ ...run, uncertain: [...run.uncertain, n.id], error: `outcome_unknown:${ev.error}` }, { at, node: n.id, type: n.type, outcome: 'outcome_unknown', detail: ev.error })
          return next(def, r, 'unknown')
        }
        return fail(def, withTrace(run, { at, node: n.id, type: n.type, outcome: 'failed', detail: ev.error }), ev.error, now)
      }
      return run
    }
    case 'VERIFY': {
      if (ev.kind !== 'verified') return run
      const exec = def.edges.filter(e => e.to === n.id).map(e => node(def, e.from)).find(x => x.type === 'EXECUTE')
      const defaultHandler = exec?.capability === 'email' ? 'gmail-send' : exec?.capability === 'calendar' ? 'calendar-create' : exec?.capability === 'travel' ? 'book' : exec?.capability === 'merchant' ? 'merchant-submit' : 'browser-submit'
      const handler = String(run.context[`${exec?.id}.handler`] || defaultHandler)
      const expectedRef = String(run.context[`${exec?.id}.objectRef`] || '')
      const ok = exec?.capability === 'merchant'
        ? !!ev.evidence && ev.evidence.verified === true && ev.evidence.objectRef === expectedRef && ev.evidence.objectRef === ev.objectRef && !!ev.evidence.providerRef
        : hasExecutionEvidence(handler, expectedRef, ev.evidence || undefined) === true && ev.objectRef === expectedRef
      if (ok) return next(def, withTrace({ ...run, context: { ...run.context, [`${n.id}.verified`]: true } }, { at, node: n.id, type: n.type, outcome: 'verified', evidenceClass: 'verified', detail: ev.evidence?.providerRef }), 'verified')
      const r = withTrace(run, { at, node: n.id, type: n.type, outcome: 'unverified', evidenceClass: 'inferred' })
      const budget = n.retry?.max ?? 0
      const tries = (run.attempts[n.id] || 0) + 1
      if (tries <= budget) return { ...r, attempts: { ...r.attempts, [n.id]: tries } }
      return next(def, { ...r, attempts: { ...r.attempts, [n.id]: tries } }, 'unverified')
    }
    default: return run
  }
}

/** The adapter asks this before acting on an EXECUTE: it is the policy gate, not the model. */
export function executeGuard(def: ProcedureDefinition, run: ProcedureRun, nowIso: string): { ok: true; approval: ApprovalRecord | null } | { ok: false; reason: string } {
  const n = node(def, run.current)
  if (n.type !== 'EXECUTE') return { ok: false, reason: 'not_execute' }
  if (run.uncertain.includes(n.id)) return { ok: false, reason: 'outcome_unknown_never_replay' }
  const consequential = def.consequential || /payments|merchant|email|travel|browser|calendar/.test(n.capability || '')
  const a = approvalFor(def, n, run)
  if (consequential) {
    if (!a) return { ok: false, reason: 'approval_missing' }
    if (a.status !== 'approved') return { ok: false, reason: `approval_${a.status}` }
    if (Date.parse(a.expiresAt) <= Date.parse(nowIso)) return { ok: false, reason: 'approval_expired' }
    if (!a.fingerprint.startsWith(`${def.id}@${def.version}:`)) return { ok: false, reason: 'approval_binding_mismatch' }
  }
  return { ok: true, approval: a }
}

/** Evaluate a CONDITION with the procedure's own predicate table and move. */
export function evaluateCondition(def: ProcedureDefinition, run: ProcedureRun, conditions: ConditionTable, now: Clock): ProcedureRun {
  const n = node(def, run.current)
  if (n.type !== 'CONDITION' || run.status !== 'running') return run
  const fn = conditions[n.id]
  if (!fn) return fail(def, run, `condition_undefined:${n.id}`, now)
  let label: string
  try { label = String(fn(run.context)) } catch (e) { return fail(def, run, `condition_threw:${(e as Error).message}`, now) }
  const legal = new Set(def.edges.filter(e => e.from === n.id).map(e => e.when || 'ok'))
  if (!legal.has(label)) return fail(def, run, `condition_label_illegal:${label}`, now)
  return next(def, withTrace(run, { at: now(), node: n.id, type: n.type, outcome: label }), label)
}

function retryOrFail(def: ProcedureDefinition, run: ProcedureRun, n: ProcedureNode, error: string, now: Clock): ProcedureRun {
  const tries = (run.attempts[n.id] || 0) + 1
  const budget = RETRYABLE.has(n.type) ? (n.retry?.max ?? 2) : 0
  const r = withTrace({ ...run, attempts: { ...run.attempts, [n.id]: tries } }, { at: now(), node: n.id, type: n.type, outcome: tries <= budget ? 'retry' : 'failed', detail: error })
  if (tries <= budget) return r
  const hasFailEdge = def.edges.some(e => e.from === n.id && e.when === 'fail')
  return hasFailEdge ? next(def, { ...r, error }, 'fail') : fail(def, r, error, now)
}

/** Minutes until the next retry for the current node, from its declared backoff (default 2, 10, 30). */
export function retryDelayMinutes(n: ProcedureNode, attempt: number): number {
  const b = n.retry?.backoffMinutes?.length ? n.retry.backoffMinutes : [2, 10, 30]
  return b[Math.min(attempt, b.length) - 1] ?? b[b.length - 1]
}
