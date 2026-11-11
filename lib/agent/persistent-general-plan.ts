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
  executeExactMissionReminder,
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
    // A mixed plan (flights + a reminder or list) still confirms its other steps (release review, 22 Oct).
    const others=definitions.filter(step=>step?.tool !== 'travel').length
    if (result) return others && run.summary ? `${result}\n\n${safe(run.summary)}` : result
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
  if (verified && intent === 'write') await recordGoalVerification(context, 'todo_readback', { todoId: String(output.todoId || '') })
  return { status:'completed' as const, verified, output:{...output, text:safe(result.text,3500)} }
}

/** Addendum 5, independent verification: records on a goal's run that code read its result back from where it was
 *  saved (the named check), so Tasks can show "Done, checked". Only for runs started from a goal list, only with a
 *  check named in task-ownership.ts, never on a model's say-so. Best effort: a failed write leaves "not checked". */
async function recordGoalVerification(context: AutonomousToolContext, check: 'reminder_readback' | 'todo_readback', evidence: Record<string, unknown>) {
  try {
    const run = await runMetadata(context.runId, context.actor)
    const meta: any = run?.metadata_json || {}
    if (!meta.goal_batch_id) return
    await supabaseAdmin.from('agent_runs').update({ metadata_json: { ...meta, verification: { state: 'verified_completed', check, at: new Date().toISOString(), evidence } } })
      .eq('id', context.runId).eq('telegram_id', String(context.actor.legacyTelegramId))
  } catch { /* stays "done, not checked" */ }
}

function registryFor(missionText: string): AutonomousToolRegistry {
  const handler = async (context: AutonomousToolContext) => {
    const step = await loadDefinition(context)
    if (step.tool === 'tasks') return verifiedTaskStep(context, step)
    if (step.tool === 'files') return executePersistentDriveRead(context, step)
    if (step.tool === 'travel') return executePersistentTravelRead(context, step, missionText)
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
      // Goal intake gives the day, time and words as checked values (startPersistentGoalRun), never as a sentence.
      const exact = (await runMetadata(context.runId, context.actor))?.metadata_json?.goal_reminder
      if (exact && typeof exact === 'object') {
        // The same off switch the chat path honours (whatsapp-bridge.ts), checked here so a resumed run obeys it too.
        const { capabilityIsOff } = await import('./adaptive-autonomy')
        if (await capabilityIsOff(context.actor.legacyTelegramId, 'reminders')) return { status:'blocked' as const, error:'persistent_reminder_permission_off' }
        const result = await executeExactMissionReminder({ actor: context.actor, date: String(exact.date || ''), time: String(exact.time || ''), message: String(exact.message || '') })
        if ((result.output as any)?.readBack === true) await recordGoalVerification(context, 'reminder_readback', { reminderId: String((result.output as any).reminderId || ''), remindAt: String((result.output as any).remindAt || '') })
        return { status:'completed' as const, verified:(result.output as any)?.readBack === true, output:{ ...result.output, text:safe(result.text,3500) } }
      }
      const result = await executeVerifiedMissionReminder({ actor: context.actor, step, missionText, messageId: `persistent-${context.idempotencyKey.slice(0,24)}` })
      return { status:'completed' as const, verified:true, output:{ ...result.output, text:safe(result.text,3500) } }
    }
    if (step.tool === 'web_search') {
      // A research goal from a list (goal-intake.ts): several searches and an answer that cites what they returned.
      // Done only when sources were found; an empty result is not a finished task. It is shown as "done, not
      // checked": finding sources is not a check that the answer drawn from them is right.
      if ((await runMetadata(context.runId, context.actor))?.metadata_json?.goal_kind === 'research') {
        // The same switch the planner honours for web search (general-planner.ts).
        const { capabilityIsOff } = await import('./adaptive-autonomy')
        if (await capabilityIsOff(context.actor.legacyTelegramId, 'browser')) return { status:'blocked' as const, error:'persistent_browser_permission_off' }
        const { runDeepResearch } = await import('./deep-research')
        const out = await runDeepResearch(step.instruction)
        const sources = (out.sources || []).slice(0, 8).map(s => ({ title: safe(s.title, 160), url: safe(s.url, 400) })).filter(s => /^https?:\/\//.test(s.url))
        if (!sources.length) return { status:'blocked' as const, error:'goal_research_no_sources', output:{ text:safe(out.text,1200) } }
        return { status:'completed' as const, verified:true, output:{ text:String(out.text || '').replace(/[ \t]+/g,' ').trim().slice(0,3500), sources, verifiedStore:'web_sources' } }
      }
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
  // A goal given in the dashboard chat is never announced on WhatsApp: its outcome is written to the web conversation
  // (once: a finished run returns above) and shown on Tasks › Overview.
  if (meta.goal_surface === 'web') {
    const result = await drivePersistentRun(params.actor, params.runId, missionText, params.maxWaves || 10, false)
    const title = safe(meta.goal_title || meta.objective || 'Your task', 120)
    const line = result.status === 'completed' ? `✅ ${title}: finished. The result is on your Tasks page.`
      : ['failed', 'blocked', 'outcome_unknown', 'cancelled'].includes(String(result.status)) ? `⚠️ ${title}: I could not finish this. The details are on your Tasks page.` : ''
    // Written once: only the caller that sets the marker on the run writes the line.
    // The run has already finished: a failure to write this line is logged and never fails the run or the sweep.
    const latest = line ? await runMetadata(params.runId, params.actor).catch(() => null) : null
    const { data: claimed, error: claimError } = latest && !(latest.metadata_json as any)?.goal_web_outcome_at
      ? await supabaseAdmin.from('agent_runs').update({ metadata_json: { ...((latest.metadata_json as any) || {}), goal_web_outcome_at: new Date().toISOString() } }).eq('id', params.runId).eq('telegram_id', String(params.actor.legacyTelegramId)).is('metadata_json->>goal_web_outcome_at', null).select('id')
      : { data: null, error: null }
    if (claimError) console.error('GOAL_WEB_OUTCOME_CLAIM_FAILED:', String(claimError.code || 'error').slice(0, 20))
    if (line && Array.isArray(claimed) && claimed.length === 1) {
      const { error } = await supabaseAdmin.from('conversations').insert([{ telegram_id: String(params.actor.legacyTelegramId), role: 'assistant', content: line }])
      if (error) console.error('GOAL_WEB_OUTCOME_SAVE_FAILED:', String(error.code || 'error').slice(0, 20))
    }
    return { runId:params.runId, ...result }
  }
  return { runId:params.runId, ...(await drivePersistentRun(params.actor, params.runId, missionText, params.maxWaves || 10, true)) }
}

/** Addendum 5 (goal intake): one goal from a list, as its own durable run of one safe step. The same tools, checks,
 *  stale-step recovery and cron resume as any persistent plan; `metadata` carries the goal's ownership and its list.
 *  Creates the run and returns at once; `drive` then runs it (the caller decides when, so several start together). */
export async function startPersistentGoalRun(params: { actor: AgentActor; surface: AgentSurface; step: GeneralPlanStep; missionText: string; metadata: Record<string, unknown>; /** How long the creating request may still be driving the run (default 150 s). */ liveMs?: number }) {
  if (!PERSISTENT_SAFE_TOOLS.has(params.step.tool)) throw new Error('persistent_goal_unsupported_tool')
  const step = params.step
  const runtimePlan: AutonomousPlan = {
    objective: safe(params.metadata.goal_title || step.title, 160),
    steps: [{ key: stepKey(0, step), title: step.title, toolName: toolName(step), dependsOn: [], lane: step.tool === 'web_search' || step.tool === 'travel' ? 'research' : step.tool,
      maxAttempts: 4, requiresApproval: false, verificationRequired: true, mutation: ['reminders','lists'].includes(step.tool) || (step.tool === 'tasks' && taskStepIntent(step) !== 'read') }],
    // goal_live_until: the request that created the run is still driving it; the background sweeper leaves it alone
    // until then (a request lives at most 120 s), so one result is not reported twice or replaced by a generic notice.
    metadata: { ...params.metadata, goal_live_until: new Date(Date.now() + Math.min(600_000, Math.max(150_000, Number(params.liveMs) || 150_000))).toISOString(), input_text: safe(params.missionText, 2000), mission_fingerprint: missionFingerprint(`${params.metadata.goal_batch_id || ''}:${step.instruction}`), planner: 'goal-intake', persistent_general_plan: true, persistent_plan_steps: [step] },
  }
  const created = await createAutonomousRun({ actor: params.actor, source: params.surface, plan: runtimePlan })
  return {
    runId: created.runId,
    /** Runs it now (as the live request does: the caller replies itself) and returns the reply for it. */
    drive: async (maxWaves = 4) => {
      await drivePersistentRun(params.actor, created.runId, params.missionText, maxWaves)
      const run = await runMetadata(created.runId, params.actor)
      const status = String(run.status || 'running')
      // What the step itself produced (the reminder as saved, the research answer and its sources), not the run's
      // fixed "Completed and verified." line.
      let text = ''
      if (status === 'completed' && step.tool !== 'travel') {
        const { data } = await supabaseAdmin.from('agent_steps').select('output_json').eq('run_id', created.runId).eq('telegram_id', String(params.actor.legacyTelegramId)).order('ordinal', { ascending: true }).limit(1).maybeSingle()
        const out: any = data?.output_json || {}
        const body = String(out.text || '').replace(/[ \t]+/g, ' ').trim().slice(0, 2600)
        // The research answer already ends with its own source list; one is added only when it does not.
        const sources = Array.isArray(out.sources) && !/\bSources?:/i.test(body) ? out.sources.slice(0, 5).map((s: any, i: number) => `[${i + 1}] ${safe(s?.title, 80)} ${safe(s?.url, 300)}`).join('\n') : ''
        text = [body, sources].filter(Boolean).join('\n\nSources:\n')
      }
      if (status === 'failed' && String(run.error || '').includes('persistent_reminder_permission_off')) text = 'Reminders are switched off in your settings, so I did not set this one.'
      if (status === 'failed' && String(run.error || '').includes('persistent_browser_permission_off')) text = 'Web research is switched off in your settings, so I did not do this one.'
      if (status === 'failed' && String(run.error || '').includes('goal_research_no_sources')) text = 'I could not find reliable sources for this, so I have not called it done.'
      return { status, text: text || await persistentResultReply(params.actor, created.runId, run, 'Started.') }
    },
  }
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

