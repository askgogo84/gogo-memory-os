export type AgentRunStatus = 'queued' | 'running' | 'watching' | 'waiting_approval' | 'completed' | 'failed' | 'paused'
export type AgentRisk = 'low' | 'medium' | 'high'
export type GoalStatus = 'active' | 'paused' | 'completed' | 'cancelled'
export type IdeaStatus = 'new' | 'accepted' | 'dismissed' | 'snoozed'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed'
export type PermissionLevel = 'off' | 'read' | 'draft' | 'ask' | 'auto'

export type AgentCapability =
  | 'memory'
  | 'files'
  | 'email'
  | 'calendar'
  | 'browser'
  | 'contacts'
  | 'travel'
  | 'payments'

export interface AgentRun {
  id: string
  title: string
  summary: string
  status: AgentRunStatus
  capability: AgentCapability
  goalId?: string
  progress?: number
  startedAt: string
  updatedAt: string
  nextCheckAt?: string
  why?: string
}

export interface AgentGoal {
  id: string
  title: string
  outcome: string
  status: GoalStatus
  progress: number
  deadline?: string
  nextAction?: string
  blockers?: string[]
  watchers?: number
}

export interface AgentIdea {
  id: string
  title: string
  reason: string
  expectedValue: string
  status: IdeaStatus
  actionLabel: string
  sourceLabel?: string
}

export interface AgentApproval {
  id: string
  runId: string
  actionType: 'send_email' | 'submit_form' | 'calendar_change' | 'booking' | 'purchase' | 'share'
  title: string
  description: string
  risk: AgentRisk
  status: ApprovalStatus
  primaryLabel: string
  secondaryLabel?: string
  preview: Array<{ label: string; value: string }>
}

export interface AgentPermission {
  capability: AgentCapability
  label: string
  description: string
  level: PermissionLevel
  irreversibleAlwaysAsk: boolean
}

export interface AgentArtifact {
  id: string
  type: 'trip' | 'application_tracker' | 'meeting_brief' | 'comparison' | 'goal_plan' | 'research_brief' | 'reward_summary'
  title: string
  subtitle?: string
  updatedAt: string
}

export interface AgentHomeSnapshot {
  runs: AgentRun[]
  goals: AgentGoal[]
  ideas: AgentIdea[]
  approvals: AgentApproval[]
  permissions: AgentPermission[]
  artifacts: AgentArtifact[]
}
