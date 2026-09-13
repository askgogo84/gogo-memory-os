import { supabaseAdmin } from '@/lib/supabase-admin'
import { runSecureBrowser } from './secure-computer'
import { sendAgentPush } from './push'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import { evaluateAgentSentinel } from './sentinel'
import type { AgentActor } from './actor'

const LEASE_MINUTES = 10
const DEFER_PENDING_EXECUTOR_MINUTES = 60

function safe(value: unknown, max = 600) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

async function browserPermission(telegramId: string): Promise<AgentPermissionLevel> {
  const { data, error } = await supabaseAdmin.from('agent_permissions')
    .select('level')
    .eq('telegram_id', telegramId)
    .eq('capability', 'browser')
    .maybeSingle()
  if (error) throw new Error(`life_event_browser_permission_failed:${error.message}`)
  return (data?.level as AgentPermissionLevel | undefined) || 'ask'
}

async function resolveActor(telegramId: string): Promise<AgentActor> {
  const { data, error } = await supabaseAdmin.from('users')
    .select('id,telegram_id,whatsapp_id,name')
    .eq('telegram_id', Number(telegramId))
    .maybeSingle()
  if (error) throw new Error(`life_event_actor_lookup_failed:${error.message}`)
  if (!data?.id || !data?.telegram_id) throw new Error('life_event_actor_missing')
  return {
    userId: String(data.id),
    legacyTelegramId: Number(data.telegram_id),
    whatsappId: String(data.whatsapp_id || ''),
    name: String(data.name || 'Gogo'),
  }
}

async function claimAction(action: any, now: Date) {
  const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString()
  const expectedStatus = String(action.status || 'queued')
  let query = supabaseAdmin.from('life_event_actions')
    .update({ status: 'running', updated_at: now.toISOString(), payload_json: { ...(action.payload_json || {}), leaseUntil } })
    .eq('id', action.id)
    .eq('status', expectedStatus)
  if (expectedStatus === 'running' && action.updated_at) query = query.eq('updated_at', action.updated_at)
  const { data, error } = await query.select('id').maybeSingle()
  if (error) {
    console.error('LIFE_EVENT_ACTION_CLAIM_FAILED:', action.id, error.message)
    return false
  }
  return Boolean(data?.id)
}

async function markAction(id: string, status: 'completed' | 'blocked' | 'ready' | 'waiting_approval', extra: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('life_event_actions')
    .update({ status, payload_json: extra, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`life_event_action_update_failed:${error.message}`)
}

async function deferAction(action: any, minutes: number, extra: Record<string, unknown> = {}) {
  const now = new Date()
  const dueAt = new Date(now.getTime() + Math.max(1, minutes) * 60_000).toISOString()
  const { error } = await supabaseAdmin.from('life_event_actions')
    .update({
      status: 'ready',
      due_at: dueAt,
      payload_json: { ...(action.payload_json || {}), ...extra, deferredUntil: dueAt },
      updated_at: now.toISOString(),
    })
    .eq('id', action.id)
    .eq('status', 'running')
  if (error) throw new Error(`life_event_action_defer_failed:${error.message}`)
}

async function createRun(params: { telegramId: string; event: any; action: any; status: string; summary: string; metadata?: Record<string, unknown> }) {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: params.telegramId,
    type: 'life_event',
    capability: params.action.capability,
    status: params.status,
    title: `Gogo · ${safe(params.event.title, 140)}`,
    summary: safe(params.summary, 1200),
    progress: params.status === 'completed' ? 100 : params.status === 'waiting_approval' ? 90 : 50,
    why: 'Background Gogo is carrying the next safe step for a saved life event.',
    source: 'background_life_event',
    metadata_json: {
      plan_type: 'life_event',
      life_event_id: String(params.event.id),
      life_event_action_id: String(params.action.id),
      action_key: String(params.action.action_key),
      ...(params.metadata || {}),
    },
    started_at: now,
    updated_at: now,
    completed_at: params.status === 'completed' ? now : null,
  }).select('id').single()
  if (error || !data?.id) throw new Error(`life_event_run_create_failed:${error?.message || 'unknown'}`)
  return String(data.id)
}

async function activity(telegramId: string, runId: string | null, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: telegramId,
    run_id: runId,
    event_type: eventType,
    message: safe(message, 900),
    metadata_json: metadata,
  })
  if (error) console.error('LIFE_EVENT_ACTIVITY_FAILED:', error.message)
}

function freeSeatPolicy(event: any) {
  const pref = event?.preferences_json || {}
  const seat = safe(pref.seatPreference || pref.seat_preference || '', 100)
  if (seat) return { label: seat, policy: 'remembered_preference' }
  return { label: 'Free allocation only', policy: 'free_allocation_only' }
}

function airlineUrl(event: any) {
  const meta = event?.metadata_json || {}
  const provider = safe(event?.provider || '', 120).toLowerCase()
  const urls = [meta.checkinUrl, meta.checkin_url, meta.providerUrl, meta.provider_url].map((x) => safe(x, 600)).filter(Boolean)
  const first = urls.find((x) => /^https?:\/\//i.test(x))
  if (first) return first
  if (/air india/.test(provider)) return 'https://www.airindia.com/in/en/manage/check-in.html'
  if (/indigo/.test(provider)) return 'https://www.goindigo.in/web-check-in.html'
  if (/akasa/.test(provider)) return 'https://www.akasaair.com/check-in'
  if (/spicejet/.test(provider)) return 'https://www.spicejet.com/'
  return null
}

async function prepareFlightCheckin(params: { telegramId: string; event: any; action: any }) {
  const { telegramId, event, action } = params
  const actor = await resolveActor(telegramId)
  const url = airlineUrl(event)
  if (!url) {
    await markAction(String(action.id), 'blocked', { ...(action.payload_json || {}), blockedReason: 'airline_checkin_url_missing' })
    return { status: 'blocked' as const }
  }

  const seat = freeSeatPolicy(event)
  const runId = await createRun({ telegramId, event, action, status: 'completed', summary: `Prepared web check-in for ${event.title}.` })
  const page = await runSecureBrowser({ userId: actor.userId, url, intent: `Prepare airline web check-in for ${event.title}. Do not submit any irreversible action. Prefer ${seat.label}.` })
  await markAction(String(action.id), 'completed', { ...(action.payload_json || {}), preparedAt: new Date().toISOString(), browserSummary: safe(page.summary, 1200), seatPolicy: seat })
  await activity(telegramId, runId, 'life_event_checkin_prepared', `Prepared web check-in for ${event.title}.`, { life_event_id: event.id, seat_policy: seat })
  return { status: 'completed' as const, runId }
}

async function requestFlightCheckinApproval(params: { telegramId: string; event: any; action: any }) {
  const { telegramId, event, action } = params
  const level = await browserPermission(telegramId)
  const sentinel = evaluateAgentSentinel({ capability: 'browser', actionType: 'submit_web_checkin', text: action.title, context: { irreversible: true } })
  const policy = evaluateAgentExecutionPolicy({ capability: 'browser', permission: level, irreversible: true, sentinelBlocked: !sentinel.allowed })
  if (!sentinel.allowed || policy.decision === 'block') {
    await markAction(String(action.id), 'blocked', { ...(action.payload_json || {}), blockedReason: sentinel.reason || policy.reason || 'sentinel_blocked' })
    return { status: 'blocked' as const }
  }
  const now = new Date().toISOString()
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: telegramId,
    type: 'life_event',
    capability: 'browser',
    status: 'waiting_approval',
    title: `Gogo · ${safe(event.title, 140)}`,
    summary: `Ready to submit web check-in for ${safe(event.title, 180)} after your approval.`,
    progress: 90,
    why: 'Airline check-in is an external consequential action, so Gogo waits for approval.',
    source: 'background_life_event',
    metadata_json: { plan_type: 'life_event_checkin', life_event_id: String(event.id), life_event_action_id: String(action.id), action_key: String(action.action_key) },
    started_at: now,
    updated_at: now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`life_event_checkin_run_failed:${runError?.message || 'unknown'}`)
  const { error: approvalError } = await supabaseAdmin.from('agent_approvals').insert({
    run_id: String(run.id),
    telegram_id: telegramId,
    action_type: 'submit_web_checkin',
    title: `Check in for ${safe(event.title, 140)}`,
    description: 'Submit airline web check-in using the saved booking details and free seat preference.',
    payload_preview: [`Flight: ${safe(event.title, 180)}`, `Seat policy: ${freeSeatPolicy(event).label}`],
    risk_level: 'high',
    status: 'pending',
    payload_json: { lifeEventId: String(event.id), lifeEventActionId: String(action.id), airlineUrl: airlineUrl(event), seatPolicy: freeSeatPolicy(event) },
    requested_at: now,
  })
  if (approvalError) throw new Error(`life_event_checkin_approval_failed:${approvalError.message}`)
  await markAction(String(action.id), 'waiting_approval', { ...(action.payload_json || {}), runId: String(run.id), approvalRequestedAt: now })
  await activity(telegramId, String(run.id), 'life_event_checkin_approval_requested', `Approval requested for ${event.title}.`, { life_event_id: event.id })
  return { status: 'waiting_approval' as const, runId: String(run.id) }
}

async function stopUncertainReclaimedCheckin(telegramId: string, event: any, action: any) {
  await markAction(String(action.id), 'blocked', { ...(action.payload_json || {}), blockedReason: 'checkin_execution_state_uncertain', stoppedAt: new Date().toISOString() })
  await activity(telegramId, null, 'life_event_checkin_reclaim_blocked', `A stale check-in action for ${event.title} was stopped safely instead of being retried.`, { life_event_id: event.id, life_event_action_id: action.id })
  return { status: 'blocked' as const }
}

async function processAction(action: any, event: any, telegramId: string) {
  if (action.action_key === 'prepare-web-checkin' && event.event_type === 'travel' && event.subtype === 'flight') {
    return prepareFlightCheckin({ telegramId, event, action })
  }
  if (action.action_key === 'checkin-submit-approval' && event.event_type === 'travel' && event.subtype === 'flight') {
    if (action.status === 'running') return stopUncertainReclaimedCheckin(telegramId, event, action)
    return requestFlightCheckinApproval({ telegramId, event, action })
  }

  if (action.action_type === 'notify' || action.action_type === 'prepare') {
    const runId = await createRun({ telegramId, event, action, status: 'completed', summary: action.title })
    await markAction(String(action.id), 'completed', { ...(action.payload_json || {}), completedAt: new Date().toISOString() })
    await activity(telegramId, runId, 'life_event_step_completed', action.title, { life_event_id: event.id, action_key: action.action_key })
    if (action.action_type === 'notify') {
      await sendAgentPush(telegramId, { title: 'Gogo has something ready', body: safe(`${event.title}: ${action.title}`, 280), path: '/agent', data: { runId, lifeEventId: String(event.id) } }).catch(() => {})
    }
    return { status: 'completed' as const, runId }
  }

  await deferAction(action, DEFER_PENDING_EXECUTOR_MINUTES, { executorPending: true })
  return { status: 'deferred' as const }
}

function sortDueActions(rows: any[]) {
  return rows.sort((a, b) => {
    const ad = a.due_at ? new Date(a.due_at).getTime() : 0
    const bd = b.due_at ? new Date(b.due_at).getTime() : 0
    if (ad !== bd) return ad - bd
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  })
}

export async function processDueLifeEventActions(limit = 12) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - LEASE_MINUTES * 60_000).toISOString()
  const select = 'id,life_event_id,telegram_id,action_key,action_type,capability,title,due_at,requires_approval,irreversible,status,payload_json,created_at,updated_at'
  const [dueResult, staleResult] = await Promise.all([
    supabaseAdmin.from('life_event_actions')
      .select(select)
      .in('status', ['queued','ready'])
      .neq('action_type','email_watch')
      .not('due_at', 'is', null)
      .lte('due_at', now.toISOString())
      .order('due_at', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(limit),
    supabaseAdmin.from('life_event_actions')
      .select(select)
      .eq('status', 'running')
      .neq('action_type','email_watch')
      .lte('updated_at', staleBefore)
      .order('updated_at', { ascending: true })
      .limit(limit),
  ])
  if (dueResult.error) throw new Error(`life_event_due_read_failed:${dueResult.error.message}`)
  if (staleResult.error) throw new Error(`life_event_stale_read_failed:${staleResult.error.message}`)

  const byId = new Map<string, any>()
  for (const row of [...(staleResult.data || []), ...(dueResult.data || [])] as any[]) byId.set(String(row.id), row)
  const rows = sortDueActions([...byId.values()]).slice(0, limit)

  let checked = 0, claimed = 0, completed = 0, waitingApproval = 0, blocked = 0, deferred = 0, failed = 0, reclaimed = 0
  for (const action of rows) {
    checked++
    if (action.status === 'running') reclaimed++
    if (!(await claimAction(action, now))) continue
    claimed++
    try {
      const { data: event, error: eventError } = await supabaseAdmin.from('life_events')
        .select('id,telegram_id,event_type,subtype,title,provider,start_at,end_at,timezone,location,confirmation_ref,lifecycle_state,participants,preferences_json,metadata_json,source_refs')
        .eq('id', action.life_event_id)
        .eq('telegram_id', String(action.telegram_id))
        .maybeSingle()
      if (eventError) throw new Error(`life_event_read_failed:${eventError.message}`)
      if (!event) throw new Error('life_event_missing')
      const result = await processAction(action, event, String(action.telegram_id))
      if (result.status === 'completed') completed++
      else if (result.status === 'waiting_approval') waitingApproval++
      else if (result.status === 'blocked') blocked++
      else deferred++
    } catch (error: any) {
      failed++
      console.error('LIFE_EVENT_ACTION_FAILED:', action.id, error?.message || error)
      await markAction(String(action.id), 'blocked', { ...(action.payload_json || {}), blockedReason: safe(error?.message || 'life_event_action_failed', 300) }).catch(() => {})
      await activity(String(action.telegram_id), null, 'life_event_step_failed', 'A Background Gogo life-event step failed safely.', { life_event_id: action.life_event_id, action_key: action.action_key }).catch(() => {})
    }
  }
  return { checked, claimed, completed, waitingApproval, blocked, deferred, failed, reclaimed }
}
