import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ResolvedUser } from '@/lib/bot/resolve-user'
import type { AgentActor } from './actor'
import { tryCreateWebWatchFromCommand } from './watch-command'
import { tryRunBrowserCommand, executeApprovedBrowserCommand } from './browser-command'
import { tryPrepareTravelCalendarPlan, executeApprovedTravelCalendarPlan } from './travel-calendar-plan'
import { tryRunExpiryReminderPlan } from './compound-planner'
import { tryRunGeneralPlan, resumeApprovedGeneralPlan } from './general-planner'
import { executeApprovedAgentRun } from './orchestrator'
import { initializeBackgroundGoal } from './goal-engine'

export type WhatsAppAgentResult = {
  text: string
  runId?: string
  status?: string
  handledBy: string
}

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
  }).then(({ error }) => { if (error) console.error('WHATSAPP_AGENT_GOAL_ACTIVITY_FAILED:', error.message) })
  try {
    const plan = await initializeBackgroundGoal({telegramId:String(actor.legacyTelegramId),goalId:String(data.id),title:goal.title,outcome:goal.outcome})
    return { text:`Goal created: *${goal.title}*\n\nBackground Gogo has a ${plan.steps.length}-step plan and will keep reviewing it. You can track progress in *Dashboard → Gogo Agent*.`, status:'active', handledBy:'whatsapp-agent-goal' }
  } catch (err:any) {
    await supabaseAdmin.from('agent_goals').update({status:'blocked',blockers:['Background planning failed.'],updated_at:new Date().toISOString()}).eq('id',data.id)
    console.error('WHATSAPP_AGENT_GOAL_INIT_FAILED:',err?.message||err)
    return { text:`I created the goal *${goal.title}*, but Background Gogo could not initialize its plan yet. It is saved as blocked for review in the dashboard.`, status:'blocked', handledBy:'whatsapp-agent-goal' }
  }
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

  const webWatch = await tryCreateWebWatchFromCommand({ actor, surface:'whatsapp', text:params.text })
  if (webWatch) return { ...webWatch, handledBy:String(webWatch.handledBy || 'background-web-watch') }

  const browser = await tryRunBrowserCommand({ actor, surface:'whatsapp', text:params.text })
  if (browser) return { ...browser, text:`${browser.text || ''}${browser.status === 'waiting_approval' ? '\n\nReply *APPROVE* to continue or *REJECT* to stop.' : ''}`, handledBy:String(browser.handledBy || 'secure-browser') }

  const travelCalendar = await tryPrepareTravelCalendarPlan({ actor, surface:'whatsapp', text:params.text })
  if (travelCalendar) return { ...travelCalendar, text:`${travelCalendar.text || ''}${travelCalendar.status === 'waiting_approval' ? '\n\nReply *APPROVE* to add it, or *REJECT* to stop.' : ''}`, handledBy:String(travelCalendar.handledBy || 'travel-calendar-plan') }

  const compound = await tryRunExpiryReminderPlan({ actor, surface:'whatsapp', text:params.text, messageId:params.messageId })
  if (compound) return { ...compound, handledBy:compound.handledBy }

  const general = await tryRunGeneralPlan({ actor, surface:'whatsapp', text:params.text, messageId:params.messageId })
  if (general) return { ...general, text:`${general.text || ''}${general.status === 'waiting_approval' ? '\n\nReply *APPROVE* to continue or *REJECT* to stop.' : ''}`, handledBy:String(general.handledBy || 'general-plan') }

  return null
}
