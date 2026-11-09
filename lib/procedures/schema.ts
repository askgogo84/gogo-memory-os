// Same Brain 3.0 Phase 3: procedures are versioned graphs. The model may propose which procedure and may fill READ /
// REASON outputs; it cannot add an EXECUTE, skip an APPROVAL or declare a VERIFY passed. `validateProcedure` enforces
// the structural rules at load time, so a template that could bypass policy never registers.

export type NodeType = 'START' | 'READ' | 'REASON' | 'DECIDE' | 'CONDITION' | 'PARALLEL_READ' | 'APPROVAL' | 'EXECUTE' | 'VERIFY' | 'WAIT_EVENT' | 'ESCALATE' | 'COMPLETE' | 'FAIL'

export type ProcedureNode = {
  id: string
  type: NodeType
  title: string
  /** Capability from lib/agent/policy (calendar, email, travel, browser, payments, merchant…). Required on READ/EXECUTE/VERIFY. */
  capability?: string
  /** Context keys that must exist before the node runs. */
  requires?: string[]
  /** Context keys the node writes. */
  produces?: string[]
  /** APPROVAL: what the card will say and bind to. */
  approval?: { actionType: string; title: string }
  /** VERIFY: the trusted evidence source for the preceding EXECUTE. */
  verify?: { source: 'gmail' | 'google_calendar' | 'browser' | 'travel' | 'merchant' }
  retry?: { max: number; backoffMinutes: number[] }
  timeoutMs?: number
  /** WAIT_EVENT: the event name that resumes the run. */
  event?: string
}
export type ProcedureEdge = { from: string; to: string; when?: 'ok' | 'fail' | 'timeout' | 'approved' | 'rejected' | 'expired' | 'verified' | 'unverified' | 'unknown' | string; loop?: { maxIterations: number } }

export type ProcedureDefinition = {
  id: string
  version: number
  title: string
  domain: 'travel' | 'email' | 'calendar' | 'dining' | 'shopping' | 'documents' | 'meetings' | 'payments' | 'enterprise'
  /** What the procedure needs in context to start. */
  inputs: string[]
  nodes: ProcedureNode[]
  edges: ProcedureEdge[]
  /** Consequential procedures must contain at least one APPROVAL before every EXECUTE. */
  consequential: boolean
}

export type ValidationIssue = { code: string; node?: string; detail: string }

const CONSEQUENTIAL_CAP = /payments|merchant|email|travel|browser|calendar/

export function validateProcedure(def: ProcedureDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ids = new Set<string>()
  for (const n of def.nodes) { if (ids.has(n.id)) issues.push({ code: 'duplicate_node', node: n.id, detail: 'node id repeats' }); ids.add(n.id) }
  const byId = new Map(def.nodes.map(n => [n.id, n]))
  const starts = def.nodes.filter(n => n.type === 'START'); if (starts.length !== 1) issues.push({ code: 'start_count', detail: `expected 1 START, found ${starts.length}` })
  if (!def.nodes.some(n => n.type === 'COMPLETE')) issues.push({ code: 'no_complete', detail: 'no COMPLETE node' })
  if (!def.nodes.some(n => n.type === 'FAIL')) issues.push({ code: 'no_fail', detail: 'no FAIL node' })
  for (const e of def.edges) { if (!byId.has(e.from) || !byId.has(e.to)) issues.push({ code: 'dangling_edge', detail: `${e.from} → ${e.to}` }) }
  const out = (id: string) => def.edges.filter(e => e.from === id)
  const inc = (id: string) => def.edges.filter(e => e.to === id)
  // Reachability from START, and every node can reach COMPLETE or FAIL.
  const reach = (from: string, fwd: boolean) => { const seen = new Set<string>(); const stack = [from]; while (stack.length) { const x = stack.pop()!; if (seen.has(x)) continue; seen.add(x); for (const e of fwd ? out(x) : inc(x)) stack.push(fwd ? e.to : e.from) } return seen }
  if (starts[0]) { const r = reach(starts[0].id, true); for (const n of def.nodes) if (!r.has(n.id)) issues.push({ code: 'unreachable', node: n.id, detail: 'not reachable from START' }) }
  const terminalReach = new Set<string>(); for (const t of def.nodes.filter(n => n.type === 'COMPLETE' || n.type === 'FAIL')) for (const x of reach(t.id, false)) terminalReach.add(x)
  for (const n of def.nodes) if (!terminalReach.has(n.id)) issues.push({ code: 'no_terminal_path', node: n.id, detail: 'cannot reach COMPLETE or FAIL' })
  for (const n of def.nodes) {
    if ((n.type === 'READ' || n.type === 'EXECUTE' || n.type === 'VERIFY' || n.type === 'PARALLEL_READ') && !n.capability) issues.push({ code: 'capability_required', node: n.id, detail: `${n.type} needs a capability` })
    if (n.type === 'APPROVAL' && !n.approval) issues.push({ code: 'approval_shape', node: n.id, detail: 'APPROVAL needs actionType and title' })
    if (n.type === 'VERIFY' && !n.verify) issues.push({ code: 'verify_shape', node: n.id, detail: 'VERIFY needs a trusted source' })
    if (n.type === 'WAIT_EVENT' && !n.event) issues.push({ code: 'event_required', node: n.id, detail: 'WAIT_EVENT needs an event name' })
    if (n.type === 'EXECUTE') {
      // every path into an EXECUTE passes an APPROVAL (when consequential), and every EXECUTE is followed by a VERIFY
      const nexts = out(n.id).map(e => byId.get(e.to)!).filter(Boolean)
      if (!nexts.some(x => x.type === 'VERIFY')) issues.push({ code: 'execute_without_verify', node: n.id, detail: 'EXECUTE must lead to VERIFY' })
      if (def.consequential || CONSEQUENTIAL_CAP.test(n.capability || '')) {
        const back = reach(n.id, false); back.delete(n.id)
        // approval must dominate: remove APPROVAL nodes and check START no longer reaches EXECUTE
        const approvals = def.nodes.filter(x => x.type === 'APPROVAL').map(x => x.id)
        const seen = new Set<string>(); const stack = [starts[0]?.id].filter(Boolean) as string[]; let reaches = false
        while (stack.length) { const x = stack.pop()!; if (seen.has(x) || approvals.includes(x)) continue; seen.add(x); if (x === n.id) { reaches = true; break } for (const e of out(x)) stack.push(e.to) }
        if (reaches) issues.push({ code: 'execute_without_approval', node: n.id, detail: 'a path reaches EXECUTE without passing an APPROVAL' })
      }
    }
    if (n.type === 'VERIFY') { const prev = inc(n.id).map(e => byId.get(e.from)!); if (!prev.some(x => x && x.type === 'EXECUTE')) issues.push({ code: 'verify_without_execute', node: n.id, detail: 'VERIFY must follow an EXECUTE' }) }
  }
  // cycles only through edges that declare a loop bound
  const color = new Map<string, number>()
  const dfs = (x: string, path: string[]): void => { color.set(x, 1); for (const e of out(x)) { if (color.get(e.to) === 1 && !e.loop) issues.push({ code: 'unbounded_cycle', node: e.to, detail: `${[...path, x, e.to].join(' → ')}` }); if (!color.has(e.to)) dfs(e.to, [...path, x]) } color.set(x, 2) }
  if (starts[0]) dfs(starts[0].id, [])
  return issues
}
