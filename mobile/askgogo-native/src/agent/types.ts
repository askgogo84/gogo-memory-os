export type AgentRunStatus = 'queued' | 'running' | 'watching' | 'waiting_approval' | 'completed' | 'failed' | 'paused'
export type AgentStepStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled'
export type AgentRisk = 'low' | 'medium' | 'high'
export type GoalStatus = 'active' | 'paused' | 'completed' | 'cancelled'
export type IdeaStatus = 'new' | 'accepted' | 'dismissed' | 'snoozed'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed'
export type PermissionLevel = 'off' | 'read' | 'draft' | 'ask' | 'auto'

export type AgentCapability =
  | 'memory'
  | 'files'
  | 'reminders'
  | 'lists'
  | 'tasks'
  | 'email'
  | 'calendar'
  | 'browser'
  | 'contacts'
  | 'travel'
  | 'payments'

export interface AgentStep {
  id?: string
  ordinal: number
  toolName: string
  title: string
  status: AgentStepStatus
  output?: Record<string, unknown>
  error?: string | null
  startedAt?: string | null
  completedAt?: string | null
}

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
  steps?: AgentStep[]
}

export interface AgentWatcher {
  id: string
  goalId?: string | null
  type: 'deadline' | 'calendar_change' | 'email_reply' | 'web_change' | 'application_status' | 'price_threshold' | 'travel_disruption'
  title: string
  condition: Record<string, unknown>
  cadenceMinutes: number
  active: boolean
  lastCheckedAt?: string | null
  nextCheckAt?: string | null
  createdAt: string
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
  surface?: 'web' | 'ios' | 'android'
  runs: AgentRun[]
  watchers: AgentWatcher[]
  goals: AgentGoal[]
  ideas: AgentIdea[]
  approvals: AgentApproval[]
  permissions: AgentPermission[]
  artifacts: AgentArtifact[]
}

export interface AgentCommandResult {
  runId: string
  status: 'completed' | 'waiting_approval' | 'paused' | 'failed'
  capability: AgentCapability
  risk: AgentRisk
  text?: string
  mediaUrl?: string | null
  mediaType?: string | null
  handledBy?: string
  approvalId?: string
  approvalRequired?: boolean
  blockedReason?: string
  steps?: AgentStep[]
}
