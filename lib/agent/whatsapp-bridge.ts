import { tryRunWorkspaceDriveContext } from './workspace-drive-context'
import {tryFlightBooking} from './flight-booking'
import { tryAccountSiteAnswer, accountSiteFromText } from './account-site-gate'
import { tryTypedTimeRouting } from './typed-time-routing'
import { executeApprovedCalendarUpdate } from './calendar-update'
import { executeApprovedReminderUpdate } from './reminder-update'
import { verifiedReadEvidence } from './read-evidence'
import { approvalChoiceList, expiredApprovalReply, partitionPendingApprovals } from './approval-ttl'
import { expirePendingApproval, guardApprovalFreshness, latestApprovalChoices, rememberApprovalChoices } from './approval-guard'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ResolvedUser } from '@/lib/bot/resolve-user'
import type { AgentActor } from './actor'
import { decisionDomain, recordDecisionLearning, isSameBrainIntrospection, sameBrainIntrospection } from './decision-learning'
import { observedOutcome, learningDecisionId } from './decision-evidence'
import { isGmailVerificationQuery } from './gmail-verification'
import { tryCreateFlightWatchFromCommand, tryCreateInboxTriageWatchFromCommand, tryCreateProductStockWatchFromCommand, tryCreateWebPageWatchFromCommand, tryCreateWebWatchFromCommand, tryGetProductStockWatchStatusFromCommand, tryRunPriceWatchClarification, tryGetWatcherStatusFromCommand, tryStopWatcherFromCommand, tryRestartWatcherFromCommand, tryUpdateWebWatchFromCommand } from './watch-command'
import { tryRunBrowserCommand, executeApprovedBrowserCommand, queueBrowserRead } from './browser-command'
import { triggerApprovedBrowserRun } from './approved-browser-worker'
import { tryRunExternalAccountFlow } from './external-account'
import { tryPrepareTravelCalendarPlan, executeApprovedTravelCalendarPlan } from './travel-calendar-plan'
import { tryRunExpiryReminderPlan } from './compound-planner'
import { prepareGeneralPlanForActor, tryRunGeneralPlan, resumeApprovedGeneralPlan } from './general-planner'
import { tryRunPersistentGeneralPlan } from './persistent-general-plan'
import { tryRunTravelResearch, isTravelResearchDetailsReply } from './travel-research'
import { hardenTravelResearchResult } from './travel-research-sanitize'
import { shouldPreferSpecialistTravel } from './specialist-routing'
import { tryResumeTrainHandoff, tryRunTrainResearch } from './train-research'
import { executeApprovedAgentRun } from './orchestrator'
import { dispatchThroughSameBrain } from './same-brain'
import { executeApprovedLifeEventCheckin } from './life-event-execution'
import { executeApprovedBookingCalendar } from './booking-calendar-execution'
import { initializeBackgroundGoal } from './goal-engine'
import { tryGetAutonomyStatus, tryGetConnectionStatus } from './autonomy-status'
import { parseTaskStatusQuery, tryGetTaskStatus } from './task-status'
import { executeApprovedGmailSend, tryRunGmailSendCommand, tryRunGmailContextCommand } from './gmail-send'
import { tryRunAdaptiveTrustCommand } from './adaptive-trust'
import { capabilityIsOff, parseAutonomyCommand } from './adaptive-autonomy'
import { tryRunAdaptiveAutonomyCommand } from './adaptive-autonomy'
import { handleInboxReplyRead, handleOpenLoopAction, handleOpenLoopQuery, handleOpenLoopResolution, shouldHandleOpenLoopAction, shouldHandleOpenLoopResolution } from './open-loops'
import { tryRecoverAppointmentOption } from './appointment-followup-recovery'
import { tryRunAppointmentFollowup } from './appointment-followup'
import { tryRunAppointmentResearch } from './appointment-research'
import { armApprovedRestaurantReservation, queueRestaurantReservationResearch, tryRunRestaurantReservation } from './restaurant-reservation'
import { isDecisionRecallQuery } from './recall-query'
import { tryCancelRunFromChat } from './run-cancel'

export type WhatsAppAgentResult = {
  text: string
  runId?: string
  status?: string
  handledBy: string
  verification?: {verified:boolean;source:string;kind:string;objectKind:string;objectRef:string|null}
  conversationPersisted?: boolean
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

export function approvalIntent(text: string): 'approve' | 'reject' | null {
  // WhatsApp keeps the quotes a user copies from a test message, often as curly quotes (“Approve”),
  // and phone keyboards add a trailing full stop. Strip both so the same word always resolves.
  const t = String(text || '')
    .trim()
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`.!]+$/g, '')
    .replace(/[‘’]/g, "'")
    .toLowerCase()
  // "approve 2" / "approve #2" / "reject 1" pick one card from a numbered list of pending approvals.
  if (/^(approve|approved|yes[ ,]+approve|approve it|go ahead with it|proceed with it)$/i.test(t)) return 'approve'
  if (/^(approve|yes[ ,]+approve)\s*#?\s*\d{1,2}$/i.test(t)) return 'approve'
  if (/^(reject|rejected|deny|decline|reject it|do not proceed|don't proceed|cancel that action)$/i.test(t)) return 'reject'
  if (/^(reject|deny|decline)\s*#?\s*\d{1,2}$/i.test(t)) return 'reject'
  return null
}

/** The decision plus, for "approve 2" / "reject #1", the 1-based item from the numbered list. */
export function parseApprovalIntent(text: string): { decision: 'approve' | 'reject'; index?: number } | null {
  const decision = approvalIntent(text)
  if (!decision) return null
  const t = String(text || '').trim().replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`.!]+$/g, '')
  const numbered = t.match(/(\d{1,2})$/)
  return numbered ? { decision, index: Number(numbered[1]) } : { decision }
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
        text: `That site took too long to load, so I stopped waiting. Nothing was bought, booked or submitted. Try again in a minute, or ask me on the dashboard where I can wait longer: https://app.askgogo.in/dashboard/chat`,
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

// Bounded window of the newest pending approvals. Expiry and numbering are decided from this window.
async function latestPendingApprovals(telegramId: number) {
  const { data, error } = await supabaseAdmin.from('agent_approvals')
    .select('id,run_id,title,action_type,risk_level,status,requested_at,execution_payload')
    .eq('telegram_id', String(telegramId))
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(`whatsapp_agent_approval_read_failed:${error.message}`)
  return (data || []) as any[]
}

// An approval past its lifetime is closed as expired and never executed. Its run is paused so no
// worker can pick it up; a fresh preparation and approval is required.
async function expirePendingApprovals(actor: AgentActor, rows: any[], now: Date) {
  for (const row of rows) await expirePendingApproval(actor.legacyTelegramId, row, now, 'whatsapp')
}

function approvalChoicePrompt(live: any[], liveTotal: number, now: Date) {
  const more = liveTotal > live.length ? ` (showing the latest ${live.length} of ${liveTotal})` : ''
  const lastNumber = live.length > 1 ? 2 : 1
  return `${approvalChoiceList(live, now)}${more ? `\n${more.trim()}` : ''}\n\nReply approve 1 or reject ${lastNumber}.`
}

// Every numbered list shown is persisted as the exact ordered ids, so "approve N" can only ever
// resolve against what the person actually saw.
async function shownApprovalChoices(actor: AgentActor, live: any[], liveTotal: number, now: Date) {
  await rememberApprovalChoices(actor.legacyTelegramId, live.map((row) => String(row.id)), now)
  return approvalChoicePrompt(live, liveTotal, now)
}

// Bare "Approve" with one live approval behaves as before. With several, or with an expired card in
// the way, nothing runs until the person names the item. "approve 2" resolves item 2 of the latest
// numbered list shown (persisted, 30-minute lifetime), never a list recomputed now: no fresh list
// means the list is shown again and nothing runs; an item that has since expired or been handled is
// refused. Expired approvals are closed, never executed, and never numbered.
async function resolveLatestApproval(actor: AgentActor, intent: { decision: 'approve' | 'reject'; index?: number }): Promise<WhatsAppAgentResult | null> {
  const rows = await latestPendingApprovals(actor.legacyTelegramId)
  if (!rows.length) return null
  const nowDate = new Date()
  const { expired, live, liveTotal } = partitionPendingApprovals(rows, nowDate)
  if (expired.length) await expirePendingApprovals(actor, expired, nowDate)
  const newestExpired = expired[expired.length - 1]
  if (intent.index != null) {
    const snapshot = await latestApprovalChoices(actor.legacyTelegramId, nowDate)
    if (!snapshot) {
      if (!live.length) return { text: expiredApprovalReply(newestExpired?.requested_at, nowDate), runId: newestExpired?.run_id || undefined, status: 'expired', handledBy: 'whatsapp-agent-approval' }
      const count = live.length === 1 ? 'You have 1 pending approval' : `You have ${live.length} pending approvals`
      return { text: `I don't have a current numbered list for ${intent.decision} ${intent.index}, so nothing was done. ${count}:\n${await shownApprovalChoices(actor, live, liveTotal, nowDate)}`, status: 'waiting_approval', handledBy: 'whatsapp-agent-approval-choice' }
    }
    if (!Number.isInteger(intent.index) || intent.index < 1 || intent.index > snapshot.length) {
      if (!live.length) return { text: expiredApprovalReply(newestExpired?.requested_at, nowDate), runId: newestExpired?.run_id || undefined, status: 'expired', handledBy: 'whatsapp-agent-approval' }
      const count = live.length === 1 ? 'There is only 1 pending approval' : `There are ${live.length} pending approvals`
      return { text: `${count}, so there is no number ${intent.index}. Nothing was done.\n\n${await shownApprovalChoices(actor, live, liveTotal, nowDate)}`, status: 'waiting_approval', handledBy: 'whatsapp-agent-approval-choice' }
    }
    const chosenId = snapshot[intent.index - 1]
    // Looked up among every pending row, not just the five newest, so a card that arrived after the
    // list was shown can never shift which item a number refers to.
    let chosen = rows.find((row) => String(row.id) === chosenId && !expired.includes(row))
    const justExpired = expired.find((row) => String(row.id) === chosenId)
    let reason = justExpired ? expiredApprovalReply(justExpired.requested_at, nowDate) : ''
    if (!chosen && !reason) {
      const { data: prior, error: priorError } = await supabaseAdmin.from('agent_approvals')
        .select('id,run_id,title,action_type,risk_level,status,requested_at,execution_payload').eq('id', chosenId).eq('telegram_id', String(actor.legacyTelegramId)).maybeSingle()
      if (priorError) throw new Error(`whatsapp_agent_approval_read_failed:${priorError.message}`)
      if (prior?.status === 'pending') chosen = prior
      else reason = prior?.status === 'expired'
          ? expiredApprovalReply(prior.requested_at, nowDate)
          : `Approval ${intent.index} from that list is no longer pending${prior?.status ? ` (it was already ${prior.status})` : ''}. Nothing was done.`
    }
    if (!chosen) {
      if (!live.length) return { text: reason, runId: justExpired?.run_id || undefined, status: justExpired ? 'expired' : 'paused', handledBy: 'whatsapp-agent-approval' }
      const still = live.length === 1 ? 'You still have 1 pending approval:' : `You still have ${live.length} pending approvals:`
      return { text: `${reason}\n\n${still}\n${await shownApprovalChoices(actor, live, liveTotal, nowDate)}`, status: 'waiting_approval', handledBy: 'whatsapp-agent-approval-choice' }
    }
    return resolveApprovalDecision(actor, chosen, intent.decision)
  }
  if (!live.length) {
    return { text: expiredApprovalReply(newestExpired?.requested_at, nowDate), runId: newestExpired?.run_id || undefined, status: 'expired', handledBy: 'whatsapp-agent-approval' }
  }
  if (live.length === 1 && !expired.length) return resolveApprovalDecision(actor, live[0], intent.decision)
  const lead = expired.length
    ? `${expiredApprovalReply(newestExpired.requested_at, nowDate)}\n\n${live.length === 1 ? 'You still have 1 pending approval:' : `You still have ${live.length} pending approvals. Which one do you mean?`}`
    : `You have ${live.length} pending approvals. Which one do you mean? Nothing was done yet.`
  return { text: `${lead}\n${await shownApprovalChoices(actor, live, liveTotal, nowDate)}`, status: 'waiting_approval', handledBy: 'whatsapp-agent-approval-choice' }
}

async function resolveApprovalDecision(actor: AgentActor, pending: any, decision: 'approve' | 'reject'): Promise<WhatsAppAgentResult | null> {
  // The shared freshness guard runs at the moment of the transition, not only when the list was built.
  const fresh = await guardApprovalFreshness({ telegramId: actor.legacyTelegramId, row: pending, surface: 'whatsapp' })
  if (fresh.expired) return { text: fresh.text, runId: pending.run_id || undefined, status: 'expired', handledBy: 'whatsapp-agent-approval' }
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
  // Secure-browser submits can outlive the webhook budget (60s on Vercel). The approval queues
  // the run and hands it to the internal approved-browser route, which runs it with a 300s
  // budget and sends the outcome back on WhatsApp. The webhook never runs the browser itself.
  if (planType === 'secure_browser') {
    const trigger = await triggerApprovedBrowserRun(String(data.run_id))
    if (trigger !== 'dispatched') console.error('APPROVED_BROWSER_HANDOFF_NOT_DISPATCHED:', data.run_id, trigger)
    return { text:'Approved. Gogo is running it in the secure browser now and will message you the result here.', runId:String(data.run_id), status:'running', handledBy:'whatsapp-agent-approval' }
  }
  const result = planType === 'calendar_update'
    ? await executeApprovedCalendarUpdate({actor,runId:String(data.run_id)})
    : planType === 'reminder_update'
    ? await executeApprovedReminderUpdate({actor,runId:String(data.run_id)})
    : planType === 'memory_ticket_to_calendar'
    ? await executeApprovedTravelCalendarPlan({ actor, runId:String(data.run_id) })
    : planType === 'secure_browser'
      ? await executeApprovedBrowserCommand({ actor, runId:String(data.run_id) })
      : planType === 'general_multi_tool'
        ? await resumeApprovedGeneralPlan({ actor, runId:String(data.run_id) })
        : planType === 'life_event_checkin'
          ? await executeApprovedLifeEventCheckin({ actor, runId:String(data.run_id) })
          : planType === 'booking_event_calendar'
            ? await executeApprovedBookingCalendar({ actor, runId:String(data.run_id) })
            : planType === 'restaurant_reservation_release'
              ? await armApprovedRestaurantReservation({ actor, runId:String(data.run_id) })
            : planType === 'gmail_send'
              ? await executeApprovedGmailSend({ actor, runId:String(data.run_id) })
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

// 18 Oct live: "show my goals" answered "I could not find a list called goals" although a goal was active.
async function tryListGoals(actor: AgentActor, text: string): Promise<WhatsAppAgentResult | null> {
  if (!/^(?:show|list|what are|view|see)?\s*(?:me\s+)?(?:all\s+)?(?:my\s+)?(?:active\s+)?goals\??$/i.test(String(text || '').trim())) return null
  const { data, error } = await supabaseAdmin.from('agent_goals').select('title,status,updated_at')
    .eq('telegram_id', String(actor.legacyTelegramId)).in('status', ['active', 'blocked', 'waiting']).order('updated_at', { ascending: false }).limit(10)
  if (error) throw new Error(`goal_list_failed:${error.message}`)
  if (!data?.length) return { text: 'You have no active goals. Start one like “set a goal to walk 8000 steps daily”.', status: 'completed', handledBy: 'whatsapp-agent-goal' }
  const lines = data.map((g: any, i: number) => `${i + 1}. ${g.title}${g.status === 'active' ? '' : ` (${g.status})`}`)
  return { text: `🎯 *Your goals*\n\n${lines.join('\n')}\n\nProgress is in *Dashboard → Goals*.`, status: 'completed', handledBy: 'whatsapp-agent-goal' }
}

async function tryCreateGoal(actor: AgentActor, text: string): Promise<WhatsAppAgentResult | null> {
  const listed = await tryListGoals(actor, text)
  if (listed) return listed
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
    const next=plan.steps[0]?.title||'the next safe step'
    return { text:`Got it — I’ll keep working on *${goal.title}*.\n\nNext: *${next}*. I’ll only interrupt you if I need your input or approval. You can see progress in *Dashboard → Goals*.`, status:'active', handledBy:'whatsapp-agent-goal' }
  } catch (err:any) {
    await supabaseAdmin.from('agent_goals').update({status:'blocked',blockers:['Background planning failed.'],updated_at:new Date().toISOString()}).eq('id',data.id)
    console.error('WHATSAPP_AGENT_GOAL_INIT_FAILED:',err?.message||err)
    return { text:`I saved *${goal.title}*, but I couldn’t start the next step yet. It’s waiting for review in *Dashboard → Goals*.`, status:'blocked', handledBy:'whatsapp-agent-goal' }
  }
}

// "Where is my Amazon order?": answered from the shop's emails when possible; not connected -> the Connect link;
// connected -> signing in and reading the account
// takes longer than a WhatsApp reply can wait, so it runs in the background and the answer is sent here.
async function accountSiteReply(actor: AgentActor, text: string): Promise<WhatsAppAgentResult | null> {
  const accountGate = await tryAccountSiteAnswer(actor, text)
  if (accountGate) return { text: accountGate.text, status: accountGate.status, handledBy: accountGate.handledBy } as any
  const accountSite = accountSiteFromText(text)
  if (!accountSite) return null
  const queued = await queueBrowserRead({ actor, surface:'whatsapp', text }).catch(() => null)
  if (!queued) return null
  return { text:`Checking your ${accountSite.name} account now. I'll send the answer here in a minute or two. If ${accountSite.name} asks for a code or a check only you can do, I'll send you a link to finish it.`, status:'running', handledBy:'account-site-background-read' } as any
}

/**
 * "Check my Swiggy account", "Where is my Amazon order?": the person named the site, so nothing is ambiguous.
 * 16 Oct live: on WhatsApp the ambiguity guard answered "I'm not certain which item you mean" before this ran.
 */
export async function tryRunWhatsAppAccountSite(params:{user:ResolvedUser;text:string}):Promise<WhatsAppAgentResult|null>{
  if(!accountSiteFromText(params.text))return null
  const actor=actorFromResolvedUser(params.user)
  if(!actor)return null
  return accountSiteReply(actor,params.text)
}

export async function tryRunWhatsAppJevSpecialist(params:{
  user:ResolvedUser
  text:string
  messageId?:string|number|null
  intent:'watcher'|'reminder_read'|'reminder_mutation'|'email_read'|'email_mutation'|'list_task'|'memory_context'|'travel_research'|'browser_action'
}):Promise<WhatsAppAgentResult|null>{
  const actor=actorFromResolvedUser(params.user)
  if(!actor)return null

  if(params.intent==='reminder_read'||params.intent==='reminder_mutation'){
    // Jev is only a semantic hint. Autonomy-control commands must be allowed to
    // reach the control handler even when the target capability is currently off.
    if(parseAutonomyCommand(params.text))return null
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

  if(params.intent==='email_mutation'){
    const gmail=await tryRunGmailSendCommand({actor,text:params.text})
    return gmail ? {...gmail,handledBy:String(gmail.handledBy||'gmail-send')} : null
  }

  if(params.intent==='email_read'){
    if(parseAutonomyCommand(params.text))return null
    if(await capabilityIsOff(actor.legacyTelegramId,'email')){
      return {text:'Email is currently off in your Gogo autonomy settings. Say *set email autonomy to read* (or *draft*) to turn it back on.',status:'paused',handledBy:'adaptive-autonomy'}
    }
    if(!/\b(?:email|emails|mail|gmail|inbox)\b/i.test(params.text))return null
    const result=await dispatchThroughSameBrain({actor,text:params.text,messageId:params.messageId})
    return result?.text ? {text:result.text,handledBy:String(result.handledBy||'same-brain'),conversationPersisted:true} : null
  }

  if(params.intent==='list_task'||params.intent==='memory_context'){
    if(parseAutonomyCommand(params.text))return null
    const capability=params.intent==='list_task'?'lists':'memory'
    if(await capabilityIsOff(actor.legacyTelegramId,capability)){
      return {text:`${capability==='lists'?'Lists':'Memory'} are currently off in your Gogo autonomy settings. Say *set ${capability} autonomy to auto* (or *ask*) to turn it back on.`,status:'paused',handledBy:'adaptive-autonomy'}
    }
    const result=await dispatchThroughSameBrain({actor,text:params.text,messageId:params.messageId})
    return result?.text ? {text:result.text,handledBy:String(result.handledBy||'same-brain'),conversationPersisted:true} : null
  }

  if(params.intent==='watcher'){
    const priceClarification=await tryRunPriceWatchClarification({actor,surface:'whatsapp',text:params.text})
    if(priceClarification)return {...priceClarification,handledBy:String(priceClarification.handledBy||'price-watch-clarification')}
    const corrected=await tryUpdateWebWatchFromCommand({actor,text:params.text})
    if(corrected)return corrected
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
    return await learnedReturn(actor,params.text,hardened,'travel-research',params.messageId)
  }

  const accountReply=await accountSiteReply(actor,params.text)
  if(accountReply)return accountReply
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
  if(isGmailVerificationQuery(params.text))return null
  const actor=actorFromResolvedUser(params.user)
  if(!actor)return null

  const inboxReplyRead=await handleInboxReplyRead({actor,text:params.text})
  if(inboxReplyRead)return inboxReplyRead

  // "cancel that task" / "stop the flight booking": cancels the owner's in-flight agent run.
  // The parser refuses reminders, calendar, watches, lists, orders and Gmail, so their own cancel paths still win.
  const runCancel=await tryCancelRunFromChat({telegramId:actor.legacyTelegramId},params.text,{surface:'whatsapp'})
  if(runCancel)return runCancel

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

async function learnedReturn(actor:AgentActor,text:string,result:any,fallbackHandler:string,messageId?:string|number|null){
  if(!result)return null
  const handler=String(result.handledBy||fallbackHandler)
  const verified=verifiedReadEvidence(handler,result.status,result.verification)
  const outcome=verified?'verified_success':observedOutcome(result.status)
  await recordDecisionLearning({actor,text,decisionId:learningDecisionId(messageId,result.runId),domain:decisionDomain(String(result.capability||''),handler),handler,outcome,verified,objectKind:result.verification?.objectKind||null,objectRef:result.verification?.objectRef||result.runId||null}).catch(()=>{})
  return {...result,handledBy:handler}
}

// A short reply to a flight question Gogo just asked ("round trip", "2 adults, business", "yes") answers
// that question. It is not a vague reference to some other item, so it gets first refusal before the
// semantic ambiguity guard. Only a fresh, owner-bound pending question can claim it.
export async function tryAnswerOpenFlightQuestion(params:{user:ResolvedUser;text:string}){
  const bookingActor=actorFromResolvedUser(params.user)
  if(bookingActor){
    const booking=await tryFlightBooking({actor:bookingActor,surface:'whatsapp',text:params.text})
    if(booking)return booking as any
  }
  if(!isTravelResearchDetailsReply(params.text))return null
  const actor=actorFromResolvedUser(params.user)
  if(!actor)return null
  const travel=await tryRunTravelResearch({actor,surface:'whatsapp',text:params.text})
  if(!travel)return null
  const hardened=await hardenTravelResearchResult(travel,params.text)
  return {...hardened,handledBy:String(hardened.handledBy||'travel-research')}
}

/**
 * "Any update?", "what are you working on", "how's the Goa trip going": deterministic task-status reads,
 * given first refusal on WhatsApp before semantic routing can treat them as chat or a new request.
 * A named ask with no matching task returns null so routing continues.
 */
export async function tryRunWhatsAppTaskStatus(params:{user:ResolvedUser;text:string}):Promise<WhatsAppAgentResult|null>{
  if(!parseTaskStatusQuery(params.text))return null
  const actor=actorFromResolvedUser(params.user)
  if(!actor)return null
  const named=await tryGetTaskStatus({telegramId:actor.legacyTelegramId},params.text)
  if(named)return named
  const general=await tryGetAutonomyStatus({actor,text:params.text})
  return general?{...general,handledBy:String(general.handledBy||'autonomy-status')}:null
}

export async function tryRunWhatsAppAgent(params: {
  user: ResolvedUser
  text: string
  messageId?: string | number | null
}): Promise<WhatsAppAgentResult | null> {
  // A past decision is a context lookup, never authority for a new booking.
  if(isDecisionRecallQuery(params.text))return null
  const actor = actorFromResolvedUser(params.user)
  if (!actor) return null

  const typedReply=await tryTypedTimeRouting({actor,text:params.text,surface:'whatsapp',messageId:params.messageId?String(params.messageId):null})
  if(typedReply)return typedReply

  // A disabled capability is a hard user preference. Stop any reminder-bearing
  // command before compound/persistent/general planners can recreate a reminder
  // through a different execution path. Autonomy-control commands are exempt so
  // the user can always turn the capability back on.
  if(!parseAutonomyCommand(params.text) && /\b(?:remind\s+me|reminders?)\b/i.test(params.text) && await capabilityIsOff(actor.legacyTelegramId,'reminders')){
    return {
      text:'Reminders are currently off in your Gogo autonomy settings. Say *set reminders autonomy to auto* (or *ask*) to turn them back on.',
      status:'paused',
      handledBy:'adaptive-autonomy',
    }
  }

  const decision = parseApprovalIntent(params.text)
  if (decision) {
    const approval = await resolveLatestApproval(actor, decision)
    if (approval) return approval
  }

  const accountReply = await accountSiteReply(actor, params.text)
  if (accountReply) return accountReply

  const goal = await tryCreateGoal(actor, params.text)
  if (goal) return goal

  if(isSameBrainIntrospection(params.text)){
    const report=await sameBrainIntrospection({actor,text:params.text})
    return {runId:'same-brain-introspection',status:'completed' as const,text:report,handledBy:'same-brain-introspection'}
  }

    const gmailContext=await tryRunGmailContextCommand({actor,text:params.text})
  if(gmailContext)return await learnedReturn(actor,params.text,gmailContext,'gmail-context',params.messageId)

    const gmailSend=await tryRunGmailSendCommand({actor,text:params.text})
  if(gmailSend)return await learnedReturn(actor,params.text,gmailSend,'gmail-send',params.messageId)

  const driveContext=await tryRunWorkspaceDriveContext({actor,surface:'whatsapp',text:params.text})
  if(driveContext)return driveContext

  const autonomyControl=await tryRunAdaptiveAutonomyCommand({actor,text:params.text})
  if(autonomyControl)return {...autonomyControl,handledBy:String(autonomyControl.handledBy||'adaptive-autonomy')}

  const trustControl=await tryRunAdaptiveTrustCommand({actor,text:params.text})
  if(trustControl)return {...trustControl,handledBy:String(trustControl.handledBy||'adaptive-trust')}

  const attentionCommand=await tryRunWhatsAppAttentionCommand(params)
  if(attentionCommand)return attentionCommand

  const connectionStatus = await tryGetConnectionStatus({ actor, text:params.text })
  if (connectionStatus) return { ...connectionStatus, handledBy:String(connectionStatus.handledBy || 'connection-status') }

  // A named task ("how's the Goa trip going") gets its own card; no matching run returns null.
  const taskStatus = await tryGetTaskStatus({ telegramId:actor.legacyTelegramId }, params.text)
  if (taskStatus) return taskStatus

  const autonomyStatus = await tryGetAutonomyStatus({ actor, text:params.text })
  if (autonomyStatus) return { ...autonomyStatus, handledBy:String(autonomyStatus.handledBy || 'autonomy-status') }

  // Price-watch clarification must run on the direct WhatsApp agent path too.
  // The route-level watcher first-refusal calls this function directly (not the Jev
  // specialist), so without this hook an underspecified price watch can fall through
  // to generic web search instead of creating durable watcher state.
  const priceWatch = await tryRunPriceWatchClarification({actor,surface:'whatsapp',text:params.text})
  if(priceWatch)return {...priceWatch,handledBy:String(priceWatch.handledBy||'price-watch-clarification')}

  const correctedWatch = await tryUpdateWebWatchFromCommand({actor,text:params.text})
  if(correctedWatch)return correctedWatch
  const watcherStop = await tryStopWatcherFromCommand({ actor, text:params.text })
  if (watcherStop) return await learnedReturn(actor,params.text,watcherStop,'watcher-stop',params.messageId)
  const watcherRestart = await tryRestartWatcherFromCommand({ actor, text:params.text })
  if (watcherRestart) return await learnedReturn(actor,params.text,watcherRestart,'watcher-restart',params.messageId)

  const watcherStatus = await tryGetWatcherStatusFromCommand({ actor, text:params.text })
  if (watcherStatus) return await learnedReturn(actor,params.text,watcherStatus,'watcher-status',params.messageId)

  const productWatchStatus = await tryGetProductStockWatchStatusFromCommand({ actor, text:params.text })
  if (productWatchStatus) return { ...productWatchStatus, handledBy:String(productWatchStatus.handledBy || 'product-stock-watch-status') }

  const inboxTriageWatch = await tryCreateInboxTriageWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (inboxTriageWatch) return { ...inboxTriageWatch, handledBy:String(inboxTriageWatch.handledBy || 'inbox-triage-watch') }

  const flightWatch = await tryCreateFlightWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (flightWatch) return await learnedReturn(actor,params.text,flightWatch,'flight-watch',params.messageId)

  // Product URL + explicit stock/size monitoring is deterministic shopping state,
  // never travel/booking/provider intent. Give it first refusal before appointment,
  // travel and generic browser/research handlers.
  const earlyProductStockWatch = await tryCreateProductStockWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (earlyProductStockWatch) return await learnedReturn(actor,params.text,earlyProductStockWatch,'product-stock-watch',params.messageId)

  // Restaurant reservation research is durable before any provider browsing starts.
  // WhatsApp returns quickly while Background Gogo gets the longer cron budget needed
  // for provider + first-party rule verification. No consequential action is created
  // until that background research produces grounded release evidence.
  const restaurantReservation = await queueRestaurantReservationResearch({
    actor,
    text:params.text,
    messageId:params.messageId,
  })
  if (restaurantReservation) return { ...(restaurantReservation as any), handledBy:String((restaurantReservation as any).handledBy || 'restaurant-reservation-background') }

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

  // A terse continuation must recover the last persisted travel task before generic
  // planners can reinterpret it as a fresh search.
  if(/^(?:continue|resume|carry on|keep going)\b/i.test(params.text.trim())){
    const continuedTravel=await tryRunTravelResearch({actor,surface:'whatsapp',text:params.text})
    if(continuedTravel){
      const hardened=await hardenTravelResearchResult(continuedTravel,params.text)
      return {...hardened,handledBy:String(hardened.handledBy||'travel-research')}
    }
  }

  if (shouldPreferSpecialistTravel(params.text) || isTravelResearchDetailsReply(params.text)) {
    const specialistTravel = await tryRunTravelResearch({ actor, surface:'whatsapp', text:params.text })
    if (specialistTravel) {
      const hardened = await hardenTravelResearchResult(specialistTravel, params.text)
      return await learnedReturn(actor,params.text,hardened,'travel-research',params.messageId)
    }
  }

  const webPageWatch = await tryCreateWebPageWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (webPageWatch) return await learnedReturn(actor,params.text,webPageWatch,'web-page-watch',params.messageId)

  const webWatch = await tryCreateWebWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (webWatch) return await learnedReturn(actor,params.text,webWatch,'background-web-watch',params.messageId)

  // Core v1 objective-first external-account flow. Claim account creation before
  // generic browser/freeform routing so the model cannot invent "no browser access".
  // Missing non-secret slots are collected first; execution stays behind approval,
  // Vault and human-auth boundaries.
  const externalAccount = await tryRunExternalAccountFlow({ actor, surface:'whatsapp', text:params.text, messageId:params.messageId })
  if (externalAccount) return { ...(externalAccount as any), handledBy:String((externalAccount as any).handledBy || 'external-account-objective') }

  const browser = await withWhatsAppBrowserBudget(actor, tryRunBrowserCommand({ actor, surface:'whatsapp', text:params.text }))
  if (browser) return { ...(browser as any), text:`${(browser as any).text || ''}${(browser as any).status === 'waiting_approval' ? '\n\nReply *APPROVE* to continue or *REJECT* to stop.' : ''}`, handledBy:String((browser as any).handledBy || 'secure-browser') }

  const travelCalendar = await tryPrepareTravelCalendarPlan({ actor, surface:'whatsapp', text:params.text })
  if (travelCalendar) return { ...travelCalendar, text:`${travelCalendar.text || ''}${travelCalendar.status === 'waiting_approval' ? '\n\nReply *APPROVE* to add it, or *REJECT* to stop.' : ''}`, handledBy:String(travelCalendar.handledBy || 'travel-calendar-plan') }

  if(!(await capabilityIsOff(actor.legacyTelegramId,'reminders'))){
    const compound = await tryRunExpiryReminderPlan({ actor, surface:'whatsapp', text:params.text, messageId:params.messageId })
    if (compound) return await learnedReturn(actor,params.text,compound,String(compound.handledBy||'compound-plan'),params.messageId)
  }

  const prepared=await prepareGeneralPlanForActor(actor,params.text)
  const persistent = await tryRunPersistentGeneralPlan({ actor, surface:'whatsapp', text:params.text, messageId:params.messageId, prepared })
  if (persistent) return await learnedReturn(actor,params.text,persistent,'persistent-general-plan',params.messageId)

  const general = await tryRunGeneralPlan({ actor, surface:'whatsapp', text:params.text, messageId:params.messageId, prepared })
  if (general) return { ...general, text:`${general.text || ''}${general.status === 'waiting_approval' ? '\n\nReply *APPROVE* to continue or *REJECT* to stop.' : ''}`, handledBy:String(general.handledBy || 'general-plan') }

  const travel = await tryRunTravelResearch({ actor, surface:'whatsapp', text:params.text })
  if (travel) {
    const hardened = await hardenTravelResearchResult(travel, params.text)
    return { ...hardened, handledBy:String(hardened.handledBy || 'travel-research') }
  }

  return null
}
