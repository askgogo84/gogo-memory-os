import { readPersistentFlightResult } from './persistent-flight-result'
import { recordTaskModelUsage } from './model-usage'
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { prepareGeneralPlan, executeTaskStep, taskStepIntent, type PreparedGeneralPlan, type GeneralPlanStep } from './general-planner'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import {
  executeVerifiedMissionList,
  executeVerifiedMissionMemory,
  executeVerifiedMissionReminder,
  executeVerifiedMissionWebSearch,
} from './mission-tools'
import { executeExactNamedPersistentList, hasExplicitNamedListIntent } from './persistent-list-verifier'
import { executePersistentTravelRead, persistentTravelFailureReply } from './persistent-travel-read'
import { executePersistentDriveRead, persistentDriveFailureReply } from './persistent-drive-read'
import {
  createAutonomousRun,
  executeAutonomousRun,
  recoverStaleAutonomousSteps,
  type AutonomousPlan,
  type AutonomousToolContext,
  type AutonomousToolRegistry,
} from './autonomous-runtime'

const PERSISTENT_SAFE_TOOLS = new Set(['memory','files','reminders','lists','tasks','web_search','travel'])
const TERMINAL_RUN_STATES = new Set(['completed','failed','cancelled','outcome_unknown'])
const DUPLICATE_WINDOW_MINUTES = 10

function safe(value: unknown, max = 1800) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}
function normalizedMission(value:unknown){return safe(value,4000).toLowerCase()}
function missionFingerprint(value:unknown){return createHash('sha256').update(normalizedMission(value)).digest('hex')}

function persistentRunReply(run: {status?: unknown; summary?: unknown; error?: unknown}, fallback: string) {
  if (run.status === 'outcome_unknown') return 'I couldn’t confirm the result of this request. I haven’t retried it because an earlier step may already have completed.'
  if (run.status === 'failed') return persistentDriveFailureReply(run.error) || persistentTravelFailureReply(run.error) || 'I couldn’t finish this request. Check the task details for the step that stopped.'
  return safe(run.summary || fallback)
}

async function persistentResultReply(actor: AgentActor, runId: string, run: {status?: unknown;summary?: unknown;error?: unknown;metadata_json?: {persistent_plan_steps?: unknown}}, fallback: string) {
  const definitions=run.metadata_json?.persistent_plan_steps
  if (run.status === 'completed' && Array.isArray(definitions) && definitions.some(step=>step?.tool === 'travel')) {
    const result=await readPersistentFlightResult(actor,runId)
    if (result) return result
    return 'I couldn’t display the flight results. Check this task’s current status and details before trying again.'
  }
  return persistentRunReply(run,fallback)
}

function stepKey(index: number, step: GeneralPlanStep) {
  return `step-${index + 1}-${step.tool}`
}

function supportsPersistentSafePlan(steps: GeneralPlanStep[]) {
  return steps.length >= 2 && steps.every((step) => PERSISTENT_SAFE_TOOLS.has(step.tool))
}

async function runMetadata(runId: string, actor: AgentActor) {
  const { data, error } = await supabaseAdmin.from('agent_runs')
    .select('status,error,summary,progress,metadata_json')
    .eq('id', runId)
    .eq('telegram_id', String(actor.legacyTelegramId))
    .maybeSingle()
  if (error) throw new Error(`persistent_plan_read_failed:${error.message}`)
  if (!data) throw new Error('persistent_plan_run_missing')
  return data as any
}

async function findRecentDuplicate(actor:AgentActor,text:string){
  const fingerprint=missionFingerprint(text)
  const cutoff=new Date(Date.now()-DUPLICATE_WINDOW_MINUTES*60_000).toISOString()
  const {data,error}=await supabaseAdmin.from('agent_runs')
    .select('id,status,summary,progress,metadata_json,started_at')
    .eq('telegram_id',String(actor.legacyTelegramId))
    .gte('started_at',cutoff)
    .in('status',['queued','running','waiting_approval','completed','outcome_unknown'])
    .order('started_at',{ascending:false})
    .limit(20)
  if(error)throw new Error(`persistent_duplicate_read_failed:${error.message}`)
  return (data||[]).find((row:any)=>String(row?.metadata_json?.mission_fingerprint||'')===fingerprint)||null
}

async function loadDefinition(context: AutonomousToolContext): Promise<GeneralPlanStep> {
  const data = await runMetadata(context.runId, context.actor)
  const definitions = Array.isArray(data?.metadata_json?.persistent_plan_steps)
    ? data.metadata_json.persistent_plan_steps
    : []
  const index = Number(String(context.runtime.stepKey).match(/^step-(\d+)-/)?.[1] || 0) - 1
  const raw = definitions[index]
  if (!raw?.tool || !raw?.instruction || !raw?.title) throw new Error('persistent_plan_step_definition_missing')
  return {
    tool: raw.tool,
    title: safe(raw.title, 160),
    instruction: safe(raw.instruction, 1200),
    artifactType: raw.artifactType,
    artifactTitle: raw.artifactTitle,
  } as GeneralPlanStep
}

async function verifiedTaskStep(context: AutonomousToolContext, step: GeneralPlanStep) {
  const intent = taskStepIntent(step)
  if (intent !== 'read' && intent !== 'write') return { status:'blocked' as const, error:'persistent_task_action_ambiguous' }
  const {data, error} = await supabaseAdmin.from('agent_permissions').select('level')
    .eq('telegram_id', String(context.actor.legacyTelegramId)).eq('capability', 'tasks').maybeSingle()
  // These failures happen before the executor, so they do not imply an uncertain task write.
  if (error) return { status:'blocked' as const, error:'persistent_task_permission_unavailable' }
  const level = data?.level ?? 'auto'
  if (!['off','read','draft','ask','auto'].includes(level)) return { status:'blocked' as const, error:'persistent_task_permission_invalid' }
  const policy = evaluateAgentExecutionPolicy({capability:'tasks', permissionLevel:level as AgentPermissionLevel,
    mode:intent === 'read' ? 'read' : 'execute', risk:'low', irreversible:false,
    // Match the existing general planner's explicit reversible private-task policy.
    // This never supplies an approval to an external or consequential adapter.
    approvalStatus:intent === 'write' ? 'approved' : null})
  if (!policy.allowed) return { status:'blocked' as const, error:`persistent_task_${policy.reason}` }
  const current = await runMetadata(context.runId, context.actor)
  if (TERMINAL_RUN_STATES.has(String(current.status))) return { status:'blocked' as const, error:'persistent_task_parent_terminal' }
  const result = await executeTaskStep(context.actor, step)
  const output = result.output as Record<string, unknown>
  const verified = output.verifiedStore === 'todos' && (intent === 'read'
    ? output.readOnly === true && Array.isArray(output.tasks)
    : typeof output.todoId === 'string' && output.todoId.length > 0)
  return { status:'completed' as const, verified, output:{...output, text:safe(result.text,3500)} }
}

function registryFor(missionText: string): AutonomousToolRegistry {
  const handler = async (context: AutonomousToolContext) => {
    const step = await loadDefinition(context)
    if (step.tool === 'tasks') return verifiedTaskStep(context, step)
    if (step.tool === 'files') return executePersistentDriveRead(context, step)
    if (step.tool === 'travel') return executePersistentTravelRead(context, step)
    if (step.tool === 'memory') {
      const result = await executeVerifiedMissionMemory({ actor: context.actor, step, missionText, messageId: `persistent-${context.idempotencyKey.slice(0,24)}` })
      return { status:'completed' as const, verified:true, output:{ ...result.output, text:safe(result.text,3500) } }
    }
    if (step.tool === 'lists') {
      const result = hasExplicitNamedListIntent(step,missionText)
        ? await executeExactNamedPersistentList({ actor:context.actor,step,missionText })
        : await executeVerifiedMissionList({ actor: context.actor, step, missionText })
      const verified=Boolean((result.output as any)?.verifiedStore==='lists') && (!hasExplicitNamedListIntent(step,missionText) || Boolean((result.output as any)?.verifiedExactName&&(result.output as any)?.verifiedRequestedItems))
      return { status:'completed' as const, verified, output:{ ...result.output, text:safe(result.text,3500) } }
    }
    if (step.tool === 'reminders') {
      const result = await executeVerifiedMissionReminder({ actor: context.actor, step, missionText, messageId: `persistent-${context.idempotencyKey.slice(0,24)}` })
      return { status:'completed' as const, verified:true, output:{ ...result.output, text:safe(result.text,3500) } }
    }
    if (step.tool === 'web_search') {
      const result = await executeVerifiedMissionWebSearch(step)
      return { status:'completed' as const, verified:true, output:{ ...result.output, text:safe(result.text,3500) } }
    }
    return {status:'blocked' as const,error:'persistent_plan_unsupported_tool'}
  }
  return {
    'memory.verified': handler,
    'lists.verified': handler,
    'reminders.verified': handler,
    'web_search.verified': handler,
    'files.read': handler,
    'tasks.safe': handler,
    'travel.read': handler,
  }
}

function toolName(step: GeneralPlanStep) {
  if (step.tool === 'memory') return 'memory.verified'
  if (step.tool === 'lists') return 'lists.verified'
  if (step.tool === 'reminders') return 'reminders.verified'
  if (step.tool === 'web_search') return 'web_search.verified'
  if (step.tool === 'files') return 'files.read'
  if (step.tool === 'tasks') return 'tasks.safe'
  return 'travel.read'
}

// notifyOutcome: only the background resume path sends the one outcome message; the live request replies itself.
async function drivePersistentRun(actor: AgentActor, runId: string, missionText: string, maxWaves = 10, notifyOutcome = false) {
  await recoverStaleAutonomousSteps({ actor, runId, notifyOutcome }).catch(() => ({ recovered:0 }))
  let lastStatus = 'running'
  let executedTotal = 0
  for (let wave = 0; wave < maxWaves; wave++) {
    const result = await executeAutonomousRun({ actor, runId, registry: registryFor(missionText), maxParallel: 3, notifyOutcome })
    executedTotal += Number(result.executed || 0)
    lastStatus = String(result.status || lastStatus)
    if (TERMINAL_RUN_STATES.has(lastStatus) || lastStatus === 'waiting_approval') break
    if (!result.executed) break
  }
  return { status:lastStatus, executed:executedTotal }
}

export async function resumePersistentGeneralPlan(params:{actor:AgentActor;runId:string;maxWaves?:number}) {
  const run = await runMetadata(params.runId, params.actor)
  const meta:any = run.metadata_json || {}
  if (!meta.persistent_general_plan) throw new Error('not_persistent_general_plan')
  if (TERMINAL_RUN_STATES.has(String(run.status))) return { runId:params.runId,status:String(run.status),executed:0 }
  const missionText = safe(meta.input_text || meta.objective || '', 2000)
  return { runId:params.runId, ...(await drivePersistentRun(params.actor, params.runId, missionText, params.maxWaves || 10, true)) }
}

export async function tryRunPersistentGeneralPlan(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
  messageId?: string | number | null
  prepared?: PreparedGeneralPlan
}) {
  const {plan,modelUsage,startedAt}=params.prepared||await prepareGeneralPlan(params.text)
  if (!plan || !supportsPersistentSafePlan(plan.steps)) return null

  const duplicate=await findRecentDuplicate(params.actor,params.text)
  if(duplicate?.id){
    await recordTaskModelUsage(params.actor.legacyTelegramId,String(duplicate.id),modelUsage).catch(()=>{})
    return {
      runId:String(duplicate.id),status:String(duplicate.status||'running'),capability:'orchestrator',risk:'low' as const,
      text:await persistentResultReply(params.actor,String(duplicate.id),duplicate,'I’m already working on this same request.'),handledBy:'persistent-general-plan' as const,
      persistent:true,runtimeVersion:'gogo-autonomous-v1',progress:Number(duplicate.progress||1),deduplicated:true,
    }
  }

  const steps = plan.steps.map((step, index) => ({
    key: stepKey(index, step),
    title: step.title,
    toolName: toolName(step),
    dependsOn: index === 0 ? [] : [stepKey(index - 1, plan.steps[index - 1])],
    lane: step.tool === 'web_search' || step.tool === 'travel' ? 'research' : step.tool,
    maxAttempts: 4,
    requiresApproval: false,
    verificationRequired: true,
    mutation: ['reminders','lists'].includes(step.tool) || (step.tool === 'tasks' && taskStepIntent(step) !== 'read'),
  }))

  const runtimePlan: AutonomousPlan = {
    objective: plan.title || params.text,
    steps,
    metadata: {
      input_text: safe(params.text, 2000),
      mission_fingerprint: missionFingerprint(params.text),
      planner: 'general-planner',
      persistent_general_plan: true,
      persistent_plan_reason: safe(plan.reason, 600),
      persistent_plan_steps: plan.steps,
      message_id: params.messageId || null,
    },
  }
  const created = await createAutonomousRun({ actor: params.actor, source: params.surface, plan: runtimePlan })
  await supabaseAdmin.from('agent_runs').update({started_at:startedAt}).eq('id',created.runId).eq('telegram_id',String(params.actor.legacyTelegramId))
  await recordTaskModelUsage(params.actor.legacyTelegramId,created.runId,modelUsage).catch(()=>{})
  const executed = await drivePersistentRun(params.actor, created.runId, params.text, 10)
  const run = await runMetadata(created.runId, params.actor)

  return {
    runId: created.runId,
    status: run.status || executed.status,
    capability: created.route.primary,
    risk: 'low' as const,
    text: await persistentResultReply(params.actor,created.runId,run,'I started working through this request.'),
    handledBy: 'persistent-general-plan' as const,
    persistent: true,
    runtimeVersion: 'gogo-autonomous-v1',
    progress: Number(run.progress || 1),
  }
}

