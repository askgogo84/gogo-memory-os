import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ResolvedUser } from '@/lib/bot/resolve-user'
import type { AgentActor } from './actor'
import { tryCreateFlightWatchFromCommand, tryCreateInboxTriageWatchFromCommand, tryCreateProductStockWatchFromCommand, tryCreateWebPageWatchFromCommand, tryCreateWebWatchFromCommand, tryGetProductStockWatchStatusFromCommand, tryGetWatcherStatusFromCommand, tryStopWatcherFromCommand } from './watch-command'
import { tryRunBrowserCommand, executeApprovedBrowserCommand } from './browser-command'
import { tryPrepareTravelCalendarPlan, executeApprovedTravelCalendarPlan } from './travel-calendar-plan'
import { tryRunExpiryReminderPlan } from './compound-planner'
import { tryRunGeneralPlan, resumeApprovedGeneralPlan } from './general-planner'
import { tryRunPersistentGeneralPlan } from './persistent-general-plan'
import { tryRunTravelResearch } from './travel-research'
import { hardenTravelResearchResult } from './travel-research-sanitize'
import { shouldPreferSpecialistTravel } from './specialist-routing'
import { tryResumeTrainHandoff, tryRunTrainResearch } from './train-research'
import { executeApprovedAgentRun } from './orchestrator'
import { executeApprovedLifeEventCheckin } from './life-event-execution'
import { executeApprovedBookingCalendar } from './booking-calendar-execution'
import { initializeBackgroundGoal } from './goal-engine'
import { tryGetAutonomyStatus, tryGetConnectionStatus } from './autonomy-status'
import { capabilityIsOff } from './adaptive-autonomy'
import { tryRunAdaptiveAutonomyCommand } from './adaptive-autonomy'
import { handleOpenLoopAction, handleOpenLoopQuery, handleOpenLoopResolution, shouldHandleOpenLoopAction, shouldHandleOpenLoopResolution } from './open-loops'
import { tryRecoverAppointmentOption } from './appointment-followup-recovery'
import { tryRunAppointmentFollowup } from './appointment-followup'
import { tryRunAppointmentResearch } from './appointment-research'

export type WhatsAppAgentResult = {
  text: string
  runId?: string
  status?: string
  handledBy: string
}

const WHATSAPP_BROWSER_BUDGET_MS = 42_000

function actorFromResolvedUser(user: ResolvedUser): AgentActor | null {
  if (!user.id || !Number.isFinite(user.telegramId) || !user.whatsappId) return null
  return {
    userId: String(user.id),
    legacyTelegramId: user.telegramId,
    whatsappId: String(user.whatsappId),
    name: String(user.name || 'Gogo'),
  }
}

function approvalIntent(text: string): 'approve' | 'reject' | null {
  const t = String(text || '').trim().toLowerCase()
  if (/^(approve|approved|yes[ ,]+approve|approve it|go ahead with it|proceed with it)$/i.test(t)) return 'approve'
  if (/^(reject|rejected|deny|decline|reject it|do not proceed|don't proceed|cancel that action)$/i.test(t)) return 'reject'
  return null
}

async function pauseRecentTimedOutBrowserRun(actor: AgentActor) {
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString()
  const { data } = await supabaseAdmin.from('agent_runs')
    .select('id,status,started_at')
    .eq('telegram_id', String(actor.legacyTelegramId))
    .eq('type', 'secure_browser')
    .eq('status', 'running')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.id) return
  const now = new Date().toISOString()
  await supabaseAdmin.from('agent_runs').update({
    status: 'paused',
    summary: 'Provider inspection exceeded the WhatsApp response window; no consequential action was allowed.',
    error: 'whatsapp_browser_response_timeout',
    updated_at: now,
  }).eq('id', String(data.id)).eq('telegram_id', String(actor.legacyTelegramId)).eq('status', 'running')
  await supabaseAdmin.from('agent_steps').update({
    status: 'failed',
    error: 'whatsapp_browser_response_timeout',
    completed_at: now,
  }).eq('run_id', String(data.id)).eq('telegram_id', String(actor.legacyTelegramId)).eq('status', 'running')
}

async function withWhatsAppBrowserBudget<T>(actor: AgentActor, task: Promise<T>): Promise<T | WhatsAppAgentResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<WhatsAppAgentResult>((resolve) => {
    timer = setTimeout(() => {
      void pauseRecentTimedOutBrowserRun(actor).catch((err:any) => console.error('WHATSAPP_BROWSER_TIMEOUT_CLEANUP_FAILED:', err?.message || err))
      resolve({
        text: `I kept your booking/provider context, but the provider site took longer than WhatsApp's safe response window to inspect. I stopped waiting here rather than leave you with silence. No booking, confirmation, purchase, payment or approval was created.`,
        status: 'paused',
        handledBy: 'whatsapp-browser-timeout',
      })
    }, WHATSAPP_BROWSER_BUDGET_MS)
  })
  try {
    return await Promise.race([task, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function latestPendingApproval(telegramId: number) {
  const { data, error } = await supabaseAdmin.from('agent_approvals')
    .select('id,run_id,title,action_type,risk_level,status,requested_at')
    .eq('telegram_id', String(telegramId))
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`whatsapp_agent_approval_read_failed:${error.message}`)
  return data || null
}

async function resolveLatestApproval(actor: AgentActor, decision: 'approve' | 'reject'): Promise<WhatsAppAgentResult | null> {
  const pending = await latestPendingApproval(actor.legacyTelegramId)
  if (!pending) return null
  const now = new Date().toISOString()
  const status = decision === 'approve' ? 'approved' : 'rejected'
  const { data, error } = await supabaseAdmin.from('agent_approvals')
    .update({ status, resolved_at: now })
    .eq('id', pending.id)
    .eq('telegram_id', String(actor.legacyTelegramId))
    .eq('status', 'pending')
    .select('id,run_id,title,action_type,risk_level,status')
    .maybeSingle()
  if (error) throw new Error(`whatsapp_agent_approval_resolve_failed:${error.message}`)
  if (!data) return null

  if (data.run_id) {
    await supabaseAdmin.from('agent_runs')
      .update({ status: decision === 'approve' ? 'queued' : 'paused', updated_at: now })
      .eq('id', data.run_id)
      .eq('telegram_id', String(actor.legacyTelegramId))
      .eq('status', 'waiting_approval')
  }
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: String(actor.legacyTelegramId), run_id: data.run_id,
    event_type: decision === 'approve' ? 'approval_granted' : 'approval_rejected',
    message: `${decision === 'approve' ? 'Approved' : 'Rejected'} on WhatsApp: ${data.title}`.slice(0, 900),
    metadata_json: { approval_id:data.id, action_type:data.action_type, risk_level:data.risk_level, surface:'whatsapp' },
  }).then(({ error }) => { if (error) console.error('WHATSAPP_AGENT_APPROVAL_ACTIVITY_FAILED:', error.message) })

  if (decision === 'reject' || !data.run_id) {
    return { text:`Rejected: ${data.title}. Gogo did not execute that action.`, runId:data.run_id || undefined, status:'paused', handledBy:'whatsapp-agent-approval' }
  }

  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs')
    .select('metadata_json').eq('id', data.run_id).eq('telegram_id', String(actor.legacyTelegramId)).maybeSingle()
  if (runError) throw new Error(`whatsapp_agent_run_read_failed:${runError.message}`)
  if (!run) throw new Error('whatsapp_agent_run_not_found')
  const planType = String((run.metadata_json as any)?.plan_type || '')
  const result = planType === 'memory_ticket_to_calendar'
    ? await executeApprovedTravelCalendarPlan({ actor, runId:String(data.run_id) })
    : planType === 'secure_browser'
      ? await executeApprovedBrowserCommand({ actor, runId:String(data.run_id) })
      : planType === 'general_multi_tool'
        ? await resumeApprovedGeneralPlan({ actor, runId:String(data.run_id) })
        : planType === 'life_event_checkin'
          ? await executeApprovedLifeEventCheckin({ actor, runId:String(data.run_id) })
          : planType === 'booking_event_calendar'
            ? await executeApprovedBookingCalendar({ actor, runId:String(data.run_id) })
            : await executeApprovedAgentRun({ actor, runId:String(data.run_id) })
  const suffix = result.status === 'waiting_approval' ? '\n\nAnother consequential step is ready. Reply *APPROVE* to continue or *REJECT* to stop.' : ''
  return { text:`${result.text || 'Approved and executed.'}${suffix}`, runId:String(data.run_id), status:result.status, handledBy:'whatsapp-agent-approval' }
}

function parseGoal(text: string) {
  const raw = String(text || '').trim().replace(/\s+/g, ' ')
  const match = raw.match(/^goal\s*:\s*(.{8,})$/i) || raw.match(/^(?:create|set|start)\s+(?:a\s+)?goal\s+(?:to\s+)?(.{8,})$/i)
  if (!match?.[1]) return null
  const outcome = match[1].trim().slice(0, 2000)
  const title = outcome.replace(/[.!?].*$/, '').slice(0, 120) || 'Gogo goal'
  return { title, outcome }
}

async function tryCreateGoal(actor: AgentActor, text: string): Promise<WhatsAppAgentResult | null> {
  const goal = parseGoal(text)
  if (!goal) return null
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('agent_goals').insert({
    telegram_id:String(actor.legacyTelegramId), title:goal.title, outcome:goal.outcome,
    status:'active', updated_at:now,
  }).select('id,title').single()
  if (error || !data?.id) throw new Error(`whatsapp_agent_goal_create_failed:${error?.message || 'unknown'}`)
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(actor.legacyTelegramId), event_type:'goal_created',
    message:`Goal created on WhatsApp: ${goal.title}`.slice(0,900), metadata_json:{goal_id:data.id,surface:'whatsapp'},
  }).then(({ error }) => { if (error) console.error('WHATSAPP_AGENT_APPROVAL_ACTIVITY_FAILED:', error.message) })
  try {
    const plan = await initializeBackgroundGoal({telegramId:String(actor.legacyTelegramId),goalId:String(data.id),title:goal.title,outcome:goal.outcome})
    return { text:`Goal created: *${goal.title}*\n\nBackground Gogo has a ${plan.steps.length}-step plan and will keep reviewing it. You can track progress in *Dashboard → Gogo Agent*.`, status:'active', handledBy:'whatsapp-agent-goal' }
  } catch (err:any) {
    await supabaseAdmin.from('agent_goals').update({status:'blocked',blockers:['Background planning failed.'],updated_at:new Date().toISOString()}).eq('id',data.id)
    console.error('WHATSAPP_AGENT_GOAL_INIT_FAILED:',err?.message||err)
    return { text:`I created the goal *${goal.title}*, but Background Gogo could not initialize its plan yet. It is saved as blocked for review in the dashboard.`, status:'blocked', handledBy:'whatsapp-agent-goal' }
  }
}

export async function tryRunWhatsAppJevSpecialist(params:{
  user:ResolvedUser
  text:string
  messageId?:string|number|null
  intent:'watcher'|'reminder_read'|'reminder_mutation'|'travel_research'|'browser_action'
}):Promise<WhatsAppAgentResult|null>{
  const actor=actorFromResolvedUser(params.user)
  if(!actor)return null

  if(params.intent==='reminder_read'||params.intent==='reminder_mutation'){
    if(await capabilityIsOff(actor.legacyTelegramId,'reminders')){
      return {
        text:'Reminders are currently off in your Gogo autonomy settings. Say *set reminders autonomy to auto* (or *ask*) to turn them back on.',
        status:'paused',
        handledBy:'adaptive-autonomy',
      }
    }
    const reminder=await tryRunExpiryReminderPlan({actor,surface:'whatsapp',text:params.text,messageId:params.messageId})
    return reminder ? {...reminder,handledBy:String(reminder.handledBy||'compound-plan')} : null
  }

  if(params.intent==='watcher'){
    const stop=await tryStopWatcherFromCommand({actor,text:params.text})
    if(stop)return {...stop,handledBy:String(stop.handledBy||'watcher-stop')}
    const status=await tryGetWatcherStatusFromCommand({actor,text:params.text})
    if(status)return {...status,handledBy:String(status.handledBy||'watcher-status')}
    const stockStatus=await tryGetProductStockWatchStatusFromCommand({actor,text:params.text})
    if(stockStatus)return {...stockStatus,handledBy:String(stockStatus.handledBy||'product-stock-watch-status')}
    const inbox=await tryCreateInboxTriageWatchFromCommand({actor,surface:'whatsapp',text:params.text})
    if(inbox)return {...inbox,handledBy:String(inbox.handledBy||'inbox-triage-watch')}
    const flight=await tryCreateFlightWatchFromCommand({actor,surface:'whatsapp',text:params.text})
    if(flight)return {...flight,handledBy:String(flight.handledBy||'flight-watch')}
    const product=await tryCreateProductStockWatchFromCommand({actor,surface:'whatsapp',text:params.text})
    if(product)return {...product,handledBy:String(product.handledBy||'product-stock-watch')}
    const page=await tryCreateWebPageWatchFromCommand({actor,surface:'whatsapp',text:params.text})
    if(page)return {...page,handledBy:String(page.handledBy||'web-page-watch')}
    const web=await tryCreateWebWatchFromCommand({actor,surface:'whatsapp',text:params.text})
    return web ? {...web,handledBy:String(web.handledBy||'background-web-watch')} : null
  }

  if(params.intent==='travel_research'){
    if(!shouldPreferSpecialistTravel(params.text))return null
    const travel=await tryRunTravelResearch({actor,surface:'whatsapp',text:params.text})
    if(!travel)return null
    const hardened=await hardenTravelResearchResult(travel,params.text)
    return {...hardened,handledBy:String(hardened.handledBy||'travel-research')}
  }

  const browser=await withWhatsAppBrowserBudget(actor,tryRunBrowserCommand({actor,surface:'whatsapp',text:params.text}))
  if(!browser)return null
  return {
    ...(browser as any),
    text:`${(browser as any).text||''}${(browser as any).status==='waiting_approval'?'\n\nReply *APPROVE* to continue or *REJECT* to stop.':''}`,
    handledBy:String((browser as any).handledBy||'secure-browser'),
  }
}

export async function tryRunWhatsAppAttentionCommand(params:{
  user:ResolvedUser
  text:string
  messageId?:string|number|null
}):Promise<WhatsAppAgentResult|null>{
  const actor=actorFromResolvedUser(params.user)
  if(!actor)return null

  if(await shouldHandleOpenLoopAction({actor,text:params.text})){
    const action=await handleOpenLoopAction({actor,text:params.text})
    if(action)return {...action,handledBy:String(action.handledBy||'open-loops')}
  }

  if(await shouldHandleOpenLoopResolution({actor,text:params.text})){
    const resolution=await handleOpenLoopResolution({actor,text:params.text})
    if(resolution)return {...resolution,handledBy:String(resolution.handledBy||'open-loops')}
  }

  const query=await handleOpenLoopQuery({actor,text:params.text})
  if(query)return {...query,handledBy:String(query.handledBy||'open-loops')}
  return null
}

export async function tryRunWhatsAppAgent(params: {
  user: ResolvedUser
  text: string
  messageId?: string | number | null
}): Promise<WhatsAppAgentResult | null> {
  const actor = actorFromResolvedUser(params.user)
  if (!actor) return null

  const decision = approvalIntent(params.text)
  if (decision) {
    const approval = await resolveLatestApproval(actor, decision)
    if (approval) return approval
  }

  const goal = await tryCreateGoal(actor, params.text)
  if (goal) return goal

  const autonomyControl=await tryRunAdaptiveAutonomyCommand({actor,text:params.text})
  if(autonomyControl)return {...autonomyControl,handledBy:String(autonomyControl.handledBy||'adaptive-autonomy')}

  const attentionCommand=await tryRunWhatsAppAttentionCommand(params)
  if(attentionCommand)return attentionCommand

  const connectionStatus = await tryGetConnectionStatus({ actor, text:params.text })
  if (connectionStatus) return { ...connectionStatus, handledBy:String(connectionStatus.handledBy || 'connection-status') }

  const autonomyStatus = await tryGetAutonomyStatus({ actor, text:params.text })
  if (autonomyStatus) return { ...autonomyStatus, handledBy:String(autonomyStatus.handledBy || 'autonomy-status') }

  const watcherStop = await tryStopWatcherFromCommand({ actor, text:params.text })
  if (watcherStop) return { ...watcherStop, handledBy:String(watcherStop.handledBy || 'watcher-stop') }

  const watcherStatus = await tryGetWatcherStatusFromCommand({ actor, text:params.text })
  if (watcherStatus) return { ...watcherStatus, handledBy:String(watcherStatus.handledBy || 'watcher-status') }

  const productWatchStatus = await tryGetProductStockWatchStatusFromCommand({ actor, text:params.text })
  if (productWatchStatus) return { ...productWatchStatus, handledBy:String(productWatchStatus.handledBy || 'product-stock-watch-status') }

  const inboxTriageWatch = await tryCreateInboxTriageWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (inboxTriageWatch) return { ...inboxTriageWatch, handledBy:String(inboxTriageWatch.handledBy || 'inbox-triage-watch') }

  const flightWatch = await tryCreateFlightWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (flightWatch) return { ...flightWatch, handledBy:String(flightWatch.handledBy || 'flight-watch') }

  const appointmentRecovery = await withWhatsAppBrowserBudget(actor, tryRecoverAppointmentOption({ actor, surface:'whatsapp', text:params.text }))
  if (appointmentRecovery) return { ...appointmentRecovery, handledBy:String((appointmentRecovery as any).handledBy || 'appointment-followup-recovery') }

  const appointmentFollowup = await tryRunAppointmentFollowup({ actor, surface:'whatsapp', text:params.text })
  if (appointmentFollowup) return { ...appointmentFollowup, text:`${appointmentFollowup.text || ''}${appointmentFollowup.status === 'waiting_approval' ? '\n\nReply *APPROVE* to continue or *REJECT* to stop.' : ''}`, handledBy:String(appointmentFollowup.handledBy || 'appointment-followup') }

  const appointmentResearch = await tryRunAppointmentResearch({ actor, surface:'whatsapp', text:params.text })
  if (appointmentResearch) return { ...appointmentResearch, handledBy:String(appointmentResearch.handledBy || 'appointment-research') }

  // CONTINUE resumes a paused handoff: a state read plus extraction, not a browser
  // session. It gets its own guard ABOVE the research call and is NOT wrapped in the
  // browser budget, whose timeout resolved falsy and let CONTINUE fall through.
  const trainResume = await tryResumeTrainHandoff({ actor, text:params.text })
  if (trainResume) return { ...trainResume, handledBy:String(trainResume.handledBy || 'train-handoff-resume') }

  const trainResearch = await withWhatsAppBrowserBudget(actor, tryRunTrainResearch({ actor, surface:'whatsapp', text:params.text }))
  if (trainResearch) return { ...(trainResearch as any), handledBy:String((trainResearch as any).handledBy || 'train-research') }

  if (shouldPreferSpecialistTravel(params.text)) {
    const specialistTravel = await tryRunTravelResearch({ actor, surface:'whatsapp', text:params.text })
    if (specialistTravel) {
      const hardened = await hardenTravelResearchResult(specialistTravel, params.text)
      return { ...hardened, handledBy:String(hardened.handledBy || 'travel-research') }
    }
  }

  const productStockWatch = await tryCreateProductStockWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (productStockWatch) return { ...productStockWatch, handledBy:String(productStockWatch.handledBy || 'product-stock-watch') }

  const webPageWatch = await tryCreateWebPageWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (webPageWatch) return { ...webPageWatch, handledBy:String(webPageWatch.handledBy || 'web-page-watch') }

  const webWatch = await tryCreateWebWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (webWatch) return { ...webWatch, handledBy:String(webWatch.handledBy || 'background-web-watch') }

  const browser = await withWhatsAppBrowserBudget(actor, tryRunBrowserCommand({ actor, surface:'whatsapp', text:params.text }))
  if (browser) return { ...(browser as any), text:`${(browser as any).text || ''}${(browser as any).status === 'waiting_approval' ? '\n\nReply *APPROVE* to continue or *REJECT* to stop.' : ''}`, handledBy:String((browser as any).handledBy || 'secure-browser') }

  const travelCalendar = await tryPrepareTravelCalendarPlan({ actor, surface:'whatsapp', text:params.text })
  if (travelCalendar) return { ...travelCalendar, text:`${travelCalendar.text || ''}${travelCalendar.status === 'waiting_approval' ? '\n\nReply *APPROVE* to add it, or *REJECT* to stop.' : ''}`, handledBy:String(travelCalendar.handledBy || 'travel-calendar-plan') }

  if(!(await capabilityIsOff(actor.legacyTelegramId,'reminders'))){
    const compound = await tryRunExpiryReminderPlan({ actor, surface:'whatsapp', text:params.text, messageId:params.messageId })
    if (compound) return { ...compound, handledBy:compound.handledBy }
  }

  const persistent = await tryRunPersistentGeneralPlan({ actor, surface:'whatsapp', text:params.text, messageId:params.messageId })
  if (persistent) return { ...persistent, handledBy:String(persistent.handledBy || 'persistent-general-plan') }

  const general = await tryRunGeneralPlan({ actor, surface:'whatsapp', text:params.text, messageId:params.messageId })
  if (general) return { ...general, text:`${general.text || ''}${general.status === 'waiting_approval' ? '\n\nReply *APPROVE* to continue or *REJECT* to stop.' : ''}`, handledBy:String(general.handledBy || 'general-plan') }

  const travel = await tryRunTravelResearch({ actor, surface:'whatsapp', text:params.text })
  if (travel) {
    const hardened = await hardenTravelResearchResult(travel, params.text)
    return { ...hardened, handledBy:String(hardened.handledBy || 'travel-research') }
  }

  return null
}
