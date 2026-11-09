// The procedure registry: templates register only when validation passes, so an invalid graph is a startup error, not a
// runtime surprise. Versioned: `get(id, version)`; `latest(id)`. Feature flag GOGO_PROCEDURES (off by default).
import { validateProcedure, type ProcedureDefinition } from './schema'
import { CONDITIONS, TEMPLATES } from './templates'
import type { ConditionTable } from './engine'

export class ProcedureRegistry {
  private defs = new Map<string, ProcedureDefinition>()
  private conds = new Map<string, ConditionTable>()
  register(def: ProcedureDefinition, conditions: ConditionTable = {}) {
    const issues = validateProcedure(def)
    if (issues.length) throw new Error(`procedure_invalid:${def.id}@${def.version}:${issues.map(i => i.code + (i.node ? `(${i.node})` : '')).join(',')}`)
    const conditionNodes = def.nodes.filter(n => n.type === 'CONDITION').map(n => n.id)
    const missing = conditionNodes.filter(id => !conditions[id])
    if (missing.length) throw new Error(`procedure_conditions_missing:${def.id}:${missing.join(',')}`)
    const key = `${def.id}@${def.version}`
    if (this.defs.has(key)) throw new Error(`procedure_duplicate:${key}`)
    this.defs.set(key, def); this.conds.set(key, conditions)
    return this
  }
  get(id: string, version: number) { return this.defs.get(`${id}@${version}`) || null }
  latest(id: string) { return [...this.defs.values()].filter(d => d.id === id).sort((a, b) => b.version - a.version)[0] || null }
  conditionsFor(def: ProcedureDefinition) { return this.conds.get(`${def.id}@${def.version}`) || {} }
  list() { return [...this.defs.values()].map(d => ({ id: d.id, version: d.version, title: d.title, domain: d.domain, consequential: d.consequential })) }
}

let shared: ProcedureRegistry | null = null
export function defaultRegistry(): ProcedureRegistry {
  if (shared) return shared
  const r = new ProcedureRegistry()
  for (const t of TEMPLATES) r.register(t, CONDITIONS[t.id] || {})
  shared = r
  return r
}

export function proceduresEnabledFor(owner: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.GOGO_PROCEDURES === '1') return true
  return String(env.GOGO_PROCEDURES_OWNERS || '').split(',').map(s => s.trim()).filter(Boolean).includes(String(owner))
}
