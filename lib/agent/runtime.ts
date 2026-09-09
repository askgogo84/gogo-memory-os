import { buildConfirmationText, classifyAgentRisk } from './policy'
import { dispatchThroughSameBrain } from './same-brain'
import {
  createAgentRun,
  createAgentStep,
  getAgentRunForUser,
  updateAgentRun,
  updateAgentStep,
} from './run-store'
import type { AgentActor, AgentRunRequest, AgentRunResult, AgentSurface } from './types'

async function executeRun(params: {
  runId: string
  stepId: string
  actor: AgentActor
  text: string
  messageId?: string | number | null
  riskLevel: AgentRunResult['riskLevel']
}): Promise<AgentRunResult> {
  const startedAt = new Date().toISOString()
  await updateAgentRun(params.runId, { status: 'running' })
  await updateAgentStep(params.stepId, { status: 'running', startedAt })

  try {
    const result = await dispatchThroughSameBrain({
      actor: params.actor,
      text: params.text,
      messageId: params.messageId,
    })
    const completedAt = new Date().toISOString()

    await updateAgentStep(params.stepId, {
      status: 'completed',
      output: {
        text: result.text,
        mediaUrl: result.mediaUrl || null,
        mediaType: result.mediaType || null,
        handledBy: result.handledBy,
      },
      completedAt,
    })
    await updateAgentRun(params.runId, {
      status: 'completed',
      summary: result.text,
      result: {
        text: result.text,
        mediaUrl: result.mediaUrl || null,
        mediaType: result.mediaType || null,
        handledBy: result.handledBy,
      },
      completedAt,
    })

    return {
      runId: params.runId,
      status: 'completed',
      riskLevel: params.riskLevel,
      confirmationRequired: false,
      result,
    }
  } catch (error: any) {
    const completedAt = new Date().toISOString()
    const message = error?.message || 'agent_execution_failed'
    await updateAgentStep(params.stepId, { status: 'failed', error: message, completedAt }).catch(() => {})
    await updateAgentRun(params.runId, {
      status: 'failed',
      summary: 'Gogo could not complete this action.',
      result: { error: 'agent_execution_failed' },
      completedAt,
    }).catch(() => {})
    throw error
  }
}

export async function runGogoAgent(request: AgentRunRequest): Promise<AgentRunResult> {
  const text = String(request.text || '').trim().slice(0, 2000)
  if (!text) throw new Error('empty_agent_request')
  if (!request.actor.whatsappId) throw new Error('whatsapp_identity_required')

  const policy = classifyAgentRisk(text)
  const requiresConfirmation = policy.confirmationRequired && !request.confirmed
  const status = requiresConfirmation ? 'awaiting_confirmation' : 'planned'

  const run = await createAgentRun({
    userId: request.actor.userId,
    legacyTelegramId: request.actor.legacyTelegramId,
    surface: request.surface,
    text,
    context: request.context,
    riskLevel: policy.riskLevel,
    status,
  })

  const stepId = await createAgentStep({
    runId: run.id,
    ordinal: 1,
    toolName: 'same_brain.dispatch',
    title: 'AskGogo action',
    status: requiresConfirmation ? 'awaiting_confirmation' : 'pending',
    confirmationRequired: policy.confirmationRequired,
    reversible: false,
  })

  if (requiresConfirmation) {
    return {
      runId: run.id,
      status: 'awaiting_confirmation',
      riskLevel: policy.riskLevel,
      confirmationRequired: true,
      confirmationText: buildConfirmationText(policy.riskLevel, text),
    }
  }

  return executeRun({
    runId: run.id,
    stepId,
    actor: request.actor,
    text,
    messageId: request.messageId,
    riskLevel: policy.riskLevel,
  })
}

export async function confirmGogoAgentRun(params: {
  runId: string
  actor: AgentActor
  surface: AgentSurface
  messageId?: string | number | null
}): Promise<AgentRunResult> {
  const existing = await getAgentRunForUser(params.runId, params.actor.userId)
  if (!existing) throw new Error('agent_run_not_found')
  if (existing.status !== 'awaiting_confirmation') throw new Error('agent_run_not_awaiting_confirmation')

  const { data: steps, error } = await (await import('@/lib/supabase-admin')).supabaseAdmin
    .from('agent_steps')
    .select('id')
    .eq('run_id', params.runId)
    .order('ordinal', { ascending: true })
    .limit(1)
  if (error || !steps?.[0]?.id) throw new Error('agent_step_not_found')

  return executeRun({
    runId: params.runId,
    stepId: String(steps[0].id),
    actor: params.actor,
    text: String(existing.input_text || ''),
    messageId: params.messageId,
    riskLevel: existing.risk_level,
  })
}
