// One record per consequential action, in one shape, whatever the feature: what was asked, what the policy decided,
// what was executed, what the provider said back, and whether Gogo verified it afterwards. The pieces already exist
// (policy.ts decides, approval-* gates, outcome-reconciliation.ts verifies, agent_runs/agent_activity store), but each
// feature kept its own shape, so "did it actually happen?" had a different answer per feature. This is the shared
// contract; features adopt it one at a time. It is pure apart from save/load, which use agent_activity (no migration).
import { evaluateAgentExecutionPolicy, type AgentCapability, type AgentExecutionPolicyInput, type AgentExecutionPolicyResult } from './policy'
import type { OutcomeReconciliation } from './outcome-reconciliation'

/** The four ways an action can be handled. Decided by policy, never by the model. */
export type DecisionMode = 'auto' | 'recommend' | 'approval' | 'human_led'
export type ActionState = 'planned' | 'awaiting_approval' | 'running' | 'verifying' | 'verified_success' | 'failed' | 'blocked' | 'outcome_unknown'
export type Evidence = { provider: string; ids?: Record<string, string>; httpStatus?: number | null; link?: string | null; note?: string | null; at: string }
export type Verification = { state: OutcomeReconciliation['state']; at: string; evidence: Record<string, unknown>; reason?: string }

export type ActionRecord = {
  schema: 'action-record-v1'
  id: string
  telegramId: string
  capability: AgentCapability
  /** "calendar.create", "reminder.create", "expense.log", "email.send" … */
  action: string
  /** What the person asked, as they said it (redacted upstream when needed). */
  request: string
  requestedAt: string
  decision: { mode: DecisionMode; reason: AgentExecutionPolicyResult['reason']; permissionLevel: AgentExecutionPolicyInput['permissionLevel']; risk: AgentExecutionPolicyInput['risk']; irreversible: boolean; approvalId?: string | null }
  state: ActionState
  history: { state: ActionState; at: string; note?: string }[]
  evidence: Evidence[]
  verification: Verification | null
  error?: string | null
}

export const ACTION_RECORD_EVENT = 'action_record'
const TERMINAL: ReadonlySet<ActionState> = new Set(['verified_success', 'failed', 'blocked', 'outcome_unknown'])
const NEXT: Record<ActionState, readonly ActionState[]> = {
  planned: ['awaiting_approval', 'running', 'blocked'],
  awaiting_approval: ['running', 'blocked', 'failed'],
  running: ['verifying', 'failed', 'outcome_unknown', 'blocked'],
  verifying: ['verified_success', 'failed', 'outcome_unknown'],
  verified_success: [], failed: [], blocked: [], outcome_unknown: [],
}

/** Policy result → the mode the person sees. Pure. */
export function decisionMode(r: AgentExecutionPolicyResult): DecisionMode {
  if (r.allowed) return r.reason === 'approved_execute' ? 'approval' : 'auto'
  if (r.reason === 'approval_required' || r.reason === 'approval_not_valid' || r.reason === 'auto_not_allowed_for_consequential_action') return 'approval'
  if (r.reason === 'permission_insufficient') return 'recommend'
  return 'human_led'
}

export type OpenInput = { telegramId: string | number; capability: AgentCapability; action: string; request: string; policy: AgentExecutionPolicyInput; now?: number; id?: string }
/** A new record in state planned (or awaiting_approval / blocked straight away, per policy). Pure. */
export function openActionRecord(p: OpenInput): ActionRecord {
  const at = new Date(p.now ?? Date.now()).toISOString()
  const result = evaluateAgentExecutionPolicy(p.policy)
  const mode = decisionMode(result)
  const rec: ActionRecord = {
    schema: 'action-record-v1', id: p.id || `${p.action}:${at}:${Math.random().toString(36).slice(2, 8)}`, telegramId: String(p.telegramId),
    capability: p.capability, action: p.action, request: String(p.request || '').slice(0, 500), requestedAt: at,
    decision: { mode, reason: result.reason, permissionLevel: p.policy.permissionLevel, risk: p.policy.risk, irreversible: p.policy.irreversible, approvalId: null },
    state: 'planned', history: [{ state: 'planned', at }], evidence: [], verification: null,
  }
  if (mode === 'human_led' || (!result.allowed && mode === 'recommend')) return transition(rec, 'blocked', { note: result.reason, now: p.now })
  if (mode === 'approval' && result.reason !== 'approved_execute') return transition(rec, 'awaiting_approval', { now: p.now })
  return rec
}

/** Move to the next state; illegal moves throw so a feature cannot skip verification or resurrect a finished record. Pure. */
export function transition(rec: ActionRecord, state: ActionState, p: { note?: string; error?: string | null; now?: number } = {}): ActionRecord {
  if (!NEXT[rec.state].includes(state)) throw new Error(`action_record_illegal_transition:${rec.state}->${state}`)
  const at = new Date(p.now ?? Date.now()).toISOString()
  return { ...rec, state, error: p.error ?? rec.error ?? null, history: [...rec.history, { state, at, ...(p.note ? { note: p.note } : {}) }] }
}

/** What the provider said back. Allowed only while running or verifying. Pure. */
export function attachEvidence(rec: ActionRecord, e: Omit<Evidence, 'at'>, now?: number): ActionRecord {
  if (rec.state !== 'running' && rec.state !== 'verifying') throw new Error(`action_record_evidence_in_${rec.state}`)
  return { ...rec, evidence: [...rec.evidence, { ...e, at: new Date(now ?? Date.now()).toISOString() }] }
}

/** The verification result decides the terminal state; nothing else may claim verified_success. Pure. */
export function recordVerification(rec: ActionRecord, v: OutcomeReconciliation, now?: number): ActionRecord {
  const at = new Date(now ?? Date.now()).toISOString()
  const base = rec.state === 'running' ? transition(rec, 'verifying', { now }) : rec
  if (base.state !== 'verifying') throw new Error(`action_record_verify_in_${base.state}`)
  const verification: Verification = { state: v.state, at, evidence: v.evidence, ...('reason' in v ? { reason: v.reason } : {}) }
  const withV = { ...base, verification }
  if (v.state === 'verified_completed') return transition(withV, 'verified_success', { now })
  if (v.state === 'verified_absent') return transition(withV, 'failed', { now, error: 'verified_absent' })
  return transition(withV, 'outcome_unknown', { now, error: v.reason })
}

/** The idempotency rule in one place: never re-run an action whose outcome is unknown or already verified. Pure. */
export function mayRetry(rec: ActionRecord): boolean {
  return rec.state === 'failed' && rec.verification?.state !== 'still_unknown'
}
export const isTerminal = (rec: ActionRecord) => TERMINAL.has(rec.state)

/** The one line the person reads. Says what was verified, not what was attempted. Pure. */
export function receiptLine(rec: ActionRecord, what: string): string {
  const link = rec.evidence.find(e => e.link)?.link
  switch (rec.state) {
    case 'verified_success': return `Done: ${what}.${link ? ` ${link}` : ''}`
    case 'outcome_unknown': return `I tried to ${what.replace(/^[A-Z]/, c => c.toLowerCase())}, but couldn't confirm it went through. I won't retry on my own; say "check again" and I'll look.`
    case 'failed': return `That didn't go through: ${what}${rec.error ? ` (${rec.error.replace(/_/g, ' ')})` : ''}. Nothing was changed.`
    case 'blocked': return rec.decision.mode === 'recommend' ? `I can prepare ${what} for you to do yourself; I'm not set to do it on my own.` : `${what} needs you to do it; I'm not allowed to.`
    case 'awaiting_approval': return `Ready: ${what}. Reply "approve" and I'll do it.`
    case 'running': case 'verifying': return `Working on it: ${what}.`
    default: return `Planned: ${what}.`
  }
}

// ── persistence (agent_activity, no migration) ──────────────────────────────────
type Db = { from: (t: string) => any }
export async function saveActionRecord(db: Db, rec: ActionRecord): Promise<void> {
  const { error } = await db.from('agent_activity').insert({ telegram_id: rec.telegramId, event_type: ACTION_RECORD_EVENT, message: `${rec.action} ${rec.state}`, metadata_json: rec })
  if (error) console.error('ACTION_RECORD_SAVE_FAILED:', String(error.message || error).slice(0, 160))
}
export async function recentActionRecords(db: Db, telegramId: string | number, limit = 20): Promise<ActionRecord[]> {
  const { data } = await db.from('agent_activity').select('metadata_json').eq('telegram_id', String(telegramId)).eq('event_type', ACTION_RECORD_EVENT).order('created_at', { ascending: false }).limit(limit)
  return ((data || []) as any[]).map(r => r.metadata_json).filter(m => m?.schema === 'action-record-v1')
}
