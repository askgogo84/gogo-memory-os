export type AgentCapability = 'memory' | 'files' | 'email' | 'calendar' | 'browser' | 'contacts' | 'travel' | 'payments'
export type AgentPermissionLevel = 'off' | 'read' | 'draft' | 'ask' | 'auto'
export type AgentActionMode = 'read' | 'draft' | 'execute'
export type AgentRiskLevel = 'low' | 'medium' | 'high'

export interface AgentExecutionPolicyInput {
  capability: AgentCapability
  permissionLevel: AgentPermissionLevel
  mode: AgentActionMode
  risk: AgentRiskLevel
  irreversible: boolean
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed' | null
}

export type AgentExecutionPolicyResult =
  | { allowed: true; reason: 'read_allowed' | 'draft_allowed' | 'safe_auto_execute' | 'approved_execute' }
  | { allowed: false; reason: 'permission_off' | 'permission_insufficient' | 'approval_required' | 'approval_not_valid' | 'auto_not_allowed_for_consequential_action' }

const CONSEQUENTIAL_CAPABILITIES = new Set<AgentCapability>(['email', 'calendar', 'browser', 'travel', 'payments'])

function rank(level: AgentPermissionLevel): number {
  switch (level) {
    case 'off': return 0
    case 'read': return 1
    case 'draft': return 2
    case 'ask': return 3
    case 'auto': return 4
  }
}

/**
 * Pure deterministic policy gate used before ANY agent executor is allowed to
 * perform work. The LLM never decides whether its own action is authorized.
 *
 * v1 safety invariant:
 * - read requires read+
 * - draft requires draft+
 * - every irreversible action requires a one-shot approved approval record
 * - email/calendar/browser/travel/payments cannot auto-execute high/medium-risk
 *   consequential actions merely because a client asks for `auto`
 */
export function evaluateAgentExecutionPolicy(input: AgentExecutionPolicyInput): AgentExecutionPolicyResult {
  if (input.permissionLevel === 'off') return { allowed: false, reason: 'permission_off' }

  if (input.mode === 'read') {
    return rank(input.permissionLevel) >= rank('read')
      ? { allowed: true, reason: 'read_allowed' }
      : { allowed: false, reason: 'permission_insufficient' }
  }

  if (input.mode === 'draft') {
    return rank(input.permissionLevel) >= rank('draft')
      ? { allowed: true, reason: 'draft_allowed' }
      : { allowed: false, reason: 'permission_insufficient' }
  }

  if (rank(input.permissionLevel) < rank('ask')) {
    return { allowed: false, reason: 'permission_insufficient' }
  }

  if (input.irreversible) {
    if (input.approvalStatus !== 'approved') {
      return {
        allowed: false,
        reason: input.approvalStatus && input.approvalStatus !== 'pending' ? 'approval_not_valid' : 'approval_required',
      }
    }
    return { allowed: true, reason: 'approved_execute' }
  }

  if (input.approvalStatus === 'approved') return { allowed: true, reason: 'approved_execute' }

  if (input.permissionLevel === 'auto') {
    if (CONSEQUENTIAL_CAPABILITIES.has(input.capability) && input.risk !== 'low') {
      return { allowed: false, reason: 'auto_not_allowed_for_consequential_action' }
    }
    return { allowed: true, reason: 'safe_auto_execute' }
  }

  return { allowed: false, reason: 'approval_required' }
}
