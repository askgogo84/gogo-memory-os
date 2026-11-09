// Durable adapter: a procedure graph becomes an AutonomousPlan for the existing runtime (agent_runs / agent_steps,
// leases, retries, approvals, verification, outcome_unknown). No second orchestrator. Mapping:
//   READ / PARALLEL_READ / REASON / DECIDE / CONDITION / WAIT_EVENT → one step each, tool `procedure.<type>`
//   APPROVAL + EXECUTE + VERIFY → one mutation step with requiresApproval, approvalAction and verificationRequired,
//     which is exactly how the runtime already binds an approval to a step and refuses completion without evidence
//   ESCALATE → a step the runtime marks waiting_user(handback); COMPLETE/FAIL are the run's own terminal statuses
// Branch structure is kept in the step metadata (`procedure.edges`) so the step handlers, which call engine.ts, know
// which successors to release; the runtime's DAG dependsOn carries the happy path.
import type { AutonomousPlan, AutonomousPlanStep } from '@/lib/agent/autonomous-runtime'
import type { ProcedureDefinition, ProcedureNode } from './schema'

export const PROCEDURE_PLAN_VERSION = 'procedure-plan-v1'

export function compileToPlan(def: ProcedureDefinition, inputs: Record<string, unknown>, objective: string): AutonomousPlan {
  const steps: AutonomousPlanStep[] = []
  const byId = new Map(def.nodes.map(n => [n.id, n]))
  const preds = (id: string) => def.edges.filter(e => e.to === id).map(e => e.from)
  // Nodes folded into an EXECUTE step: its APPROVAL predecessors and VERIFY successors.
  const folded = new Set<string>()
  const execFor = new Map<string, ProcedureNode>()
  for (const n of def.nodes) {
    if (n.type !== 'EXECUTE') continue
    for (const p of preds(n.id)) if (byId.get(p)?.type === 'APPROVAL') { folded.add(p); execFor.set(p, n) }
    for (const e of def.edges.filter(e => e.from === n.id)) if (byId.get(e.to)?.type === 'VERIFY') { folded.add(e.to); execFor.set(e.to, n) }
  }
  const stepKeyFor = (id: string): string | null => {
    const n = byId.get(id); if (!n) return null
    if (n.type === 'START' || n.type === 'COMPLETE' || n.type === 'FAIL') return null
    if (folded.has(id)) return execFor.get(id)!.id
    return id
  }
  const depsFor = (id: string): string[] => {
    const out = new Set<string>()
    const walk = (x: string, seen = new Set<string>()) => { for (const p of preds(x)) { if (seen.has(p)) continue; seen.add(p); const k = stepKeyFor(p); if (k && k !== id) out.add(k); else walk(p, seen) } }
    walk(id)
    return [...out]
  }
  for (const n of def.nodes) {
    if (n.type === 'START' || n.type === 'COMPLETE' || n.type === 'FAIL' || folded.has(n.id)) continue
    const base: AutonomousPlanStep = { key: n.id, title: n.title, toolName: `procedure.${n.type.toLowerCase()}`, dependsOn: depsFor(n.id), lane: n.type === 'PARALLEL_READ' ? `read:${n.id}` : 'default', maxAttempts: Math.max(1, (n.retry?.max ?? 0) + 1) }
    if (n.type === 'EXECUTE') {
      const approval = def.nodes.find(a => a.type === 'APPROVAL' && execFor.get(a.id)?.id === n.id)
      const verify = def.nodes.find(v => v.type === 'VERIFY' && execFor.get(v.id)?.id === n.id)
      steps.push({ ...base, toolName: 'procedure.execute', mutation: true, maxAttempts: 1, requiresApproval: true, verificationRequired: !!verify,
        approvalAction: { capability: n.capability || 'browser', actionType: approval?.approval?.actionType || `${def.id}.${n.id}`, target: String(inputs[def.inputs[0]] ?? n.id), payload: { procedure: def.id, version: def.version, node: n.id, inputs }, objectRef: null } })
      continue
    }
    steps.push(base)
  }
  return {
    objective,
    steps,
    metadata: { plan_kind: PROCEDURE_PLAN_VERSION, procedure: { id: def.id, version: def.version, inputs, edges: def.edges, folded: [...folded] } },
  }
}
