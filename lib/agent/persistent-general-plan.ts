import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { planGeneralAgentRequest, type GeneralPlanStep } from './general-planner'
import {
  executeVerifiedMissionList,
  executeVerifiedMissionMemory,
  executeVerifiedMissionReminder,
  executeVerifiedMissionWebSearch,
} from './mission-tools'
import { dispatchThroughSameBrain } from './same-brain'
import {
  createAutonomousRun,
  executeAutonomousRun,
  recoverStaleAutonomousSteps,
  type AutonomousPlan,
  type AutonomousToolContext,
  type AutonomousToolRegistry,
} from './autonomous-runtime'

const PERSISTENT_SAFE_TOOLS = new Set(['memory','files','reminders','lists','tasks','web_search','travel'])
const TERMINAL_RUN_STATES = new Set(['completed','failed','cancelled'])

function safe(value: unknown, max = 1800) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function stepKey(index: number, step: GeneralPlanStep) {
  return `step-${index + 1}-${step.tool}`
}

function supportsPersistentSafePlan(steps: GeneralPlanStep[]) {
  return steps.length >= 2 && steps.every((step) => PERSISTENT_SAFE_TOOLS.has(step.tool))
}

async function runMetadata(runId: string, actor: AgentActor) {
  const { data, error } = await supabaseAdmin.from('agent_runs')
    .select('status,summary,progress,metadata_json')
    .eq('id', runId)
    .eq('telegram_id', String(actor.legacyTelegramId))
    .maybeSingle()
  if (error) throw new Error(`persistent_plan_read_failed:${error.message}`)
  if (!data) throw new Error('persistent_plan_run_missing')
  return data as any
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

async function verifiedSameBrainRead(context: AutonomousToolContext, step: GeneralPlanStep) {
  const result = await dispatchThroughSameBrain({
    actor: context.actor,
    text: step.instruction,
    messageId: `persistent-${context.idempotencyKey.slice(0, 24)}`,
  })
  return {
    status: 'completed' as const,
    verified: true,
    output: {
      reply: safe(result.text, 3500),
      handledBy: result.handledBy,
      mediaUrl: result.mediaUrl || null,
      mediaType: result.mediaType || null,
    },
  }
}

function registryFor(missionText: string): AutonomousToolRegistry {
  const handler = async (context: AutonomousToolContext) => {
    const step = await loadDefinition(context)
    if (step.tool === 'memory') {
      const result = await executeVerifiedMissionMemory({ actor: context.actor, step, missionText, messageId: `persistent-${context.idempotencyKey.slice(0,24)}` })
      return { status:'completed' as const, verified:true, output:{ ...result.output, text:safe(result.text,3500) } }
    }
    if (step.tool === 'lists') {
      const result = await executeVerifiedMissionList({ actor: context.actor, step, missionText })
      return { status:'completed' as const, verified:true, output:{ ...result.output, text:safe(result.text,3500) } }
    }
    if (step.tool === 'reminders') {
      const result = await executeVerifiedMissionReminder({ actor: context.actor, step, missionText, messageId: `persistent-${context.idempotencyKey.slice(0,24)}` })
      return { status:'completed' as const, verified:true, output:{ ...result.output, text:safe(result.text,3500) } }
    }
    if (step.tool === 'web_search') {
      const result = await executeVerifiedMissionWebSearch(step)
      return { status:'completed' as const, verified:true, output:{ ...result.output, text:safe(result.text,3500) } }
    }
    return verifiedSameBrainRead(context, step)
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

async function drivePersistentRun(actor: AgentActor, runId: string, missionText: string, maxWaves = 10) {
  await recoverStaleAutonomousSteps({ actor, runId }).catch(() => ({ recovered:0 }))
  let lastStatus = 'running'
  let executedTotal = 0
  for (let wave = 0; wave < maxWaves; wave++) {
    const result = await executeAutonomousRun({ actor, runId, registry: registryFor(missionText), maxParallel: 3 })
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
  return { runId:params.runId, ...(await drivePersistentRun(params.actor, params.runId, missionText, params.maxWaves || 10)) }
}

export async function tryRunPersistentGeneralPlan(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
  messageId?: string | number | null
}) {
  const plan = await planGeneralAgentRequest(params.text)
  if (!plan || !supportsPersistentSafePlan(plan.steps)) return null

  const steps = plan.steps.map((step, index) => ({
    key: stepKey(index, step),
    title: step.title,
    toolName: toolName(step),
    dependsOn: index === 0 ? [] : [stepKey(index - 1, plan.steps[index - 1])],
    lane: step.tool === 'web_search' || step.tool === 'travel' ? 'research' : step.tool,
    maxAttempts: 4,
    requiresApproval: false,
    verificationRequired: true,
    mutation: ['reminders','lists','tasks'].includes(step.tool),
  }))

  const runtimePlan: AutonomousPlan = {
    objective: plan.title || params.text,
    steps,
    metadata: {
      input_text: safe(params.text, 2000),
      planner: 'general-planner',
      persistent_general_plan: true,
      persistent_plan_reason: safe(plan.reason, 600),
      persistent_plan_steps: plan.steps,
      message_id: params.messageId || null,
    },
  }
  const created = await createAutonomousRun({ actor: params.actor, source: params.surface, plan: runtimePlan })
  const executed = await drivePersistentRun(params.actor, created.runId, params.text, 10)
  const run = await runMetadata(created.runId, params.actor)

  return {
    runId: created.runId,
    status: run.status || executed.status,
    capability: created.route.primary,
    risk: 'low' as const,
    text: run.summary || 'Gogo created a persistent plan and started executing it.',
    handledBy: 'persistent-general-plan' as const,
    persistent: true,
    runtimeVersion: 'gogo-autonomous-v1',
    progress: Number(run.progress || 1),
  }
}
