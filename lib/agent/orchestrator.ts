import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { classifyAgentRequest } from './classifier'
import { dispatchThroughSameBrain } from './same-brain'
import { evaluateAgentExecutionPolicy, type AgentCapability, type AgentPermissionLevel } from './policy'
import type { AgentActor } from './actor'

export type AgentSurface = 'web' | 'ios' | 'android' | 'whatsapp'

type RunResult = {
  runId: string
  status: 'completed' | 'waiting_approval' | 'paused' | 'failed'
  capability: AgentCapability
  risk: 'low' | 'medium' | 'high'
  text?: string
  mediaUrl?: string | null
  mediaType?: string | null
  handledBy?: string
  approvalId?: string
  approvalRequired?: boolean
  blockedReason?: string
}

const DEFAULT_LEVEL: Record<AgentCapability, AgentPermissionLevel> = {
  memory: 'ask',
  files: 'ask',
  reminders: 'auto',
  lists: 'auto',
  tasks: 'auto',
  email: 'draft',
  calendar: 'ask',
  browser: 'draft',
  contacts: 'read',
  travel: 'draft',
  payments: 'ask',
}

const CONSEQUENTAL = new Set<AgentCapability>(['email', 'calendar', 'browser', 'travel', 'payments'])

function safeInput(value: unknown, max = 2000) {
  return redactSecretShapedText(String(value ?? '').trim().slice(0, max))
}

function safeContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const allowed = ['screen', 'selectedItemId', 'selectedItemType', 'deepLink', 'locale', 'timezone']
  return Object.fromEntries(allowed.filter(k => source[k] != null).map(k => [k, safeInput(source[k], 500)]))
}

async function activity(actor: AgentActor, runId: string, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: String(actor.legacyTelegramId),
    run_id: runId,
    event_type: eventType,
    message: safeInput(message, 1000),
    metadata_json: metadata,
  })
  if (error) console.error('AGENT_ACTIVITY_WRITE_FAILED:', error.message)
}

async function permissionFor(actor: AgentActor, capability: AgentCapability): Promise<AgentPermissionLevel> {
  const { data, error } = await supabaseAdmin
    .from('agent_permissions')
    .select('level')
    .eq('telegram_id', String(actor.legacyTelegramId))
    .eq('capability', capability)
    .maybeSingle()
  if (error) {
    console.error('AGENT_PERMISSION_READ_FAILED:', error.message)
    throw new Error('agent_permission_unavailable')
  }
  return (data?.level as AgentPermissionLevel | undefined) || DEFAULT_LEVEL[capability]
}

async function createRun(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
  context?: unknown
}) {
  const classified = classifyAgentRequest(params.text)
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('agent_runs')
    .insert({
      telegram_id: String(params.actor.legacyTelegramId),
      type: 'command',
      capability: classified.capability,
      status: 'queued',
      title: classified.title,
      summary: 'Gogo is preparing this action.',
      progress: 0,
      why: classified.why,
      source: params.surface,
      metadata_json: {
        input_text: safeInput(params.text),
        context: safeContext(params.context),
        surface: params.surface,
        mode: classified.mode,
        risk: classified.risk,
        irreversible: classified.irreversible,
        approval_action: classified.approvalAction || null,
      },
      started_at: now,
      updated_at: now,
    })
    .select('id')
    .single()
  if (error || !data?.id) throw new Error(`agent_run_create_failed:${error?.message || 'unknown'}`)
  await activity(params.actor, String(data.id), 'run_created', `Gogo received: ${classified.title}`, { surface: params.surface, capability: classified.capability })
  return { runId: String(data.id), classified }
}

async function requestApproval(params: {
  actor: AgentActor
  runId: string
  text: string
  classified: ReturnType<typeof classifyAgentRequest>
}) {
  if (!params.classified.approvalAction) return null
  const { data, error } = await supabaseAdmin
    .from('agent_approvals')
    .insert({
      telegram_id: String(params.actor.legacyTelegramId),
      run_id: params.runId,
      action_type: params.classified.approvalAction,
      title: params.classified.title,
      description: params.classified.why,
      payload_preview: [
        { label: 'Action', value: safeInput(params.text, 600) },
        { label: 'Risk', value: params.classified.risk },
      ],
      execution_payload: { input_text: safeInput(params.text), capability: params.classified.capability },
      risk_level: params.classified.risk,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error || !data?.id) throw new Error(`agent_approval_create_failed:${error?.message || 'unknown'}`)

  await supabaseAdmin.from('agent_runs').update({
    status: 'waiting_approval',
    summary: 'Waiting for your approval before Gogo acts.',
    progress: 25,
    updated_at: new Date().toISOString(),
  }).eq('id', params.runId).eq('telegram_id', String(params.actor.legacyTelegramId))
  await activity(params.actor, params.runId, 'approval_requested', `Approval required: ${params.classified.title}`, { approval_id: data.id, risk: params.classified.risk })
  return String(data.id)
}

async function executeStoredRun(params: { actor: AgentActor; runId: string; messageId?: string | number | null }): Promise<RunResult> {
  const { data: run, error } = await supabaseAdmin
    .from('agent_runs')
    .select('id, capability, status, title, metadata_json')
    .eq('id', params.runId)
    .eq('telegram_id', String(params.actor.legacyTelegramId))
    .maybeSingle()
  if (error) throw new Error(`agent_run_read_failed:${error.message}`)
  if (!run) throw new Error('agent_run_not_found')

  const metadata = (run.metadata_json || {}) as Record<string, any>
  const text = safeInput(metadata.input_text)
  const classified = classifyAgentRequest(text)
  const permissionLevel = await permissionFor(params.actor, classified.capability)

  const { data: approval } = await supabaseAdmin
    .from('agent_approvals')
    .select('id, status')
    .eq('run_id', params.runId)
    .eq('telegram_id', String(params.actor.legacyTelegramId))
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const directUserApproval = classified.mode === 'execute' && classified.risk === 'low' && !classified.irreversible && !CONSEQUENTAL.has(classified.capability)
  const policy = evaluateAgentExecutionPolicy({
    capability: classified.capability,
    permissionLevel,
    mode: classified.mode,
    risk: classified.risk,
    irreversible: classified.irreversible,
    approvalStatus: approval?.status === 'approved' ? 'approved' : directUserApproval ? 'approved' : (approval?.status as any) || null,
  })

  if (!policy.allowed) {
    if ((policy.reason === 'approval_required' || policy.reason === 'auto_not_allowed_for_consequential_action') && classified.approvalAction && !approval) {
      const approvalId = await requestApproval({ actor: params.actor, runId: params.runId, text, classified })
      return { runId: params.runId, status: 'waiting_approval', capability: classified.capability, risk: classified.risk, approvalId: approvalId || undefined, approvalRequired: true }
    }
    await supabaseAdmin.from('agent_runs').update({ status: 'paused', summary: `Blocked by Gogo Safe Mode: ${policy.reason}`, updated_at: new Date().toISOString() }).eq('id', params.runId).eq('telegram_id', String(params.actor.legacyTelegramId))
    await activity(params.actor, params.runId, 'run_blocked', `Gogo Safe Mode blocked this action: ${policy.reason}`, { capability: classified.capability, permission: permissionLevel })
    return { runId: params.runId, status: 'paused', capability: classified.capability, risk: classified.risk, blockedReason: policy.reason }
  }

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('agent_runs')
    .update({ status: 'running', summary: 'Gogo is working on it.', progress: 50, updated_at: new Date().toISOString() })
    .eq('id', params.runId)
    .eq('telegram_id', String(params.actor.legacyTelegramId))
    .in('status', ['queued', 'waiting_approval'])
    .select('id')
    .maybeSingle()
  if (claimError) throw new Error(`agent_run_claim_failed:${claimError.message}`)
  if (!claimed) throw new Error('agent_run_already_claimed')

  await activity(params.actor, params.runId, 'run_started', `Gogo started: ${classified.title}`, { capability: classified.capability, handled_by: 'same-brain' })
  try {
    const result = await dispatchThroughSameBrain({ actor: params.actor, text, messageId: params.messageId })
    const completedAt = new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({
      status: 'completed',
      summary: safeInput(result.text, 2000),
      progress: 100,
      completed_at: completedAt,
      updated_at: completedAt,
      metadata_json: { ...metadata, handled_by: result.handledBy, media_url: result.mediaUrl || null, media_type: result.mediaType || null },
    }).eq('id', params.runId).eq('telegram_id', String(params.actor.legacyTelegramId))
    if (approval?.id && approval.status === 'approved') {
      await supabaseAdmin.from('agent_approvals').update({ status: 'executed', executed_at: completedAt }).eq('id', approval.id).eq('telegram_id', String(params.actor.legacyTelegramId))
    }
    await activity(params.actor, params.runId, 'run_completed', safeInput(result.text, 900), { capability: classified.capability, handled_by: result.handledBy })
    return { runId: params.runId, status: 'completed', capability: classified.capability, risk: classified.risk, text: result.text, mediaUrl: result.mediaUrl, mediaType: result.mediaType, handledBy: result.handledBy, approvalRequired: false }
  } catch (err: any) {
    const completedAt = new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({ status: 'failed', summary: 'Gogo could not complete this action.', error: safeInput(err?.message || 'agent_execution_failed', 700), completed_at: completedAt, updated_at: completedAt }).eq('id', params.runId).eq('telegram_id', String(params.actor.legacyTelegramId))
    await activity(params.actor, params.runId, 'run_failed', 'Gogo could not complete this action.', { error: safeInput(err?.message || 'unknown', 400) })
    throw err
  }
}

export async function runAgentCommand(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
  context?: unknown
  messageId?: string | number | null
}): Promise<RunResult> {
  const text = safeInput(params.text)
  if (!text) throw new Error('empty_agent_request')
  const { runId } = await createRun({ actor: params.actor, surface: params.surface, text, context: params.context })
  return executeStoredRun({ actor: params.actor, runId, messageId: params.messageId })
}

export async function executeApprovedAgentRun(params: { actor: AgentActor; runId: string; messageId?: string | number | null }) {
  return executeStoredRun(params)
}
