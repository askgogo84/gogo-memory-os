import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentContext, AgentRiskLevel, AgentRunStatus, AgentStepStatus, AgentSurface } from './types'

function safeText(value: unknown): string {
  return redactSecretShapedText(String(value ?? '').slice(0, 4000))
}

function safeContext(context?: AgentContext): Record<string, unknown> {
  if (!context) return {}
  const allowed = ['screen', 'selectedItemId', 'selectedItemType', 'deepLink', 'locale', 'timezone']
  return Object.fromEntries(
    allowed
      .filter((key) => context[key] !== undefined && context[key] !== null)
      .map((key) => [key, safeText(context[key])]),
  )
}

export async function createAgentRun(params: {
  userId: string
  legacyTelegramId: number
  surface: AgentSurface
  text: string
  context?: AgentContext
  riskLevel: AgentRiskLevel
  status: AgentRunStatus
}) {
  const { data, error } = await supabaseAdmin
    .from('agent_runs')
    .insert({
      user_id: params.userId,
      legacy_telegram_id: params.legacyTelegramId,
      source_surface: params.surface,
      input_text: safeText(params.text),
      context: safeContext(params.context),
      risk_level: params.riskLevel,
      status: params.status,
    })
    .select('id, status, risk_level, created_at')
    .single()

  if (error || !data?.id) throw new Error(`agent_run_create_failed:${error?.message || 'unknown'}`)
  return data as { id: string; status: AgentRunStatus; risk_level: AgentRiskLevel; created_at: string }
}

export async function createAgentStep(params: {
  runId: string
  ordinal: number
  toolName: string
  title: string
  status: AgentStepStatus
  confirmationRequired?: boolean
  reversible?: boolean
}) {
  const { data, error } = await supabaseAdmin
    .from('agent_steps')
    .insert({
      run_id: params.runId,
      ordinal: params.ordinal,
      tool_name: params.toolName,
      title: safeText(params.title),
      status: params.status,
      confirmation_required: Boolean(params.confirmationRequired),
      reversible: Boolean(params.reversible),
    })
    .select('id')
    .single()

  if (error || !data?.id) throw new Error(`agent_step_create_failed:${error?.message || 'unknown'}`)
  return String(data.id)
}

export async function updateAgentRun(runId: string, patch: {
  status?: AgentRunStatus
  summary?: string | null
  result?: Record<string, unknown> | null
  completedAt?: string | null
}) {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.status) payload.status = patch.status
  if (patch.summary !== undefined) payload.summary = patch.summary ? safeText(patch.summary) : null
  if (patch.result !== undefined) payload.result = patch.result
  if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt

  const { error } = await supabaseAdmin.from('agent_runs').update(payload).eq('id', runId)
  if (error) throw new Error(`agent_run_update_failed:${error.message}`)
}

export async function updateAgentStep(stepId: string, patch: {
  status?: AgentStepStatus
  output?: Record<string, unknown> | null
  error?: string | null
  startedAt?: string | null
  completedAt?: string | null
}) {
  const payload: Record<string, unknown> = {}
  if (patch.status) payload.status = patch.status
  if (patch.output !== undefined) payload.output = patch.output
  if (patch.error !== undefined) payload.error = patch.error ? safeText(patch.error) : null
  if (patch.startedAt !== undefined) payload.started_at = patch.startedAt
  if (patch.completedAt !== undefined) payload.completed_at = patch.completedAt

  const { error } = await supabaseAdmin.from('agent_steps').update(payload).eq('id', stepId)
  if (error) throw new Error(`agent_step_update_failed:${error.message}`)
}

export async function getAgentRunForUser(runId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from('agent_runs')
    .select('*')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(`agent_run_read_failed:${error.message}`)
  return data || null
}

export async function getAgentSteps(runId: string) {
  const { data, error } = await supabaseAdmin
    .from('agent_steps')
    .select('id, ordinal, tool_name, title, status, confirmation_required, reversible, output, error, started_at, completed_at, created_at')
    .eq('run_id', runId)
    .order('ordinal', { ascending: true })

  if (error) throw new Error(`agent_steps_read_failed:${error.message}`)
  return data || []
}
