export type AgentSurface = 'whatsapp' | 'ios' | 'android' | 'web'
export type AgentRiskLevel = 'green' | 'amber' | 'red'
export type AgentRunStatus = 'planned' | 'awaiting_confirmation' | 'running' | 'completed' | 'failed' | 'cancelled'
export type AgentStepStatus = 'pending' | 'awaiting_confirmation' | 'running' | 'completed' | 'failed' | 'cancelled'

export type AgentActor = {
  userId: string
  legacyTelegramId: number
  whatsappId: string
  name: string
}

export type AgentContext = {
  screen?: string | null
  selectedItemId?: string | null
  selectedItemType?: string | null
  deepLink?: string | null
  locale?: string | null
  timezone?: string | null
  [key: string]: unknown
}

export type AgentRunRequest = {
  actor: AgentActor
  surface: AgentSurface
  text: string
  context?: AgentContext
  messageId?: string | number | null
  confirmed?: boolean
  existingRunId?: string | null
}

export type AgentDispatchResult = {
  text: string
  mediaUrl?: string | null
  mediaType?: string | null
  handledBy: 'feature-intent' | 'same-brain'
}

export type AgentRunResult = {
  runId: string
  status: AgentRunStatus
  riskLevel: AgentRiskLevel
  confirmationRequired: boolean
  confirmationText?: string | null
  result?: AgentDispatchResult | null
}
