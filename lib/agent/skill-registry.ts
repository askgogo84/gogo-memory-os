// Vetted, typed skill registry (8 Nov). A skill is a named SOP over capabilities that already exist in AskGogo:
// it declares its SOP version, what it takes and returns, how much it may do (steps/time/cost), which capabilities
// it needs, whether every consequential step needs an exact-action approval, and what provider evidence closes it.
//
// Boundaries, by construction:
//   - A skill is a wrapper around a function from a static map in this process. There is no way to register code
//     from data (no eval, no dynamic import by name, no URL): generated skill text cannot execute or grant itself anything.
//   - Running a skill never widens permissions: the caller's policy (lib/agent/policy) is evaluated per capability the
//     skill declares, and a skill that declares a capability it then tries to use outside the registry simply has no handle.
//   - Optional adapters (MCP, Apify, Firecrawl, Composio, alternative browsers) are names only, OFF unless listed in
//     GOGO_SKILL_ADAPTERS; a skill that requires one is not runnable while it is off. None bypass anti-bot or auth.
import type { AgentCapability, AgentExecutionPolicyInput, AgentPermissionLevel } from './policy'
import { evaluateAgentExecutionPolicy } from './policy'

export const SKILL_REGISTRY_VERSION = 'gogo-skills-v1'

/** A tiny structural schema: enough to refuse wrong-shaped input without a new dependency. */
export type FieldSchema =
  | { type: 'string'; required?: boolean; maxLength?: number; pattern?: RegExp; enum?: readonly string[] }
  | { type: 'number'; required?: boolean; min?: number; max?: number; integer?: boolean }
  | { type: 'boolean'; required?: boolean }
  | { type: 'string[]'; required?: boolean; maxItems?: number }
export type ObjectSchema = Record<string, FieldSchema>

export type SkillAdapter = 'mcp' | 'apify' | 'firecrawl' | 'composio' | 'alt_browser'
export type SkillEvidence = 'provider_readback' | 'message_id' | 'http_status' | 'ledger_row' | 'none'

export type SkillDefinition = {
  id: string
  /** Semantic version of the written procedure the code follows. Bump when the steps change, not when the code is refactored. */
  sopVersion: string
  title: string
  purpose: string
  input: ObjectSchema
  output: ObjectSchema
  limits: { maxSteps: number; maxMinutes: number; maxCostPaise: number }
  requiredCapabilities: AgentCapability[]
  /** Consequential steps need an exact-action approval (object + mutation named), not a blanket yes. */
  exactActionApproval: boolean
  evidence: SkillEvidence[]
  optionalAdapters?: SkillAdapter[]
  /** Risk the policy evaluates the skill's consequential steps at. */
  risk: 'low' | 'medium' | 'high'
  irreversible: boolean
}

/** Bindings are process objects a trusted caller attaches (an adapter, an actor); they are never part of the validated input. */
export type SkillBindings = Record<`__${string}`, unknown>
export type SkillHandler = (input: Record<string, unknown> & SkillBindings, ctx: SkillContext) => Promise<Record<string, unknown>>
export type SkillContext = { telegramId: string; now: number; permission: (c: AgentCapability) => AgentPermissionLevel; approvalStatus?: AgentExecutionPolicyInput['approvalStatus'] }

export type VetResult = { ok: true } | { ok: false; reasons: string[] }

const ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*){1,3}$/
const SEMVER = /^\d+\.\d+\.\d+$/

/** Static vetting of a definition. Fail closed: anything unclear is a reason. Pure. */
export function vetSkill(def: SkillDefinition): VetResult {
  const r: string[] = []
  if (!ID.test(def.id)) r.push('id must be dotted lower-case, e.g. merchant.order.accept')
  if (!SEMVER.test(def.sopVersion)) r.push('sopVersion must be semver')
  if (!def.title?.trim() || !def.purpose?.trim()) r.push('title and purpose required')
  if (!def.requiredCapabilities?.length) r.push('at least one required capability')
  if (!Number.isInteger(def.limits?.maxSteps) || def.limits.maxSteps < 1 || def.limits.maxSteps > 50) r.push('maxSteps 1..50')
  if (!(def.limits?.maxMinutes > 0 && def.limits.maxMinutes <= 240)) r.push('maxMinutes 0..240')
  if (!Number.isInteger(def.limits?.maxCostPaise) || def.limits.maxCostPaise < 0 || def.limits.maxCostPaise > 50_000_00) r.push('maxCostPaise 0..₹50,000')
  if (!def.evidence?.length) r.push('evidence required (use none explicitly for pure reads)')
  if (def.irreversible && !def.exactActionApproval) r.push('irreversible skills need exactActionApproval')
  if (def.evidence.includes('none') && def.evidence.length > 1) r.push('evidence none is exclusive')
  if ((def.irreversible || def.risk !== 'low') && def.evidence.includes('none')) r.push('consequential skills need real evidence')
  for (const [k, f] of Object.entries(def.input || {})) if (!/^[a-zA-Z][\w]{0,40}$/.test(k) || !f?.type) r.push(`bad input field ${k}`)
  return r.length ? { ok: false, reasons: r } : { ok: true }
}

/** Input against the schema. Returns the problems, [] when fine. Unknown keys are a problem (no smuggling). Pure. */
export function validateAgainst(schema: ObjectSchema, value: unknown): string[] {
  const p: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['input must be an object']
  const v = value as Record<string, unknown>
  for (const k of Object.keys(v)) if (!(k in schema)) p.push(`unknown field ${k}`)
  for (const [k, f] of Object.entries(schema)) {
    const x = v[k]
    if (x === undefined || x === null) { if (f.required) p.push(`${k} required`); continue }
    if (f.type === 'string') { if (typeof x !== 'string') p.push(`${k} must be string`); else { if (f.maxLength && x.length > f.maxLength) p.push(`${k} too long`); if (f.pattern && !f.pattern.test(x)) p.push(`${k} malformed`); if (f.enum && !f.enum.includes(x)) p.push(`${k} not one of ${f.enum.join('|')}`) } }
    else if (f.type === 'number') { if (typeof x !== 'number' || !Number.isFinite(x)) p.push(`${k} must be number`); else { if (f.integer && !Number.isInteger(x)) p.push(`${k} must be integer`); if (f.min !== undefined && x < f.min) p.push(`${k} below ${f.min}`); if (f.max !== undefined && x > f.max) p.push(`${k} above ${f.max}`) } }
    else if (f.type === 'boolean') { if (typeof x !== 'boolean') p.push(`${k} must be boolean`) }
    else if (f.type === 'string[]') { if (!Array.isArray(x) || x.some(i => typeof i !== 'string')) p.push(`${k} must be string[]`); else if (f.maxItems && x.length > f.maxItems) p.push(`${k} too many`) }
  }
  return p
}

export function enabledAdapters(env: Record<string, string | undefined> = process.env): Set<SkillAdapter> {
  return new Set(String(env.GOGO_SKILL_ADAPTERS || '').split(',').map(s => s.trim()).filter((s): s is SkillAdapter => ['mcp', 'apify', 'firecrawl', 'composio', 'alt_browser'].includes(s)))
}

// ── the registry: definitions + handlers from this module's static map only ─────────────────────────────────────
type Entry = { def: SkillDefinition; handler: SkillHandler }
const REGISTRY = new Map<string, Entry>()

export class SkillRegistryError extends Error { constructor(public code: string, detail: string) { super(`${code}: ${detail}`) } }

/** Registers one skill. Throws on a definition that does not vet or a duplicate id. Only this module's callers hold handlers. */
export function registerSkill(def: SkillDefinition, handler: SkillHandler): void {
  const v = vetSkill(def)
  if (!v.ok) throw new SkillRegistryError('skill_not_vetted', `${def.id}: ${v.reasons.join('; ')}`)
  if (typeof handler !== 'function') throw new SkillRegistryError('skill_handler_invalid', def.id)
  if (REGISTRY.has(def.id)) throw new SkillRegistryError('skill_duplicate', def.id)
  REGISTRY.set(def.id, { def, handler })
}

export function listSkills(): SkillDefinition[] { return [...REGISTRY.values()].map(e => e.def) }
export function skillDefinition(id: string): SkillDefinition | null { return REGISTRY.get(id)?.def ?? null }
export function skillsForCapability(c: AgentCapability): SkillDefinition[] { return listSkills().filter(d => d.requiredCapabilities.includes(c)) }

export type RunDecision = { ok: true } | { ok: false; code: 'unknown_skill' | 'bad_input' | 'adapter_off' | 'permission' | 'approval_required'; detail: string }

/** Can this caller run this skill with this input, right now? Pure given ctx. Never widens: every declared capability must pass. */
export function canRunSkill(id: string, input: unknown, ctx: SkillContext, env: Record<string, string | undefined> = process.env): RunDecision {
  const e = REGISTRY.get(id)
  if (!e) return { ok: false, code: 'unknown_skill', detail: id }
  const problems = validateAgainst(e.def.input, input)
  if (problems.length) return { ok: false, code: 'bad_input', detail: problems.join('; ') }
  const on = enabledAdapters(env)
  const off = (e.def.optionalAdapters || []).filter(a => !on.has(a))
  if (e.def.optionalAdapters?.length && off.length === e.def.optionalAdapters.length) return { ok: false, code: 'adapter_off', detail: `needs one of ${e.def.optionalAdapters.join(', ')}; none enabled` }
  for (const c of e.def.requiredCapabilities) {
    const mode = e.def.irreversible || e.def.risk !== 'low' ? 'execute' : 'read'
    const r = evaluateAgentExecutionPolicy({ capability: c, permissionLevel: ctx.permission(c), mode, risk: e.def.risk, irreversible: e.def.irreversible, approvalStatus: ctx.approvalStatus ?? null })
    if (!r.allowed) return { ok: false, code: r.reason === 'approval_required' || r.reason === 'approval_not_valid' ? 'approval_required' : 'permission', detail: `${c}: ${r.reason}` }
  }
  return { ok: true }
}

/** Runs a registered skill after canRunSkill passes, within its time limit; validates the output shape too. */
export async function runSkill(id: string, input: Record<string, unknown>, ctx: SkillContext, env: Record<string, string | undefined> = process.env, bindings: SkillBindings = {}): Promise<{ ok: true; output: Record<string, unknown> } | { ok: false; code: RunDecision extends { ok: false; code: infer C } ? C | 'timeout' | 'bad_output' | 'failed' : never; detail: string }> {
  const d = canRunSkill(id, input, ctx, env)
  if (!d.ok) return d
  const e = REGISTRY.get(id)!
  let timer: any
  try {
    const out = await Promise.race([
      e.handler({ ...input, ...bindings }, ctx),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new SkillRegistryError('timeout', `${id} exceeded ${e.def.limits.maxMinutes} min`)), e.def.limits.maxMinutes * 60_000) }),
    ])
    const problems = validateAgainst(e.def.output, out)
    if (problems.length) return { ok: false, code: 'bad_output', detail: problems.join('; ') }
    return { ok: true, output: out }
  } catch (err: any) {
    return { ok: false, code: err instanceof SkillRegistryError && err.code === 'timeout' ? 'timeout' : 'failed', detail: String(err?.message || err).slice(0, 200) }
  } finally { clearTimeout(timer) }
}

/** Test seam: forget everything registered (tests re-register). */
export function _resetSkillRegistryForTests() { REGISTRY.clear() }
