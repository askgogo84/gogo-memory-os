/**
 * Fail-closed AskGogo Enterprise authorization preflight (7 Nov 2026).
 * Inputs must come from SERVER-VERIFIED membership, capability grants, resource
 * ownership and durable approvals. Never trust LLM/chat/form-supplied identities.
 * This does not replace core policy.ts, Sentinel, RLS or atomic approval claims.
 */
export type EnterpriseRole = 'viewer' | 'analyst' | 'operator' | 'admin'
export type EnterpriseCapability = 'orders' | 'menu' | 'invoices' | 'ops'
export type EnterpriseOperation = 'read' | 'draft' | 'execute'
export type EnterpriseAction =
  | 'orders.read' | 'orders.accept' | 'orders.reject'
  | 'menu.read' | 'menu.availability.set'
  | 'invoices.read' | 'invoices.draft' | 'invoices.file'
  | 'ops.digest.read'

const ACTIONS: Readonly<Record<EnterpriseAction, {
  capability: EnterpriseCapability
  operation: EnterpriseOperation
  minimumRole: EnterpriseRole
}>> = {
  'orders.read': { capability: 'orders', operation: 'read', minimumRole: 'viewer' },
  'orders.accept': { capability: 'orders', operation: 'execute', minimumRole: 'operator' },
  'orders.reject': { capability: 'orders', operation: 'execute', minimumRole: 'operator' },
  'menu.read': { capability: 'menu', operation: 'read', minimumRole: 'viewer' },
  'menu.availability.set': { capability: 'menu', operation: 'execute', minimumRole: 'operator' },
  'invoices.read': { capability: 'invoices', operation: 'read', minimumRole: 'viewer' },
  'invoices.draft': { capability: 'invoices', operation: 'draft', minimumRole: 'analyst' },
  'invoices.file': { capability: 'invoices', operation: 'execute', minimumRole: 'operator' },
  'ops.digest.read': { capability: 'ops', operation: 'read', minimumRole: 'viewer' },
}
export type EnterpriseApproval = {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed'
  workspaceId: string
  actorId: string
  action: EnterpriseAction
  objectId: string
  idempotencyKey: string
  expiresAtMs: number
  consumed: boolean
  approvedByActorId: string
}
export type EnterpriseAuthorizationInput = {
  workspaceId: string
  resourceWorkspaceId: string
  actor: { id: string; workspaceId: string; role: EnterpriseRole; active: boolean }
  membershipVerified: boolean
  action: EnterpriseAction
  operation: EnterpriseOperation
  capability: EnterpriseCapability
  enabledCapabilities: readonly EnterpriseCapability[]
  objectId: string
  idempotencyKey?: string | null
  approval?: EnterpriseApproval | null
  nowMs?: number
}
export type EnterpriseDenyReason =
  | 'invalid_scope' | 'membership_unverified' | 'inactive_actor' | 'workspace_mismatch'
  | 'unsupported_action' | 'action_mismatch' | 'capability_disabled' | 'role_insufficient'
  | 'approval_required' | 'approval_invalid' | 'approval_expired' | 'approval_consumed'
  | 'idempotency_key_required' | 'separation_of_duties_required'
export type EnterpriseAuthorizationResult =
  | { allowed: true; reason: 'scoped_read' | 'scoped_draft' | 'scoped_approved_execute' }
  | { allowed: false; reason: EnterpriseDenyReason }
const ROLE_RANK: Readonly<Record<EnterpriseRole, number>> = { viewer: 1, analyst: 2, operator: 3, admin: 4 }
const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/
const validId = (value: unknown): value is string => typeof value === 'string' && SCOPE_ID.test(value)
const deny = (reason: EnterpriseDenyReason): EnterpriseAuthorizationResult => ({ allowed: false, reason })
/**
 * Preflight alone grants no execution authority. The adapter must also invoke
 * core policy + Sentinel, atomically consume this scoped approval/idempotency
 * key in durable storage, then verify provider read-back through action-record.
 */
export function authorizeEnterpriseAction(input: EnterpriseAuthorizationInput): EnterpriseAuthorizationResult {
  if (!validId(input.workspaceId) || !validId(input.resourceWorkspaceId) ||
      !validId(input.actor?.id) || !validId(input.actor?.workspaceId) || !validId(input.objectId)) {
    return deny('invalid_scope')
  }
  if (input.membershipVerified !== true) return deny('membership_unverified')
  if (input.actor.active !== true) return deny('inactive_actor')
  if (input.workspaceId !== input.resourceWorkspaceId || input.workspaceId !== input.actor.workspaceId) {
    return deny('workspace_mismatch')
  }
  const spec = Object.prototype.hasOwnProperty.call(ACTIONS, input.action)
    ? ACTIONS[input.action] : undefined
  if (!spec) return deny('unsupported_action')
  if (spec.operation !== input.operation || spec.capability !== input.capability) return deny('action_mismatch')
  if (!Array.isArray(input.enabledCapabilities) || !input.enabledCapabilities.includes(input.capability)) {
    return deny('capability_disabled')
  }
  if ((ROLE_RANK[input.actor.role] || 0) < ROLE_RANK[spec.minimumRole]) return deny('role_insufficient')
  if (input.operation === 'read') return { allowed: true, reason: 'scoped_read' }
  if (input.operation === 'draft') return { allowed: true, reason: 'scoped_draft' }

  // Every enterprise write requires an exact, one-shot, unexpired approval.
  if (!validId(input.idempotencyKey)) return deny('idempotency_key_required')
  if (!input.approval) return deny('approval_required')
  const a = input.approval
  if (a.consumed || a.status === 'consumed') return deny('approval_consumed')
  if (a.status !== 'approved' || !validId(a.id) || !validId(a.approvedByActorId) ||
      a.workspaceId !== input.workspaceId || a.actorId !== input.actor.id ||
      a.action !== input.action || a.objectId !== input.objectId ||
      a.idempotencyKey !== input.idempotencyKey) return deny('approval_invalid')
  const now = input.nowMs ?? Date.now()
  if (!Number.isFinite(now) || !Number.isFinite(a.expiresAtMs) || a.expiresAtMs <= now) {
    return deny('approval_expired')
  }
  // Invoice filing may create legal obligations: a second actor must authorize.
  if (input.action === 'invoices.file' && a.approvedByActorId === input.actor.id) {
    return deny('separation_of_duties_required')
  }
  return { allowed: true, reason: 'scoped_approved_execute' }
}
