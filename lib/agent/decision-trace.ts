// Same Brain 3.0 Phase 4: the decision trace. Additive to decision-learning.ts (schema same-brain-v2 untouched):
// every procedure run writes a `decision_trace` activity row (schema same-brain-v3) linking decision id, procedure run,
// context pack and the evidence class of each outcome. Only `verified` outcomes may become a v2 verified_success; a
// reported or inferred outcome is recorded as 'success' at best, which rankEvidence already refuses to count toward
// calibrated live-routing confidence. Learning never changes what is permitted: canLearningOverrideSafety() stays false.
import type { AgentActor } from './actor'
import type { EvidenceClass } from '@/lib/semantic/types'
import type { TraceEntry } from '@/lib/procedures/engine'
import type { DecisionOutcome } from './decision-learning'

export const DECISION_TRACE_SCHEMA = 'same-brain-v3'

export type DecisionTrace = {
  schema: typeof DECISION_TRACE_SCHEMA
  decision_id: string
  procedure_id: string | null
  procedure_version: number | null
  procedure_run_id: string | null
  context_pack_ref: string | null
  objective_kind: string | null
  /** The evidence class of the final outcome: the weakest class among the steps that produced it. */
  evidence_class: EvidenceClass
  outcome: 'completed' | 'escalated' | 'failed' | 'waiting'
  steps: { node: string; type: string; outcome: string; evidence_class: EvidenceClass | null }[]
  recorded_at: string
}

const RANK: Record<EvidenceClass, number> = { verified: 3, reported: 2, inferred: 1 }

/** Weakest evidence class on the path that produced the outcome; a run with no evidence is 'inferred'. */
export function evidenceClassOfRun(trace: TraceEntry[]): EvidenceClass {
  const classes = trace.map(t => t.evidenceClass).filter((c): c is EvidenceClass => !!c)
  if (!classes.length) return 'inferred'
  // Only EXECUTE/VERIFY/READ outcomes decide; a REASON step is inferred by nature and would otherwise drag everything down.
  const decisive = trace.filter(t => t.type !== 'REASON' && t.type !== 'DECIDE' && t.type !== 'CONDITION' && t.evidenceClass).map(t => t.evidenceClass as EvidenceClass)
  const pool = decisive.length ? decisive : classes
  return pool.reduce((w, c) => (RANK[c] < RANK[w] ? c : w), 'verified' as EvidenceClass)
}

export function buildDecisionTrace(p: { decisionId: string; procedureId?: string | null; procedureVersion?: number | null; procedureRunId?: string | null; contextPackRef?: string | null; objectiveKind?: string | null; status: 'completed' | 'escalated' | 'failed' | 'running' | 'waiting_approval' | 'waiting_event' | 'waiting_user'; trace: TraceEntry[]; now?: string }): DecisionTrace {
  const outcome = p.status === 'completed' || p.status === 'escalated' || p.status === 'failed' ? p.status : 'waiting'
  return {
    schema: DECISION_TRACE_SCHEMA,
    decision_id: String(p.decisionId).slice(0, 180),
    procedure_id: p.procedureId || null, procedure_version: p.procedureVersion ?? null, procedure_run_id: p.procedureRunId || null,
    context_pack_ref: p.contextPackRef || null, objective_kind: p.objectiveKind || null,
    evidence_class: evidenceClassOfRun(p.trace),
    outcome,
    steps: p.trace.slice(-60).map(t => ({ node: t.node, type: t.type, outcome: t.outcome, evidence_class: t.evidenceClass || null })),
    recorded_at: p.now || new Date().toISOString(),
  }
}

/**
 * What the v2 learner may be told about this run. Verified + completed → verified_success (and only then does the
 * caller pass `verified: true` with the provider evidence). Reported/inferred completion → 'success' (unverified: never
 * raises calibrated confidence). Escalated/failed map to their own outcomes. 'waiting' teaches nothing.
 */
export function learningSignalFrom(trace: DecisionTrace): { outcome: DecisionOutcome; verified: boolean } | null {
  if (trace.outcome === 'waiting') return null
  if (trace.outcome === 'failed') return { outcome: 'failed', verified: false }
  if (trace.outcome === 'escalated') return { outcome: 'unknown', verified: false }
  if (trace.evidence_class === 'verified') return { outcome: 'verified_success', verified: true }
  return { outcome: 'success', verified: false }
}

export async function recordDecisionTrace(actor: Pick<AgentActor, 'legacyTelegramId'>, trace: DecisionTrace): Promise<void> {
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: String(actor.legacyTelegramId), run_id: trace.procedure_run_id, event_type: 'decision_trace',
    message: `Same Brain v3: ${trace.procedure_id || 'turn'} / ${trace.outcome} / ${trace.evidence_class}`, metadata_json: trace,
  })
  if (error) throw new Error('decision_trace_write_failed')
}
