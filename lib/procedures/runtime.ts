// Same Brain 3.0 Phase 3, live path. A procedure runs as an ordinary autonomous run: compile.ts turns the graph into
// agent_steps, and the handlers here drive the pure interpreter (engine.ts) one node per step, persisting the
// interpreter state in agent_runs.metadata_json.procedure.state with a sequence fence. The runtime keeps leases,
// retries, approvals, outcome reconciliation and the owner notice; nothing here duplicates that.
//
// Guarantees (tests: scripts/verify-procedures-runtime-nov9.mts):
//   - An EXECUTE step first stages the approval row (bound with buildApprovalBinding to this run, step and action) and
//     returns waiting_approval; it performs the write only when the runtime re-dispatches it with approvalGrantedId,
//     and engine.executeGuard agrees (approved, unexpired, same procedure/version).
//   - A write whose outcome is unknown is recorded as such and the step is blocked: never retried, never replayed.
//   - VERIFY is a separate step; it completes only on provider evidence that the engine accepts.
//   - The model (via io.reason) fills declared keys only; branches come from the registered predicate table.
import type { AgentActor } from '@/lib/agent/actor'
import type { AutonomousToolContext, AutonomousToolRegistry, AutonomousToolResult } from '@/lib/agent/autonomous-runtime'
import type { ExecutionEvidence } from '@/lib/agent/execution-evidence'
import { advance, approvalFingerprint, createRun, evaluateCondition, executeGuard, expected, type ApprovalRecord, type ProcedureRun, type RunEvent } from './engine'
import { compileToPlan } from './compile'
import { defaultRegistry, proceduresEnabledFor, type ProcedureRegistry } from './registry'
import type { ProcedureDefinition, ProcedureNode } from './schema'

export const PROCEDURE_APPROVAL_TTL_MS = 30 * 60_000

/** Provider access the handlers need. Production implementation: ./io.ts. Tests inject fakes. */
export type ProcedureIO = {
  read(args: { actor: AgentActor; def: ProcedureDefinition; node: ProcedureNode; context: Record<string, unknown> }): Promise<Record<string, unknown>>
  reason(args: { actor: AgentActor; def: ProcedureDefinition; node: ProcedureNode; context: Record<string, unknown>; objective: string }): Promise<Record<string, unknown>>
  /** Rows for the approval card. */
  preview(args: { def: ProcedureDefinition; node: ProcedureNode; context: Record<string, unknown> }): { label: string; value: string }[]
  /** Perform the write. Throw ProcedureExecuteError with outcomeKnown=false when the provider may have acted. */
  execute(args: { actor: AgentActor; def: ProcedureDefinition; node: ProcedureNode; context: Record<string, unknown>; idempotencyKey: string }): Promise<{ objectRef: string; output?: Record<string, unknown> }>
  verify(args: { actor: AgentActor; def: ProcedureDefinition; node: ProcedureNode; context: Record<string, unknown>; objectRef: string }): Promise<ExecutionEvidence | null>
  /** WAIT_EVENT poll: payload when the event has happened, null to keep waiting. */
  waitEvent(args: { actor: AgentActor; def: ProcedureDefinition; node: ProcedureNode; context: Record<string, unknown> }): Promise<Record<string, unknown> | null>
}
export class ProcedureExecuteError extends Error { constructor(message: string, readonly outcomeKnown: boolean) { super(message) } }

export type ProcedureStore = {
  loadState(runId: string, telegramId: string): Promise<{ state: ProcedureRun; seq: number } | null>
  saveState(runId: string, telegramId: string, state: ProcedureRun, seq: number): Promise<boolean>
  stageApproval(args: { telegramId: string; runId: string; step: AutonomousToolContext['step']; node: ProcedureNode; def: ProcedureDefinition; preview: { label: string; value: string }[]; expiresAt: string; fingerprint: string }): Promise<{ id: string }>
  approvalStatus(telegramId: string, runId: string, approvalId: string): Promise<'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed' | null>
  recordTrace(actor: AgentActor, state: ProcedureRun, def: ProcedureDefinition, runId: string): Promise<void>
}

const terminal = (s: ProcedureRun) => s.status === 'completed' || s.status === 'failed' || s.status === 'escalated'
const nowIso = () => new Date().toISOString()

/** Handlers for one procedure definition. Tool names match compile.ts. */
export function procedureRegistryFor(def: ProcedureDefinition, io: ProcedureIO, store: ProcedureStore, registry: ProcedureRegistry = defaultRegistry()): AutonomousToolRegistry {
  const conditions = registry.conditionsFor(def)
  const node = (id: string) => { const n = def.nodes.find(x => x.id === id); if (!n) throw new Error(`procedure_node_missing:${id}`); return n }

  const handler = async (ctx: AutonomousToolContext): Promise<AutonomousToolResult> => {
    const telegramId = String(ctx.actor.legacyTelegramId)
    const loaded = await store.loadState(ctx.runId, telegramId)
    if (!loaded) return { status: 'blocked', error: 'procedure_state_missing' }
    let { state, seq } = loaded
    const n = node(ctx.runtime.stepKey)
    const persist = async (next: ProcedureRun) => { const ok = await store.saveState(ctx.runId, telegramId, next, seq); if (!ok) throw new Error('procedure_state_superseded'); state = next; seq++; if (terminal(next)) await store.recordTrace(ctx.actor, next, def, ctx.runId).catch(e => console.error('PROCEDURE_TRACE_FAILED:', String(e?.message || e).slice(0, 120))) }
    const apply = (ev: RunEvent) => { let s = advance(def, state, ev, nowIso); while (s.status === 'running' && expected(def, s).action === 'condition') s = evaluateCondition(def, s, conditions, nowIso); return s }

    // START is implicit: the first dispatched node moves the interpreter off START.
    if (state.current === def.nodes.find(x => x.type === 'START')!.id && state.status === 'running') { const s = apply({ kind: 'start' }); await persist(s) }
    if (terminal(state)) return { status: 'completed', output: { skipped: true, reason: `procedure_${state.status}` } }
    // The EXECUTE step also covers its folded APPROVAL node.
    const covers = (id: string) => id === n.id || (n.type === 'EXECUTE' && def.edges.some(e => e.to === n.id && e.from === id && node(id).type === 'APPROVAL'))
    if (!covers(state.current)) return { status: 'completed', output: { skipped: true, reason: 'not_on_taken_path', current: state.current } }

    const cur = node(state.current)
    switch (cur.type) {
      case 'READ': case 'PARALLEL_READ': {
        try {
          const out = await io.read({ actor: ctx.actor, def, node: cur, context: state.context })
          const s = apply({ kind: 'read_ok', node: cur.id, output: out })
          await persist(s)
          if (s.current === cur.id && s.status === 'running') return { status: 'retryable_failure', error: 'read_incomplete' }
          return { status: 'completed', verified: true, output: { produced: Object.keys(out).slice(0, 20) } }
        } catch (e: any) {
          const msg = String(e?.message || e).slice(0, 200)
          const s = apply({ kind: 'read_failed', node: cur.id, error: msg, final: readFailureIsFinal(msg) })
          await persist(s)
          if (s.current === cur.id && s.status === 'running') return { status: 'retryable_failure', error: String(e?.message || e).slice(0, 300) }
          // the graph has a fail edge for this read: the step itself is done, the procedure moved on
          return s.status === 'failed' ? { status: 'blocked', error: String(e?.message || e).slice(0, 300) } : { status: 'completed', output: { readFailed: true } }
        }
      }
      case 'REASON': case 'DECIDE': {
        const out = await io.reason({ actor: ctx.actor, def, node: cur, context: state.context, objective: ctx.objective })
        const s = apply({ kind: 'reasoned', node: cur.id, output: out })
        await persist(s)
        if (s.current === cur.id && s.status === 'running') return { status: 'retryable_failure', error: 'reason_incomplete' }
        if (s.status === 'failed') return { status: 'blocked', error: s.error || 'reason_failed' }
        return { status: 'completed', verified: true, output: { produced: Object.keys(out).filter(k => (cur.produces || []).includes(k)) } }
      }
      case 'CONDITION': { const s = evaluateCondition(def, state, conditions, nowIso); await persist(s); return s.status === 'failed' ? { status: 'blocked', error: s.error || 'condition_failed' } : { status: 'completed', verified: true, output: { branch: s.current } } }
      case 'WAIT_EVENT': {
        const payload = await io.waitEvent({ actor: ctx.actor, def, node: cur, context: state.context })
        if (!payload) return { status: 'retryable_failure', error: `waiting_event:${cur.event}` }
        const s = apply({ kind: 'event', name: cur.event!, payload }); await persist(s)
        return { status: 'completed', verified: true, output: { event: cur.event } }
      }
      case 'ESCALATE': return { status: 'waiting_user', reason: 'handback', note: state.error || 'Gogo needs you to take this over.' }
      case 'APPROVAL': {
        const existing = state.approvals[cur.id]
        if (!existing) {
          const fingerprint = approvalFingerprint(def, cur, state.context)
          const expiresAt = new Date(Date.now() + PROCEDURE_APPROVAL_TTL_MS).toISOString()
          const row = await store.stageApproval({ telegramId, runId: ctx.runId, step: ctx.step, node: cur, def, preview: io.preview({ def, node: cur, context: state.context }), expiresAt, fingerprint })
          const s = apply({ kind: 'approval_created', node: cur.id, approval: { id: row.id, actionType: cur.approval!.actionType, fingerprint, status: 'pending', expiresAt } })
          await persist(s)
          if (s.status === 'failed') return { status: 'blocked', error: s.error || 'approval_binding_failed' }
          return { status: 'waiting_approval', approvalId: row.id }
        }
        // Re-dispatched: the runtime only does this after the owner's decision was released onto the step.
        const status = await store.approvalStatus(telegramId, ctx.runId, existing.id)
        if (status === 'approved' && ctx.runtime.approvalGrantedId === existing.id) {
          const s = apply({ kind: 'approval_decided', approvalId: existing.id, status: 'approved', fingerprint: existing.fingerprint }); await persist(s)
          return runExecute(s)
        }
        if (status === 'rejected' || status === 'expired') { const s = apply({ kind: 'approval_decided', approvalId: existing.id, status, fingerprint: existing.fingerprint }); await persist(s); return { status: 'completed', output: { approval: status } } }
        return { status: 'waiting_approval', approvalId: existing.id }
      }
      case 'EXECUTE': return runExecute(state)
      case 'VERIFY': {
        const exec = def.edges.filter(e => e.to === cur.id).map(e => node(e.from)).find(x => x.type === 'EXECUTE')!
        const objectRef = String(state.context[`${exec.id}.objectRef`] || '')
        const evidence = await io.verify({ actor: ctx.actor, def, node: cur, context: state.context, objectRef }).catch(() => null)
        const s = apply({ kind: 'verified', node: cur.id, evidence, objectRef }); await persist(s)
        if (s.context[`${cur.id}.verified`] === true) return { status: 'completed', verified: true, output: { providerRef: evidence?.providerRef || null } }
        if (s.current === cur.id && s.status === 'running') return { status: 'retryable_failure', error: 'verification_pending' }
        return { status: 'blocked', error: 'verification_unconfirmed' }
      }
      default: return { status: 'blocked', error: `procedure_node_unsupported:${cur.type}` }
    }

    async function runExecute(s0: ProcedureRun): Promise<AutonomousToolResult> {
      const n2 = node(s0.current)
      if (n2.type === 'APPROVAL') return { status: 'waiting_approval', approvalId: s0.approvals[n2.id]?.id || '' }
      const guard = executeGuard(def, s0, nowIso())
      if (guard.ok === false) { const reason = guard.reason; return reason === 'approval_pending' ? { status: 'waiting_approval', approvalId: Object.values(s0.approvals).find(a => a.status === 'pending')?.id || '' } : { status: 'blocked', error: `execute_refused:${reason}` } }
      if (guard.approval && ctx.runtime.approvalGrantedId !== guard.approval.id) return { status: 'blocked', error: 'execute_refused:approval_not_released_to_step' }
      try {
        const r = await io.execute({ actor: ctx.actor, def, node: n2, context: s0.context, idempotencyKey: ctx.idempotencyKey })
        const s = advance(def, s0, { kind: 'executed', node: n2.id, objectRef: r.objectRef, output: r.output }, nowIso); await persist(s)
        return { status: 'completed', verified: false, output: { objectRef: r.objectRef } }
      } catch (e: any) {
        const known = e instanceof ProcedureExecuteError ? e.outcomeKnown : false
        const s = advance(def, s0, { kind: 'execute_failed', node: n2.id, error: String(e?.message || e).slice(0, 200), outcomeKnown: known }, nowIso); await persist(s)
        return { status: 'blocked', error: known ? String(e?.message || e).slice(0, 300) : `outcome_unknown:${String(e?.message || e).slice(0, 200)}` }
      }
    }
  }
  const names = ['read', 'parallel_read', 'reason', 'decide', 'condition', 'wait_event', 'escalate', 'execute', 'verify']
  return Object.fromEntries(names.map(k => [`procedure.${k}`, handler]))
}

/** Production store over agent_runs / agent_approvals / agent_activity. */
/** A read failure that a retry cannot change: no such thread, several matches, Gmail not connected or not consented.
 *  Retrying these only hides the answer from the owner for minutes. Network and provider errors still retry. */
export function readFailureIsFinal(error: string): boolean {
  return /^(?:thread_not_found|thread_ambiguous|gmail_not_connected|gmail_consent_missing|gmail_owner_invalid)\b/.test(String(error || ''))
}

export async function supabaseProcedureStore(): Promise<ProcedureStore> {
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { buildApprovalBinding } = await import('@/lib/agent/approval-binding')
  const { autonomousStepApprovalInput } = await import('@/lib/agent/autonomous-runtime')
  const { buildDecisionTrace, recordDecisionTrace } = await import('@/lib/agent/decision-trace')
  return {
    async loadState(runId, telegramId) {
      const { data } = await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id', runId).eq('telegram_id', telegramId).maybeSingle()
      const p = (data?.metadata_json as any)?.procedure
      return p?.state ? { state: p.state as ProcedureRun, seq: Number(p.seq || 0) } : null
    },
    async saveState(runId, telegramId, state, seq) {
      const { data } = await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id', runId).eq('telegram_id', telegramId).maybeSingle()
      const meta = (data?.metadata_json as any) || {}
      if (Number(meta?.procedure?.seq || 0) !== seq) return false
      const next = { ...meta, procedure: { ...(meta.procedure || {}), state, seq: seq + 1 } }
      const { data: upd } = await supabaseAdmin.from('agent_runs').update({ metadata_json: next, updated_at: nowIso() }).eq('id', runId).eq('telegram_id', telegramId).eq('metadata_json->procedure->>seq', String(seq)).select('id')
      return Array.isArray(upd) && upd.length > 0
    },
    async stageApproval({ telegramId, runId, step, node, def, preview, expiresAt, fingerprint }) {
      const { data: run } = await supabaseAdmin.from('agent_runs').select('id,title,metadata_json').eq('id', runId).eq('telegram_id', telegramId).single()
      const input = autonomousStepApprovalInput(run as any, step as any, telegramId)
      const binding = buildApprovalBinding({ ...input, policyVersion: 'runtime-step-v1' })
      const { data, error } = await supabaseAdmin.from('agent_approvals').insert({
        telegram_id: telegramId, run_id: runId, action_type: node.approval!.actionType, title: node.approval!.title.slice(0, 160),
        description: `Procedure ${def.title} (${def.id} v${def.version}). Nothing runs without this yes; it expires ${new Date(expiresAt).toUTCString()}.`.slice(0, 500),
        payload_preview: preview.slice(0, 8), execution_payload: { plan_type: 'procedure', procedure: def.id, version: def.version, node: node.id, step_key: node.id, fingerprint, expires_at: expiresAt },
        risk_level: def.domain === 'payments' ? 'high' : 'medium', status: 'pending', ...binding,
      }).select('id').single()
      if (error || !data?.id) throw new Error(`procedure_approval_create_failed:${error?.message || 'unknown'}`)
      return { id: String(data.id) }
    },
    async approvalStatus(telegramId, runId, approvalId) {
      const { data } = await supabaseAdmin.from('agent_approvals').select('status').eq('id', approvalId).eq('telegram_id', telegramId).eq('run_id', runId).maybeSingle()
      return (data?.status as any) || null
    },
    async recordTrace(actor, state, def, runId) {
      await recordDecisionTrace(actor, buildDecisionTrace({ decisionId: `proc:${runId}`, procedureId: def.id, procedureVersion: def.version, procedureRunId: runId, status: state.status, trace: state.trace }))
    },
  }
}

/** Create and start a procedure run for a verified actor. Returns null when the flag is off for this owner. */
export async function startProcedureRun(params: { actor: AgentActor; procedureId: string; inputs: Record<string, unknown>; objective: string; source: string; io?: ProcedureIO; env?: Record<string, string | undefined> }) {
  const env = params.env || process.env
  if (!proceduresEnabledFor(String(params.actor.legacyTelegramId), env)) return null
  const registry = defaultRegistry()
  const def = registry.latest(params.procedureId)
  if (!def) throw new Error(`procedure_unknown:${params.procedureId}`)
  const { createAutonomousRun, executeAutonomousRun } = await import('@/lib/agent/autonomous-runtime')
  const plan = compileToPlan(def, params.inputs, params.objective)
  const { runId } = await createAutonomousRun({ actor: params.actor, source: params.source, plan })
  const state = createRun(def, runId, params.inputs, nowIso)
  const store = await supabaseProcedureStore()
  // seed the state (seq 0 → 1)
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { data } = await supabaseAdmin.from('agent_runs').select('metadata_json').eq('id', runId).eq('telegram_id', String(params.actor.legacyTelegramId)).single()
  const meta = (data?.metadata_json as any) || {}
  await supabaseAdmin.from('agent_runs').update({ metadata_json: { ...meta, procedure: { ...(meta.procedure || {}), state, seq: 1 } } }).eq('id', runId).eq('telegram_id', String(params.actor.legacyTelegramId))
  const io = params.io || (await import('./io')).productionIO
  const reg = procedureRegistryFor(def, io, store, registry)
  let last: Awaited<ReturnType<typeof executeAutonomousRun>> | null = null
  for (let wave = 0; wave < 12; wave++) {
    last = await executeAutonomousRun({ actor: params.actor, runId, registry: reg, maxParallel: 2, notifyOutcome: false })
    if (!last.executed || ['waiting_approval', 'paused', 'completed', 'failed', 'outcome_unknown'].includes(String(last.status))) break
  }
  const final = await store.loadState(runId, String(params.actor.legacyTelegramId)).catch(() => null)
  return { runId, status: last?.status || 'running', procedure: def.id, error: final?.state?.error ? String(final.state.error).slice(0, 120) : null }
}

/** Cron resume: continue a procedure run (approval released, retry due, event poll). Only for flagged owners. */
export async function resumeProcedureRun(params: { actor: AgentActor; runId: string; maxWaves?: number; env?: Record<string, string | undefined> }) {
  const env = params.env || process.env
  if (!proceduresEnabledFor(String(params.actor.legacyTelegramId), env)) return { runId: params.runId, status: 'skipped_flag_off', executed: 0 }
  const { loadAutonomousRun, executeAutonomousRun, recoverStaleAutonomousSteps } = await import('@/lib/agent/autonomous-runtime')
  const { run } = await loadAutonomousRun(params.runId, String(params.actor.legacyTelegramId))
  const reg = await procedureRegistryForRun(run?.metadata_json as any)
  if (!reg) throw new Error('not_procedure_run')
  await recoverStaleAutonomousSteps({ actor: params.actor, runId: params.runId }).catch(() => ({ recovered: 0 }))
  let last: Awaited<ReturnType<typeof executeAutonomousRun>> | null = null; let executed = 0
  for (let wave = 0; wave < (params.maxWaves || 6); wave++) {
    last = await executeAutonomousRun({ actor: params.actor, runId: params.runId, registry: reg, maxParallel: 2, notifyOutcome: true })
    executed += Number(last.executed || 0)
    if (!last.executed || ['waiting_approval', 'paused', 'completed', 'failed', 'outcome_unknown'].includes(String(last.status))) break
  }
  return { runId: params.runId, status: String(last?.status || 'running'), executed }
}

/** For the autonomous-runs cron: the registry for a run that carries procedure metadata, or null. */
export async function procedureRegistryForRun(meta: Record<string, unknown> | null | undefined): Promise<AutonomousToolRegistry | null> {
  const p = (meta as any)?.procedure
  if (!p?.id) return null
  const def = defaultRegistry().get(String(p.id), Number(p.version)) || defaultRegistry().latest(String(p.id))
  if (!def) return null
  const io = (await import('./io')).productionIO
  return procedureRegistryFor(def, io, await supabaseProcedureStore())
}

export type { ApprovalRecord }
