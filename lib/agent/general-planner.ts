import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { classifyAgentRequest, type AgentApprovalAction } from './classifier'
import { dispatchThroughSameBrain } from './same-brain'
import {
  executeVerifiedMissionCalendar,
  executeVerifiedMissionMemory,
  executeVerifiedMissionReminder,
  executeVerifiedMissionWebSearch,
} from './mission-tools'
import { evaluateAgentExecutionPolicy, type AgentCapability, type AgentPermissionLevel } from './policy'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const MAX_STEPS = 10
const CONSEQUENTIAL = new Set<AgentCapability>(['email', 'calendar', 'browser', 'travel', 'payments'])

const DEFAULT_LEVEL: Record<AgentCapability, AgentPermissionLevel> = {
  memory: 'ask', files: 'ask', reminders: 'auto', lists: 'auto', tasks: 'auto',
  email: 'draft', calendar: 'ask', browser: 'draft', contacts: 'read', travel: 'draft', payments: 'ask',
}

export type GeneralPlanTool =
  | 'memory'
  | 'files'
  | 'reminders'
  | 'lists'
  | 'tasks'
  | 'email'
  | 'calendar'
  | 'web_search'
  | 'travel'
  | 'artifact'

export type GeneralPlanStep = {
  tool: GeneralPlanTool
  title: string
  instruction: string
  artifactType?: 'trip' | 'application_tracker' | 'meeting_brief' | 'comparison' | 'goal_plan' | 'research_brief' | 'reward_summary'
  artifactTitle?: string
}

export type GeneralPlan = {
  title: string
  reason: string
  steps: GeneralPlanStep[]
}

export type GeneralPlanResult = {
  runId: string
  status: 'completed' | 'waiting_approval' | 'paused' | 'failed'
  capability: AgentCapability
  risk: 'low' | 'medium' | 'high'
  text: string
  approvalId?: string
  approvalRequired?: boolean
  inputRequired?: boolean
  handledBy: 'general-plan'
}

function safeLog(value: unknown, max = 900) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

function parseJsonLoose(text: string): any | null {
  const clean = String(text || '').replace(/```json|```/g, '').trim()
  try { return JSON.parse(clean) } catch {}
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch { return null }
}

function normalizeStep(raw: any): GeneralPlanStep | null {
  const allowed = new Set<GeneralPlanTool>(['memory','files','reminders','lists','tasks','email','calendar','web_search','travel','artifact'])
  const tool = String(raw?.tool || '') as GeneralPlanTool
  if (!allowed.has(tool)) return null
  const title = String(raw?.title || '').replace(/\s+/g, ' ').trim().slice(0, 140)
  const instruction = String(raw?.instruction || '').replace(/\s+/g, ' ').trim().slice(0, 1000)
  if (!title || !instruction) return null
  const artifactTypes = new Set(['trip','application_tracker','meeting_brief','comparison','goal_plan','research_brief','reward_summary'])
  const artifactType = artifactTypes.has(String(raw?.artifactType || '')) ? raw.artifactType : undefined
  const artifactTitle = raw?.artifactTitle ? String(raw.artifactTitle).replace(/\s+/g, ' ').trim().slice(0, 180) : undefined
  return { tool, title, instruction, artifactType, artifactTitle }
}

function hasConcreteDate(text: string) {
  return /\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+20\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+20\d{2}\b/i.test(text)
}

function hasConcreteClock(text: string) {
  return /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm)\b/i.test(text)
}

export function missingMissionInput(step: GeneralPlanStep, missionText = ''): string | null {
  const text = `${step.title} ${step.instruction}`
  const dependency = /selected\s+(?:flight|departure|return)|depends?\s+on\s+(?:the\s+)?(?:user'?s\s+)?flight|before\s+(?:the\s+)?(?:selected\s+)?departure|based\s+on\s+(?:the\s+)?selected\s+flight|exact\s+(?:date|time).*confirm|pause\s+here\s+to\s+confirm/i.test(text)
  if (!dependency) return null
  const missionHasDeparture = /\bplanned\s+departure(?:\s+time)?\b|\bdeparture\s+time\b/i.test(missionText) && hasConcreteDate(missionText) && hasConcreteClock(missionText)
  if (step.tool === 'reminders' && !(hasConcreteDate(text) && hasConcreteClock(text)) && !missionHasDeparture) {
    return 'Choose the departure date and time first so I can place the reminder exactly 24 hours before it.'
  }
  if (step.tool === 'calendar' && !hasConcreteDate(text) && !hasConcreteDate(missionText)) {
    return 'Choose the trip dates or flight first so I can prepare the correct calendar event.'
  }
  return null
}

function shouldPrepareBefore(step: GeneralPlanStep) {
  if (missingMissionInput(step)) return true
  if (step.tool === 'calendar' && /\b(add|create|change|move|schedule|write|modify|prepare)\b/i.test(step.instruction)) return true
  if (step.tool === 'email' && /\b(send|reply|forward)\b/i.test(step.instruction)) return true
  return false
}

function placeArtifactBeforeDeferredWork(steps: GeneralPlanStep[]) {
  const artifactIndex = steps.findIndex(step => step.tool === 'artifact')
  const deferredIndex = steps.findIndex(shouldPrepareBefore)
  if (artifactIndex >= 0 && deferredIndex >= 0 && artifactIndex > deferredIndex) {
    const [artifact] = steps.splice(artifactIndex, 1)
    steps.splice(deferredIndex, 0, artifact)
  }
  return steps
}

function normalizePlan(raw: any): GeneralPlan | null {
  const title = String(raw?.title || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const reason = String(raw?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  const rawSteps = Array.isArray(raw?.steps) ? raw.steps.map(normalizeStep).filter(Boolean) as GeneralPlanStep[] : []
  const steps = placeArtifactBeforeDeferredWork(rawSteps)
  if (!title || steps.length < 2 || steps.length > MAX_STEPS) return null
  return { title, reason: reason || 'This outcome needs more than one AskGogo capability.', steps }
}

function domainCount(text: string) {
  const t = text.toLowerCase()
  const domains = [
    /\b(remind|reminder)\b/, /\b(calendar|meeting|appointment)\b/, /\b(email|mail|gmail)\b/,
    /\b(passport|document|file|pdf|memory|remember|know about me|already know)\b/, /\b(list|grocer|packing|task|todo)\b/,
    /\b(flight|hotel|trip|travel|itinerary)\b/, /\b(search|research|web|online|price|compare)\b/,
    /\b(report|brief|tracker|dashboard|artifact|document)\b/,
  ]
  return domains.filter(r => r.test(t)).length
}

/** Only invoke the expensive planner for genuinely cross-feature/outcome requests. */
export function shouldUseGeneralPlanner(text: string) {
  const t = String(text || '').trim()
  if (t.length < 18) return false
  if (domainCount(t) >= 2 && /\b(and|then|also|after|before|plus|while)\b/i.test(t)) return true
  if (/\b(plan|arrange|organize|organise|handle|take care of|prepare everything|manage this|sort this out)\b/i.test(t) && domainCount(t) >= 1) return true
  if (/\b(research|compare)\b/i.test(t) && /\b(report|brief|tracker|dashboard|save|remind|calendar)\b/i.test(t)) return true
  if (/\b(use anything relevant|use what you know|already know about me)\b/i.test(t) && domainCount(t) >= 2) return true
  return false
}

export async function planGeneralAgentRequest(text: string): Promise<GeneralPlan | null> {
  if (!shouldUseGeneralPlanner(text)) return null
  const prompt = `You are the planning layer for AskGogo, a private personal agent. Turn the user's OUTCOME into 2-${MAX_STEPS} concrete executable steps using ONLY these tools:\n\nmemory, files, reminders, lists, tasks, email, calendar, web_search, travel, artifact\n\nMission rules:\n- Cover every explicit deliverable in the user's request. Do not collapse a multi-part mission into one search or one prose answer.\n- Prefer safe, reversible work first. Put consequential actions such as calendar changes, sends, bookings or external submissions after safe preparation so useful work can finish before an approval pause.\n- If the user says to use what AskGogo already knows, include a memory step near the beginning. Never reveal sensitive identifiers in the plan.\n- If the user explicitly names multiple tasks, use separate task steps when needed so every named task is represented. Each task instruction must literally include the task text; do not rely on hidden context from another step.\n- If the user requests a packing/list deliverable, include a lists step.\n- If the user requests a reminder, include a reminders step. If its exact trigger depends on a future choice that is not known yet, do not invent a date or flight; make the dependency explicit so execution pauses for the missing input.\n- For flight research, phrase the executable instruction as “Search flights from ORIGIN to DESTINATION on DATE” so route direction and date can be verified deterministically.\n- If the user requests a brief/report/artifact, place the artifact after the safe preparatory work but BEFORE a later approval-required or unresolved-dependency step when the artifact can summarize the prepared plan. Do not block a useful draft artifact behind an approval unless it explicitly requires post-execution results.\n- For calendar writes, include exact dates in the instruction. Calendar writes always wait for deterministic approval before execution.\n- The plan sees ONLY this user request. Never assume hidden values, credentials, document numbers or account data.\n- Each instruction must be self-contained and executable by that tool.\n- Use web_search only for public-web research; it can read/search but cannot submit forms.\n- email can read/draft/send, but sending will be stopped by a deterministic approval gate.\n- calendar can read/create/change; writes will be stopped by approval.\n- travel can read/organize; bookings will be stopped by approval.\n- payments/purchases are NOT an available planner tool; if the user asks to spend money, prepare only and let deterministic browser/travel execution stop before purchase.\n- artifact creates a private structured output from the results of previous steps.\n- Do not put secrets or guessed private values into instructions.\n- Return JSON only.\n\nShape:\n{"title":"short outcome","reason":"why multiple tools are needed","steps":[{"tool":"memory","title":"Review relevant context","instruction":"Find relevant saved context for this trip without revealing sensitive identifiers."},{"tool":"web_search","title":"Research flight options","instruction":"Search flights from Bengaluru to Mumbai on 15 September 2026"},{"tool":"tasks","title":"Create check-in task","instruction":"Create task: Complete web check-in"},{"tool":"artifact","title":"Create trip brief","instruction":"Create a concise private brief from this run","artifactType":"trip","artifactTitle":"Mumbai work trip brief"}]}\n\nUser request: ${JSON.stringify(String(text || '').slice(0, 1800))}`
  try {
    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2200,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    })
    const out = result.content[0]?.type === 'text' ? result.content[0].text : ''
    return normalizePlan(parseJsonLoose(out))
  } catch (err: any) {
    console.error('GENERAL_AGENT_PLAN_FAILED:', err?.message || err)
    return null
  }
}

async function permissionFor(tg: number, capability: AgentCapability): Promise<AgentPermissionLevel> {
  const { data, error } = await supabaseAdmin.from('agent_permissions')
    .select('level').eq('telegram_id', String(tg)).eq('capability', capability).maybeSingle()
  if (error) throw new Error(`general_plan_permission_failed:${error.message}`)
  return (data?.level as AgentPermissionLevel | undefined) || DEFAULT_LEVEL[capability]
}

function capabilityForStep(step: GeneralPlanStep): AgentCapability {
  if (step.tool === 'web_search') return 'browser'
  if (step.tool === 'artifact') return 'memory'
  return step.tool as AgentCapability
}

function classifyStep(step: GeneralPlanStep) {
  if (step.tool === 'web_search') return { capability:'browser' as const, mode:'read' as const, risk:'low' as const, irreversible:false, title:step.title, why:'This only searches the public web.' }
  if (step.tool === 'artifact') return { capability:'memory' as const, mode:'execute' as const, risk:'low' as const, irreversible:false, title:step.title, why:'This creates a private AskGogo artifact.' }
  if (step.tool === 'tasks') return { capability:'tasks' as const, mode:'execute' as const, risk:'low' as const, irreversible:false, title:step.title, why:'This creates or updates a private AskGogo task.' }
  if (step.tool === 'calendar') {
    const mutation = /\b(add|create|change|move|schedule|write|modify|prepare|invite|cancel|delete|event\s+titled|spanning)\b/i.test(step.instruction)
    return mutation
      ? { capability:'calendar' as const, mode:'execute' as const, risk:'medium' as const, irreversible:false, approvalAction:'calendar_change' as AgentApprovalAction, title:step.title, why:'This will add or change Google Calendar only after your approval.' }
      : { capability:'calendar' as const, mode:'read' as const, risk:'low' as const, irreversible:false, title:step.title, why:'This only reads connected calendar context.' }
  }
  const classified = classifyAgentRequest(step.instruction)
  return { ...classified, capability: capabilityForStep(step) }
}

async function addStep(tg: number, runId: string, ordinal: number, step: GeneralPlanStep) {
  const { data, error } = await supabaseAdmin.from('agent_steps').insert({
    telegram_id:String(tg), run_id:runId, ordinal, tool_name:step.tool,
    title:step.title, status:'queued', input_json:{ instruction: step.instruction }, output_json:{},
  }).select('id').single()
  if (error || !data?.id) throw new Error(`general_plan_step_create_failed:${error?.message || 'unknown'}`)
  return String(data.id)
}

async function updateStep(id: string, status: 'running'|'completed'|'failed'|'waiting_approval', output: Record<string,unknown> = {}, error?: string) {
  const now = new Date().toISOString()
  const patch:any = { status }
  if (status === 'running') patch.started_at = now
  if (status === 'completed' || status === 'failed') patch.completed_at = now
  if (Object.keys(output).length) patch.output_json = output
  if (error) patch.error = safeLog(error, 500)
  const { error:e } = await supabaseAdmin.from('agent_steps').update(patch).eq('id', id)
  if (e) throw new Error(`general_plan_step_update_failed:${e.message}`)
}

async function activity(tg: number, runId: string, eventType: string, message: string, metadata: Record<string,unknown> = {}) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(tg), run_id:runId, event_type:eventType,
    message:safeLog(message), metadata_json:metadata,
  })
  if (error) console.error('GENERAL_PLAN_ACTIVITY_FAILED:', error.message)
}

function artifactTitleFromInstruction(step: GeneralPlanStep) {
  return step.instruction.match(/(?:titled|called)\s+['“\"]([^'”\"]+)['”\"]/i)?.[1]?.trim()
}

async function createArtifact(tg:number, runId:string, step:GeneralPlanStep) {
  const { data: prior } = await supabaseAdmin.from('agent_steps')
    .select('ordinal,title,tool_name,status,output_json').eq('run_id',runId).eq('telegram_id',String(tg)).order('ordinal',{ascending:true})
  const sections = (prior || []).filter((x:any)=>x.status==='completed' && x.tool_name!=='artifact').map((x:any)=>({
    title:x.title, tool:x.tool_name, result:x.output_json || {},
  }))
  const title = step.artifactTitle || artifactTitleFromInstruction(step) || step.title || 'AskGogo artifact'
  const type = step.artifactType || 'research_brief'
  const content_json = { runId, sections }
  const source_refs = [{type:'agent_run',id:runId}]

  const { data: existing } = await supabaseAdmin.from('agent_artifacts')
    .select('id').eq('telegram_id',String(tg)).eq('type',type).ilike('title',title).order('created_at',{ascending:false}).limit(1).maybeSingle()
  if (existing?.id) {
    const { error } = await supabaseAdmin.from('agent_artifacts').update({
      subtitle:'Updated by Gogo from a multi-step run', content_json, source_refs, updated_at:new Date().toISOString(),
    }).eq('id',existing.id).eq('telegram_id',String(tg))
    if (error) throw new Error(`general_plan_artifact_update_failed:${error.message}`)
    return String(existing.id)
  }

  const { data, error } = await supabaseAdmin.from('agent_artifacts').insert({
    telegram_id:String(tg), type, title, subtitle:'Created by Gogo from a multi-step run', schema_version:1,
    content_json, source_refs,
  }).select('id').single()
  if (error || !data?.id) throw new Error(`general_plan_artifact_failed:${error?.message || 'unknown'}`)
  return String(data.id)
}

function cleanTaskText(value: string) {
  return safeLog(String(value || '')
    .replace(/^\s*['“\"]|['”\"]\s*$/g, '')
    .replace(/\s+if\s+it\s+does\s+not\s+already\s+exist[\s\S]*$/i, '')
    .replace(/\s+do\s+not\s+duplicate[\s\S]*$/i, '')
    .replace(/[.;]+$/g, '')
    .trim(), 500)
}

function taskTextForStep(step: GeneralPlanStep) {
  const quoted = step.instruction.match(/(?:create|add)(?:\s+or\s+verify)?\s+(?:a\s+)?task\s*:?\s*['“\"]([^'”\"]+)['”\"]/i)
  if (quoted?.[1]) return cleanTaskText(quoted[1])
  const titleMatch = step.title.match(/(?:create|add)(?:\s+or\s+verify)?\s+(?:a\s+)?task\s*:?\s*(.+)$/i)
  if (titleMatch?.[1]) return cleanTaskText(titleMatch[1])
  const instruction = step.instruction.replace(/^(?:please\s+)?(?:create|add)(?:\s+or\s+verify)?\s+(?:a\s+)?task\s*:?\s*/i, '')
  return cleanTaskText(instruction)
}

async function executeTaskStep(actor: AgentActor, step: GeneralPlanStep) {
  const text = taskTextForStep(step)
  if (!text) throw new Error('task_text_missing')
  const { data: existing, error: readError } = await supabaseAdmin.from('todos')
    .select('id,text').eq('whatsapp_id', actor.whatsappId).eq('done', false).ilike('text', text).limit(1).maybeSingle()
  if (readError) throw new Error(`task_verify_failed:${readError.message}`)
  if (existing?.id) {
    return { text:`Task already open: ${text}`, output:{ todoId:String(existing.id), text, reused:true, verifiedStore:'todos' } }
  }
  const { data, error } = await supabaseAdmin.from('todos').insert({
    whatsapp_id:actor.whatsappId, text, done:false, created_at:new Date().toISOString(),
  }).select('id,text').single()
  if (error || !data?.id) throw new Error(`task_create_failed:${error?.message || 'unknown'}`)
  return { text:`Created task: ${text}`, output:{ todoId:String(data.id), text:String(data.text||text), reused:false, verifiedStore:'todos' } }
}

async function executeTool(params:{actor:AgentActor;runId:string;step:GeneralPlanStep;stepId:string;missionText:string;messageId?:string|number|null}) {
  const { actor, step } = params
  if (step.tool === 'web_search') return executeVerifiedMissionWebSearch(step)
  if (step.tool === 'artifact') {
    const artifactId = await createArtifact(actor.legacyTelegramId, params.runId, step)
    return { text:'Created a private AskGogo artifact.', output:{ artifactId, type:step.artifactType || 'research_brief' } }
  }
  if (step.tool === 'tasks') return executeTaskStep(actor, step)
  if (step.tool === 'reminders') return executeVerifiedMissionReminder({actor,step,missionText:params.missionText,messageId:params.messageId})
  if (step.tool === 'memory') return executeVerifiedMissionMemory({actor,step,missionText:params.missionText,messageId:params.messageId})
  if (step.tool === 'calendar') return executeVerifiedMissionCalendar({actor,step,missionText:params.missionText,runId:params.runId})
  const result = await dispatchThroughSameBrain({ actor, text:step.instruction, messageId:params.messageId })
  return { text:result.text, output:{ reply:String(result.text || '').slice(0,3500), handledBy:result.handledBy } }
}

async function requestApproval(params:{actor:AgentActor;runId:string;step:GeneralPlanStep;stepId:string;ordinal:number;totalSteps:number;approvalAction:AgentApprovalAction;risk:'low'|'medium'|'high';reason:string}) {
  const { data, error } = await supabaseAdmin.from('agent_approvals').insert({
    telegram_id:String(params.actor.legacyTelegramId), run_id:params.runId,
    action_type:params.approvalAction, title:params.step.title,
    description:params.reason,
    payload_preview:[
      {label:'Next step',value:safeLog(params.step.title,180)},
      {label:'Action',value:safeLog(params.step.instruction,500)},
      {label:'Risk',value:params.risk},
    ],
    execution_payload:{ plan_type:'general_multi_tool', ordinal:params.ordinal, stepId:params.stepId },
    risk_level:params.risk, status:'pending',
  }).select('id').single()
  if (error || !data?.id) throw new Error(`general_plan_approval_failed:${error?.message || 'unknown'}`)
  await updateStep(params.stepId, 'waiting_approval')
  const progress = Math.max(5, Math.round(((params.ordinal - 1) / Math.max(1, params.totalSteps)) * 100))
  await supabaseAdmin.from('agent_runs').update({
    status:'waiting_approval', progress,
    summary:`Waiting for approval: ${params.step.title}`, updated_at:new Date().toISOString(),
  }).eq('id',params.runId).eq('telegram_id',String(params.actor.legacyTelegramId))
  await activity(params.actor.legacyTelegramId,params.runId,'approval_requested',`Approval required: ${params.step.title}`,{approval_id:data.id,ordinal:params.ordinal})
  return String(data.id)
}

async function pauseForInput(params:{actor:AgentActor;runId:string;stepId:string;ordinal:number;totalSteps:number;step:GeneralPlanStep;question:string}):Promise<GeneralPlanResult> {
  const progress = Math.max(2, Math.round(((params.ordinal - 1) / Math.max(1, params.totalSteps)) * 100))
  await supabaseAdmin.from('agent_steps').update({
    status:'queued', output_json:{ inputRequired:true, question:params.question },
  }).eq('id',params.stepId)
  await supabaseAdmin.from('agent_runs').update({
    status:'paused', progress, summary:`Waiting for your input: ${params.question}`, updated_at:new Date().toISOString(),
  }).eq('id',params.runId).eq('telegram_id',String(params.actor.legacyTelegramId))
  await activity(params.actor.legacyTelegramId,params.runId,'input_required',params.question,{ordinal:params.ordinal,tool:params.step.tool})
  return {runId:params.runId,status:'paused',capability:capabilityForStep(params.step),risk:'low',text:`I completed everything I safely could. I need one detail before I continue: ${params.question}`,inputRequired:true,handledBy:'general-plan'}
}

async function executePlanFromOrdinal(params:{actor:AgentActor;runId:string;plan:GeneralPlan;stepIds:string[];startOrdinal:number;missionText:string;messageId?:string|number|null;approvedOrdinal?:number}) : Promise<GeneralPlanResult> {
  const tg = params.actor.legacyTelegramId
  let highestRisk:'low'|'medium'|'high'='low'
  let lastText=''
  for (let index=params.startOrdinal-1; index<params.plan.steps.length; index++) {
    const ordinal=index+1
    const step=params.plan.steps[index]
    const stepId=params.stepIds[index]
    const question = missingMissionInput(step, params.missionText)
    if (question) return pauseForInput({actor:params.actor,runId:params.runId,stepId,ordinal,totalSteps:params.plan.steps.length,step,question})

    const classified=classifyStep(step)
    if (classified.risk==='high') highestRisk='high'; else if (classified.risk==='medium' && highestRisk==='low') highestRisk='medium'
    const level=await permissionFor(tg,classified.capability)
    const directPrivateApproval = classified.mode==='execute' && classified.risk==='low' && !classified.irreversible && !CONSEQUENTIAL.has(classified.capability)
    const explicitlyApproved = params.approvedOrdinal===ordinal
    const policy=evaluateAgentExecutionPolicy({
      capability:classified.capability, permissionLevel:level, mode:classified.mode,
      risk:classified.risk, irreversible:classified.irreversible,
      approvalStatus:(explicitlyApproved||directPrivateApproval)?'approved':null,
    })
    if (!policy.allowed) {
      if ((policy.reason==='approval_required'||policy.reason==='auto_not_allowed_for_consequential_action') && classified.approvalAction) {
        const approvalId=await requestApproval({actor:params.actor,runId:params.runId,step,stepId,ordinal,totalSteps:params.plan.steps.length,approvalAction:classified.approvalAction,risk:classified.risk,reason:classified.why})
        return {runId:params.runId,status:'waiting_approval',capability:classified.capability,risk:classified.risk,text:`I finished the safe steps. I need your approval before: ${step.title}`,approvalId,approvalRequired:true,handledBy:'general-plan'}
      }
      await updateStep(stepId,'failed',{},policy.reason)
      await supabaseAdmin.from('agent_runs').update({status:'paused',summary:`Blocked by Gogo Safe Mode: ${policy.reason}`,updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',String(tg))
      return {runId:params.runId,status:'paused',capability:classified.capability,risk:classified.risk,text:`Gogo Safe Mode stopped at “${step.title}”: ${policy.reason}`,handledBy:'general-plan'}
    }
    await updateStep(stepId,'running')
    try {
      const result=await executeTool({actor:params.actor,runId:params.runId,step,stepId,missionText:params.missionText,messageId:params.messageId})
      lastText=result.text
      await updateStep(stepId,'completed',result.output)
      const progress=Math.round((ordinal/params.plan.steps.length)*100)
      await supabaseAdmin.from('agent_runs').update({status:'running',progress,summary:safeLog(result.text,1000),updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',String(tg))
      await activity(tg,params.runId,'step_completed',`${step.title} completed.`,{ordinal,tool:step.tool})
    } catch (err:any) {
      const message=String(err?.message||'step_failed')
      await updateStep(stepId,'failed',{},message).catch(()=>{})
      await supabaseAdmin.from('agent_runs').update({status:'failed',progress:100,summary:`Failed at: ${step.title}`,error:safeLog(message,500),completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',String(tg))
      await activity(tg,params.runId,'run_failed',`Failed at: ${step.title}`,{ordinal,tool:step.tool,error:safeLog(message,250)})
      return {runId:params.runId,status:'failed',capability:classified.capability,risk:classified.risk,text:`I could not finish “${step.title}”.`,handledBy:'general-plan'}
    }
  }
  const completedAt=new Date().toISOString()
  await supabaseAdmin.from('agent_runs').update({status:'completed',progress:100,summary:safeLog(lastText||'Multi-step plan completed.',1800),completed_at:completedAt,updated_at:completedAt}).eq('id',params.runId).eq('telegram_id',String(tg))
  await activity(tg,params.runId,'run_completed','Gogo completed the multi-tool plan.',{step_count:params.plan.steps.length})
  return {runId:params.runId,status:'completed',capability:capabilityForStep(params.plan.steps[params.plan.steps.length-1]),risk:highestRisk,text:lastText||'Done. I completed the plan.',handledBy:'general-plan'}
}

export async function tryRunGeneralPlan(params:{actor:AgentActor;surface:AgentSurface;text:string;messageId?:string|number|null}):Promise<GeneralPlanResult|null>{
  const plan=await planGeneralAgentRequest(params.text)
  if(!plan)return null
  const tg=params.actor.legacyTelegramId
  const now=new Date().toISOString()
  const firstCapability=capabilityForStep(plan.steps[0])
  const {data:run,error}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(tg),type:'general_plan',capability:firstCapability,status:'running',title:plan.title,
    summary:'Gogo created a multi-tool plan.',progress:2,why:plan.reason,source:params.surface,
    metadata_json:{input_text:String(params.text).slice(0,2000),plan_type:'general_multi_tool',plan},started_at:now,updated_at:now,
  }).select('id').single()
  if(error||!run?.id)throw new Error(`general_plan_run_create_failed:${error?.message||'unknown'}`)
  const runId=String(run.id)
  const stepIds:string[]=[]
  for(let i=0;i<plan.steps.length;i++)stepIds.push(await addStep(tg,runId,i+1,plan.steps[i]))
  await supabaseAdmin.from('agent_runs').update({metadata_json:{input_text:String(params.text).slice(0,2000),plan_type:'general_multi_tool',plan,stepIds}}).eq('id',runId).eq('telegram_id',String(tg))
  await activity(tg,runId,'plan_created',`Gogo created a ${plan.steps.length}-step plan.`,{tools:plan.steps.map(s=>s.tool),surface:params.surface})
  return executePlanFromOrdinal({actor:params.actor,runId,plan,stepIds,startOrdinal:1,missionText:params.text,messageId:params.messageId})
}

export async function resumeApprovedGeneralPlan(params:{actor:AgentActor;runId:string;messageId?:string|number|null}):Promise<GeneralPlanResult>{
  const tg=params.actor.legacyTelegramId
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('metadata_json,status').eq('id',params.runId).eq('telegram_id',String(tg)).maybeSingle()
  if(error)throw new Error(`agent_run_read_failed:${error.message}`)
  if(!run)throw new Error('agent_run_not_found')
  const meta:any=run.metadata_json||{}
  if(meta.plan_type!=='general_multi_tool')throw new Error('not_general_plan')
  const plan=normalizePlan(meta.plan)
  const stepIds=Array.isArray(meta.stepIds)?meta.stepIds.map(String):[]
  if(!plan||stepIds.length!==plan.steps.length)throw new Error('general_plan_metadata_invalid')
  const {data:approval}=await supabaseAdmin.from('agent_approvals').select('id,status,execution_payload').eq('run_id',params.runId).eq('telegram_id',String(tg)).eq('status','approved').order('resolved_at',{ascending:false}).limit(1).maybeSingle()
  const ordinal=Number(approval?.execution_payload?.ordinal||0)
  if(!approval||!ordinal||ordinal>plan.steps.length)throw new Error('general_plan_approval_missing')
  await supabaseAdmin.from('agent_runs').update({status:'running',summary:'Approval received. Gogo is continuing the plan.',updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',String(tg))
  const result=await executePlanFromOrdinal({actor:params.actor,runId:params.runId,plan,stepIds,startOrdinal:ordinal,missionText:String(meta.input_text||''),messageId:params.messageId,approvedOrdinal:ordinal})
  if(result.status!=='waiting_approval')await supabaseAdmin.from('agent_approvals').update({status:'executed',executed_at:new Date().toISOString()}).eq('id',approval.id).eq('telegram_id',String(tg))
  return result
}
