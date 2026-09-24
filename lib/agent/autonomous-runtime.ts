import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { selectSpecialistRoute, type SpecialistRoute } from './specialist-registry'
import type { AgentActor } from './actor'

export const AUTONOMOUS_RUNTIME_VERSION = 'gogo-autonomous-v1'
const DEFAULT_LEASE_MINUTES = 10
const DEFAULT_MAX_ATTEMPTS = 4
const RETRY_MINUTES = [2, 10, 30, 120]

export type AutonomousPlanStep = {
  key: string
  title: string
  toolName: string
  dependsOn?: string[]
  lane?: string
  maxAttempts?: number
  requiresApproval?: boolean
  verificationRequired?: boolean
  mutation?: boolean
}

export type AutonomousPlan = {
  objective: string
  steps: AutonomousPlanStep[]
  route?: SpecialistRoute
  metadata?: Record<string, unknown>
}

export type RuntimeStepMetadata = {
  stepKey: string
  dependsOn: string[]
  lane: string
  maxAttempts: number
  attempt: number
  requiresApproval: boolean
  verificationRequired: boolean
  mutation: boolean
  idempotencyKey: string
  leaseUntil?: string | null
  retryAt?: string | null
  approvalId?: string | null
  verifiedAt?: string | null
  lastError?: string | null
}

export type RuntimeStepRow = {
  id: string
  run_id: string
  ordinal: number
  tool_name: string
  title: string
  status: string
  output_json?: Record<string, any> | null
  error?: string | null
  started_at?: string | null
  completed_at?: string | null
}

export type AutonomousToolResult =
  | { status: 'completed'; output?: Record<string, unknown>; verified?: boolean }
  | { status: 'waiting_approval'; approvalId: string; output?: Record<string, unknown> }
  | { status: 'retryable_failure'; error: string; output?: Record<string, unknown> }
  | { status: 'blocked'; error: string; output?: Record<string, unknown> }

export type AutonomousToolContext = {
  actor: AgentActor
  runId: string
  objective: string
  step: RuntimeStepRow
  runtime: RuntimeStepMetadata
  idempotencyKey: string
}

export type AutonomousToolHandler = (context: AutonomousToolContext) => Promise<AutonomousToolResult>
export type AutonomousToolRegistry = Record<string, AutonomousToolHandler>

function safe(value: unknown, max = 1200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function isoPlusMinutes(minutes: number) {
  return new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString()
}

function runtimeMeta(row: RuntimeStepRow): RuntimeStepMetadata {
  const runtime = (row.output_json as any)?.runtime || {}
  return {
    stepKey: safe(runtime.stepKey || row.tool_name || row.id, 160),
    dependsOn: Array.isArray(runtime.dependsOn) ? runtime.dependsOn.map((x: unknown) => safe(x, 160)).filter(Boolean) : [],
    lane: safe(runtime.lane || 'default', 80),
    maxAttempts: Math.max(1, Math.min(10, Number(runtime.maxAttempts || DEFAULT_MAX_ATTEMPTS))),
    attempt: Math.max(0, Number(runtime.attempt || 0)),
    requiresApproval: Boolean(runtime.requiresApproval),
    verificationRequired: Boolean(runtime.verificationRequired),
    mutation: Boolean(runtime.mutation),
    idempotencyKey: safe(runtime.idempotencyKey || '', 200),
    leaseUntil: runtime.leaseUntil || null,
    retryAt: runtime.retryAt || null,
    approvalId: runtime.approvalId || null,
    verifiedAt: runtime.verifiedAt || null,
    lastError: runtime.lastError || null,
  }
}

function mergeRuntimeOutput(row: RuntimeStepRow, runtime: RuntimeStepMetadata, output: Record<string, unknown> = {}) {
  return { ...(row.output_json || {}), ...output, runtime }
}

function idempotencyKey(runId: string, stepKey: string) {
  return createHash('sha256').update(`${AUTONOMOUS_RUNTIME_VERSION}:${runId}:${stepKey}`).digest('hex')
}

function validatePlan(plan: AutonomousPlan) {
  if (!safe(plan.objective, 2000)) throw new Error('autonomous_objective_required')
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error('autonomous_plan_steps_required')
  const keys = new Set<string>()
  for (const step of plan.steps) {
    const key = safe(step.key, 160)
    if (!key || !safe(step.toolName, 180) || !safe(step.title, 240)) throw new Error('autonomous_step_invalid')
    if (keys.has(key)) throw new Error(`autonomous_duplicate_step:${key}`)
    keys.add(key)
  }
  for (const step of plan.steps) {
    for (const dep of step.dependsOn || []) if (!keys.has(dep)) throw new Error(`autonomous_missing_dependency:${step.key}:${dep}`)
  }
}

async function activity(telegramId: string, runId: string, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: telegramId,
    run_id: runId,
    event_type: eventType,
    message: safe(message, 900),
    metadata_json: metadata,
  })
  if (error) console.error('AUTONOMOUS_ACTIVITY_FAILED:', error.message)
}

export async function createAutonomousRun(params: {
  actor: AgentActor
  source: string
  plan: AutonomousPlan
}) {
  validatePlan(params.plan)
  const telegramId = String(params.actor.legacyTelegramId)
  const route = params.plan.route || selectSpecialistRoute(params.plan.objective)
  const now = new Date().toISOString()
  const { data: run, error } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: telegramId,
    type: 'autonomous',
    capability: route.primary,
    status: 'running',
    title: safe(params.plan.objective, 180),
    summary: 'Gogo created a persistent execution plan and started working on it.',
    progress: 1,
    why: `Gogo routed this outcome to ${route.primary}${route.supporting.length ? ` with ${route.supporting.join(', ')}` : ''}.`,
    source: safe(params.source, 100),
    metadata_json: {
      runtime_version: AUTONOMOUS_RUNTIME_VERSION,
      objective: safe(params.plan.objective, 4000),
      plan_revision: 1,
      route,
      state: 'executing',
      ...(params.plan.metadata || {}),
    },
    started_at: now,
    updated_at: now,
  }).select('id').single()
  if (error || !run?.id) throw new Error(`autonomous_run_create_failed:${error?.message || 'unknown'}`)
  const runId = String(run.id)

  const rows = params.plan.steps.map((step, index) => ({
    telegram_id: telegramId,
    run_id: runId,
    ordinal: index + 1,
    tool_name: safe(step.toolName, 180),
    title: safe(step.title, 240),
    status: 'queued',
    output_json: {
      runtime: {
        stepKey: safe(step.key, 160),
        dependsOn: (step.dependsOn || []).map((x) => safe(x, 160)).filter(Boolean),
        lane: safe(step.lane || 'default', 80),
        maxAttempts: Math.max(1, Math.min(10, Number(step.maxAttempts || DEFAULT_MAX_ATTEMPTS))),
        attempt: 0,
        requiresApproval: Boolean(step.requiresApproval),
        verificationRequired: Boolean(step.verificationRequired),
        mutation: Boolean(step.mutation),
        idempotencyKey: idempotencyKey(runId, step.key),
        leaseUntil: null,
        retryAt: null,
        approvalId: null,
      } satisfies RuntimeStepMetadata,
    },
  }))
  const { error: stepError } = await supabaseAdmin.from('agent_steps').insert(rows)
  if (stepError) {
    await Promise.resolve(supabaseAdmin.from('agent_runs').update({ status: 'failed', error: `step_create_failed:${stepError.message}`, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', runId).eq('telegram_id', telegramId)).catch(() => {})
    throw new Error(`autonomous_steps_create_failed:${stepError.message}`)
  }
  await activity(telegramId, runId, 'autonomous_plan_created', `Gogo created a ${rows.length}-step persistent plan.`, {
    runtime_version: AUTONOMOUS_RUNTIME_VERSION,
    route,
    steps: rows.map((row) => ({ ordinal: row.ordinal, tool: row.tool_name, title: row.title })),
  })
  return { runId, route }
}

export function readyAutonomousSteps(rows: RuntimeStepRow[], now = new Date()) {
  const byKey = new Map(rows.map((row) => [runtimeMeta(row).stepKey, row]))
  const runningLanes = new Set(rows.filter((row) => row.status === 'running').map((row) => runtimeMeta(row).lane))
  return rows
    .filter((row) => row.status === 'queued')
    .filter((row) => {
      const meta = runtimeMeta(row)
      if (meta.retryAt && Date.parse(meta.retryAt) > now.getTime()) return false
      if (meta.approvalId) return false
      if (runningLanes.has(meta.lane)) return false
      return meta.dependsOn.every((dep) => byKey.get(dep)?.status === 'completed')
    })
    .sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
}

export async function loadAutonomousRun(runId: string, telegramId: string) {
  const [{ data: run, error: runError }, { data: steps, error: stepError }] = await Promise.all([
    supabaseAdmin.from('agent_runs').select('id,status,title,summary,progress,metadata_json,error,started_at,completed_at,updated_at').eq('id', runId).eq('telegram_id', telegramId).maybeSingle(),
    supabaseAdmin.from('agent_steps').select('id,run_id,ordinal,tool_name,title,status,output_json,error,started_at,completed_at').eq('run_id', runId).eq('telegram_id', telegramId).order('ordinal', { ascending: true }),
  ])
  if (runError) throw new Error(`autonomous_run_read_failed:${runError.message}`)
  if (stepError) throw new Error(`autonomous_steps_read_failed:${stepError.message}`)
  if (!run) throw new Error('autonomous_run_missing')
  return { run, steps: (steps || []) as RuntimeStepRow[] }
}

async function claimStep(row: RuntimeStepRow, telegramId: string) {
  const meta = runtimeMeta(row)
  const attempt = meta.attempt + 1
  const nextMeta: RuntimeStepMetadata = { ...meta, attempt, leaseUntil: isoPlusMinutes(DEFAULT_LEASE_MINUTES), retryAt: null, lastError: null }
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('agent_steps').update({
    status: 'running',
    started_at: now,
    error: null,
    output_json: mergeRuntimeOutput(row, nextMeta),
  }).eq('id', row.id).eq('telegram_id', telegramId).eq('status', 'queued').select('id').maybeSingle()
  if (error) throw new Error(`autonomous_step_claim_failed:${error.message}`)
  return data?.id ? nextMeta : null
}

async function markCompleted(row: RuntimeStepRow, telegramId: string, meta: RuntimeStepMetadata, output: Record<string, unknown> = {}, verified = true) {
  const now = new Date().toISOString()
  const nextMeta: RuntimeStepMetadata = { ...meta, leaseUntil: null, retryAt: null, approvalId: null, verifiedAt: verified ? now : null, lastError: null }
  const { error } = await supabaseAdmin.from('agent_steps').update({
    status: 'completed',
    completed_at: now,
    error: null,
    output_json: mergeRuntimeOutput(row, nextMeta, output),
  }).eq('id', row.id).eq('telegram_id', telegramId).eq('status', 'running')
  if (error) throw new Error(`autonomous_step_complete_failed:${error.message}`)
}

async function markWaitingApproval(row: RuntimeStepRow, telegramId: string, meta: RuntimeStepMetadata, approvalId: string, output: Record<string, unknown> = {}) {
  const nextMeta: RuntimeStepMetadata = { ...meta, leaseUntil: null, retryAt: null, approvalId: safe(approvalId, 120), lastError: null }
  const { error } = await supabaseAdmin.from('agent_steps').update({
    status: 'queued',
    error: null,
    output_json: mergeRuntimeOutput(row, nextMeta, output),
  }).eq('id', row.id).eq('telegram_id', telegramId).eq('status', 'running')
  if (error) throw new Error(`autonomous_step_approval_wait_failed:${error.message}`)
}

async function markFailure(row: RuntimeStepRow, telegramId: string, meta: RuntimeStepMetadata, errorMessage: string, retryable: boolean, output: Record<string, unknown> = {}) {
  const message = safe(errorMessage, 500) || 'autonomous_step_failed'
  const canRetry = retryable && meta.attempt < meta.maxAttempts
  const retryAt = canRetry ? isoPlusMinutes(RETRY_MINUTES[Math.min(Math.max(meta.attempt - 1, 0), RETRY_MINUTES.length - 1)]) : null
  const nextMeta: RuntimeStepMetadata = { ...meta, leaseUntil: null, retryAt, approvalId: null, lastError: message }
  const { error } = await supabaseAdmin.from('agent_steps').update({
    status: canRetry ? 'queued' : 'failed',
    completed_at: canRetry ? null : new Date().toISOString(),
    error: message,
    output_json: mergeRuntimeOutput(row, nextMeta, output),
  }).eq('id', row.id).eq('telegram_id', telegramId).eq('status', 'running')
  if (error) throw new Error(`autonomous_step_failure_update_failed:${error.message}`)
  return { canRetry, retryAt }
}

async function reconcileRun(runId: string, telegramId: string) {
  const { run, steps } = await loadAutonomousRun(runId, telegramId)
  const total = Math.max(1, steps.length)
  const completed = steps.filter((step) => step.status === 'completed').length
  const failed = steps.filter((step) => step.status === 'failed')
  const waitingApproval = steps.some((step) => Boolean(runtimeMeta(step).approvalId))
  const progress = Math.min(100, Math.max(1, Math.round((completed / total) * 100)))
  const now = new Date().toISOString()

  if (completed === steps.length) {
    const { error } = await supabaseAdmin.from('agent_runs').update({ status: 'completed', progress: 100, summary: 'Gogo completed and verified the autonomous plan.', completed_at: now, updated_at: now, metadata_json: { ...((run.metadata_json as any) || {}), state: 'completed' } }).eq('id', runId).eq('telegram_id', telegramId)
    if (error) throw new Error(`autonomous_run_complete_failed:${error.message}`)
    await activity(telegramId, runId, 'autonomous_run_completed', 'Gogo completed and verified the full plan.', { completed_steps: completed, total_steps: total })
    return 'completed' as const
  }
  if (failed.length) {
    const { error } = await supabaseAdmin.from('agent_runs').update({ status: 'failed', progress, error: safe(failed[0].error, 500), completed_at: now, updated_at: now, metadata_json: { ...((run.metadata_json as any) || {}), state: 'failed' } }).eq('id', runId).eq('telegram_id', telegramId)
    if (error) throw new Error(`autonomous_run_fail_failed:${error.message}`)
    await activity(telegramId, runId, 'autonomous_run_failed', 'Gogo stopped because a step exhausted safe retries or hit a hard boundary.', { failed_step_ids: failed.map((step) => step.id) })
    return 'failed' as const
  }
  const status = waitingApproval ? 'waiting_approval' : 'running'
  const { error } = await supabaseAdmin.from('agent_runs').update({ status, progress, updated_at: now, metadata_json: { ...((run.metadata_json as any) || {}), state: waitingApproval ? 'waiting_approval' : 'executing' } }).eq('id', runId).eq('telegram_id', telegramId)
  if (error) throw new Error(`autonomous_run_reconcile_failed:${error.message}`)
  return status as 'waiting_approval' | 'running'
}

export async function executeAutonomousRun(params: {
  actor: AgentActor
  runId: string
  registry: AutonomousToolRegistry
  maxParallel?: number
}) {
  const telegramId = String(params.actor.legacyTelegramId)
  const { run, steps } = await loadAutonomousRun(params.runId, telegramId)
  if (['completed', 'failed', 'cancelled'].includes(String(run.status))) return { runId: params.runId, status: run.status, executed: 0 }
  const objective = safe((run.metadata_json as any)?.objective || run.title, 4000)
  const candidates = readyAutonomousSteps(steps).slice(0, Math.max(1, Math.min(8, Number(params.maxParallel || 3))))
  if (!candidates.length) return { runId: params.runId, status: await reconcileRun(params.runId, telegramId), executed: 0 }

  const executions = await Promise.all(candidates.map(async (row) => {
    const claimed = await claimStep(row, telegramId)
    if (!claimed) return { stepId: row.id, claimed: false }
    const handler = params.registry[row.tool_name]
    if (!handler) {
      await markFailure(row, telegramId, claimed, `autonomous_tool_missing:${row.tool_name}`, false)
      return { stepId: row.id, claimed: true, status: 'failed' }
    }
    await activity(telegramId, params.runId, 'autonomous_step_started', row.title, { step_id: row.id, step_key: claimed.stepKey, tool: row.tool_name, attempt: claimed.attempt, lane: claimed.lane })
    try {
      const result = await handler({ actor: params.actor, runId: params.runId, objective, step: row, runtime: claimed, idempotencyKey: claimed.idempotencyKey })
      if (result.status === 'waiting_approval') {
        await markWaitingApproval(row, telegramId, claimed, result.approvalId, result.output || {})
        await activity(telegramId, params.runId, 'autonomous_step_waiting_approval', row.title, { step_id: row.id, step_key: claimed.stepKey, approval_id: result.approvalId })
        return { stepId: row.id, claimed: true, status: result.status }
      }
      if (result.status === 'blocked') {
        await markFailure(row, telegramId, claimed, result.error, false, result.output || {})
        await activity(telegramId, params.runId, 'autonomous_step_blocked', row.title, { step_id: row.id, step_key: claimed.stepKey, error: safe(result.error, 300) })
        return { stepId: row.id, claimed: true, status: result.status }
      }
      if (result.status === 'retryable_failure') {
        const retry = await markFailure(row, telegramId, claimed, result.error, true, result.output || {})
        await activity(telegramId, params.runId, retry.canRetry ? 'autonomous_step_retry_scheduled' : 'autonomous_step_failed', row.title, { step_id: row.id, step_key: claimed.stepKey, error: safe(result.error, 300), retry_at: retry.retryAt })
        return { stepId: row.id, claimed: true, status: retry.canRetry ? 'retrying' : 'failed' }
      }
      const verified = result.verified === true || !claimed.verificationRequired
      if (!verified) {
        const retry = await markFailure(row, telegramId, claimed, 'autonomous_verification_failed', true, result.output || {})
        await activity(telegramId, params.runId, retry.canRetry ? 'autonomous_verification_retry' : 'autonomous_verification_failed', row.title, { step_id: row.id, step_key: claimed.stepKey, retry_at: retry.retryAt })
        return { stepId: row.id, claimed: true, status: retry.canRetry ? 'retrying' : 'failed' }
      }
      await markCompleted(row, telegramId, claimed, result.output || {}, verified)
      await activity(telegramId, params.runId, 'autonomous_step_completed', row.title, { step_id: row.id, step_key: claimed.stepKey, tool: row.tool_name, verified })
      return { stepId: row.id, claimed: true, status: 'completed' }
    } catch (error: any) {
      const retry = await markFailure(row, telegramId, claimed, safe(error?.message || error, 500), true)
      await activity(telegramId, params.runId, retry.canRetry ? 'autonomous_step_retry_scheduled' : 'autonomous_step_failed', row.title, { step_id: row.id, step_key: claimed.stepKey, error: safe(error?.message || error, 300), retry_at: retry.retryAt })
      return { stepId: row.id, claimed: true, status: retry.canRetry ? 'retrying' : 'failed' }
    }
  }))

  const status = await reconcileRun(params.runId, telegramId)
  return { runId: params.runId, status, executed: executions.filter((item) => item.claimed).length, executions }
}

export async function releaseApprovedAutonomousStep(params: { actor: AgentActor; runId: string; stepKey: string }) {
  const telegramId = String(params.actor.legacyTelegramId)
  const { steps } = await loadAutonomousRun(params.runId, telegramId)
  const row = steps.find((step) => runtimeMeta(step).stepKey === params.stepKey)
  if (!row) throw new Error('autonomous_step_missing')
  const meta = runtimeMeta(row)
  if (!meta.approvalId) throw new Error('autonomous_step_not_waiting_approval')
  const { data: approval, error } = await supabaseAdmin.from('agent_approvals').select('id,status').eq('id', meta.approvalId).eq('telegram_id', telegramId).maybeSingle()
  if (error) throw new Error(`autonomous_approval_read_failed:${error.message}`)
  if (!approval || approval.status !== 'approved') throw new Error('autonomous_approval_required')
  const nextMeta: RuntimeStepMetadata = { ...meta, approvalId: null, retryAt: null, leaseUntil: null }
  const { error: updateError } = await supabaseAdmin.from('agent_steps').update({ output_json: mergeRuntimeOutput(row, nextMeta) }).eq('id', row.id).eq('telegram_id', telegramId).eq('status', 'queued')
  if (updateError) throw new Error(`autonomous_approval_release_failed:${updateError.message}`)
  await activity(telegramId, params.runId, 'autonomous_approval_released', row.title, { step_id: row.id, step_key: params.stepKey, approval_id: approval.id })
  await reconcileRun(params.runId, telegramId)
}

export async function recoverStaleAutonomousSteps(params: { actor: AgentActor; runId: string; staleMinutes?: number }) {
  const telegramId = String(params.actor.legacyTelegramId)
  const staleBefore = new Date(Date.now() - Math.max(2, Number(params.staleMinutes || DEFAULT_LEASE_MINUTES)) * 60_000).toISOString()
  const { data, error } = await supabaseAdmin.from('agent_steps').select('id,run_id,ordinal,tool_name,title,status,output_json,error,started_at,completed_at').eq('run_id', params.runId).eq('telegram_id', telegramId).eq('status', 'running').lte('started_at', staleBefore)
  if (error) throw new Error(`autonomous_stale_read_failed:${error.message}`)
  let recovered = 0
  for (const row of (data || []) as RuntimeStepRow[]) {
    const meta = runtimeMeta(row)
    const retryAt = isoPlusMinutes(RETRY_MINUTES[Math.min(Math.max(meta.attempt - 1, 0), RETRY_MINUTES.length - 1)])
    const nextMeta: RuntimeStepMetadata = { ...meta, leaseUntil: null, retryAt, lastError: 'stale_worker_recovered' }
    const { data: updated, error: updateError } = await supabaseAdmin.from('agent_steps').update({ status: 'queued', error: 'stale_worker_recovered', output_json: mergeRuntimeOutput(row, nextMeta) }).eq('id', row.id).eq('telegram_id', telegramId).eq('status', 'running').select('id').maybeSingle()
    if (updateError) throw new Error(`autonomous_stale_recover_failed:${updateError.message}`)
    if (updated?.id) recovered++
  }
  if (recovered) await activity(telegramId, params.runId, 'autonomous_run_resumed', `Gogo recovered ${recovered} stale execution step${recovered === 1 ? '' : 's'} after an interruption.`, { recovered })
  await reconcileRun(params.runId, telegramId)
  return { recovered }
}

export async function appendAutonomousReplan(params: { actor: AgentActor; runId: string; reason: string; steps: AutonomousPlanStep[] }) {
  if (!params.steps.length) return { added: 0 }
  const telegramId = String(params.actor.legacyTelegramId)
  const { run, steps: existing } = await loadAutonomousRun(params.runId, telegramId)
  const existingKeys = new Set(existing.map((step) => runtimeMeta(step).stepKey))
  for (const step of params.steps) {
    if (existingKeys.has(step.key)) throw new Error(`autonomous_duplicate_replan_step:${step.key}`)
    for (const dep of step.dependsOn || []) if (!existingKeys.has(dep) && !params.steps.some((candidate) => candidate.key === dep)) throw new Error(`autonomous_missing_replan_dependency:${step.key}:${dep}`)
  }
  const startOrdinal = existing.reduce((max, step) => Math.max(max, Number(step.ordinal || 0)), 0)
  const rows = params.steps.map((step, index) => ({
    telegram_id: telegramId,
    run_id: params.runId,
    ordinal: startOrdinal + index + 1,
    tool_name: safe(step.toolName, 180),
    title: safe(step.title, 240),
    status: 'queued',
    output_json: { runtime: { stepKey: safe(step.key, 160), dependsOn: step.dependsOn || [], lane: safe(step.lane || 'default', 80), maxAttempts: Math.max(1, Math.min(10, Number(step.maxAttempts || DEFAULT_MAX_ATTEMPTS))), attempt: 0, requiresApproval: Boolean(step.requiresApproval), verificationRequired: Boolean(step.verificationRequired), mutation: Boolean(step.mutation), idempotencyKey: idempotencyKey(params.runId, step.key), leaseUntil: null, retryAt: null, approvalId: null } satisfies RuntimeStepMetadata },
  }))
  const { error } = await supabaseAdmin.from('agent_steps').insert(rows)
  if (error) throw new Error(`autonomous_replan_steps_failed:${error.message}`)
  const meta:any=run.metadata_json||{}
  const revision=Math.max(1,Number(meta.plan_revision||1))+1
  const { error: runError } = await supabaseAdmin.from('agent_runs').update({ metadata_json:{...meta,plan_revision:revision,state:'executing',last_replan_reason:safe(params.reason,500)},status:'running',completed_at:null,updated_at:new Date().toISOString() }).eq('id',params.runId).eq('telegram_id',telegramId)
  if(runError)throw new Error(`autonomous_replan_run_failed:${runError.message}`)
  await activity(telegramId,params.runId,'autonomous_plan_revised',`Gogo revised the plan and added ${rows.length} step${rows.length===1?'':'s'}.`,{reason:safe(params.reason,500),plan_revision:revision,added_steps:rows.map(row=>({tool:row.tool_name,title:row.title}))})
  return{added:rows.length,planRevision:revision}
}

