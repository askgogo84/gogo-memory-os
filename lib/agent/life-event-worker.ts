import { supabaseAdmin } from '@/lib/supabase-admin'
import { runSecureBrowser } from './secure-computer'
import { sendAgentPush } from './push'
import type { AgentActor } from './actor'

const LEASE_MINUTES = 10

function safe(value: unknown, max = 600) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
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
  const { data, error } = await supabaseAdmin.from('life_event_actions')
    .update({ status: 'running', updated_at: now.toISOString(), payload_json: { ...(action.payload_json || {}), leaseUntil } })
    .eq('id', action.id)
    .in('status', ['queued','ready'])
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('LIFE_EVENT_ACTION_CLAIM_FAILED:', action.id, error.message)
    return false
  }
  return Boolean(data?.id)
}

async function markAction(id: string, status: 'completed' | 'blocked' | 'ready', extra: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('life_event_actions')
    .update({ status, payload_json: extra, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`life_event_action_update_failed:${error.message}`)
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

async function prepareFlightCheckin(params: { telegramId: string; event: any; action: any }) {
  const { telegramId, event, action } = params
  const payload = action.payload_json || {}
  const url = String(payload.checkInUrl || '').trim()
  const confirmation = String(payload.confirmationRef || event.confirmation_ref || '').trim()
  if (!url || !confirmation) {
    await markAction(String(action.id), 'blocked', { ...(payload || {}), blockedReason: 'missing_checkin_url_or_confirmation' })
    const runId = await createRun({ telegramId, event, action, status: 'paused', summary: 'Gogo could not safely prepare check-in because the verified check-in URL or booking reference is missing.' })
    await activity(telegramId, runId, 'life_event_blocked', 'Flight check-in preparation paused because required booking context is missing.', { life_event_id: event.id })
    return { status: 'blocked' as const, runId }
  }

  const actor = await resolveActor(telegramId)
  const runId = await createRun({
    telegramId, event, action, status: 'running',
    summary: 'Gogo is opening the airline site in the isolated Secure Computer and preparing the check-in form without submitting it.',
    metadata: { checkin_url: url, provider: event.provider || null, confirmation_ref_present: true },
  })

  try {
    const result = await runSecureBrowser({
      userId: actor.userId,
      url,
      mode: 'draft',
      objective: `Prepare web check-in for ${safe(event.title, 180)}. Booking reference/PNR: ${confirmation}. Fill only the fields required to reach the final check-in confirmation step. Do not submit check-in. Do not purchase a seat or add-on. If a paid seat is required, stop. If password, OTP, CAPTCHA, passkey, passport verification, payment authentication, or another human-auth step appears, stop for the user.`,
    })
    const at = new Date().toISOString()
    if (result.status === 'blocked') {
      await supabaseAdmin.from('agent_runs').update({ status: 'paused', progress: 55, summary: safe(result.summary, 1200), error: result.blockReason || 'browser_blocked', updated_at: at }).eq('id', runId).eq('telegram_id', telegramId)
      await markAction(String(action.id), 'blocked', { ...(payload || {}), browserRunId: runId, blockedReason: result.blockReason || 'browser_blocked' })
      await activity(telegramId, runId, 'human_auth_required', 'Gogo paused flight check-in at a human authentication boundary.', { life_event_id: event.id, auth_reason: result.authReason || null })
      await sendAgentPush(telegramId, { title: 'Gogo needs you for check-in', body: safe(result.summary || 'Airline check-in reached a secure step that only you can complete.', 280), path: '/agent', data: { runId, lifeEventId: String(event.id) } }).catch(() => {})
      return { status: 'blocked' as const, runId }
    }

    await supabaseAdmin.from('agent_runs').update({ status: 'completed', progress: 100, summary: 'Airline check-in is prepared in Gogo Secure Computer. Nothing was submitted.', completed_at: at, updated_at: at }).eq('id', runId).eq('telegram_id', telegramId)
    await markAction(String(action.id), 'completed', { ...(payload || {}), browserRunId: runId, preparedAt: at, browserUrl: result.url })
    await activity(telegramId, runId, 'life_event_prepared', 'Gogo prepared airline web check-in without submitting it.', { life_event_id: event.id, action_key: action.action_key })
    return { status: 'completed' as const, runId }
  } catch (error: any) {
    const at = new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({ status: 'failed', summary: 'Gogo could not prepare airline check-in safely.', error: safe(error?.message || 'secure_browser_failed', 400), completed_at: at, updated_at: at }).eq('id', runId).eq('telegram_id', telegramId)
    await markAction(String(action.id), 'blocked', { ...(payload || {}), browserRunId: runId, blockedReason: 'secure_browser_failed' })
    throw error
  }
}

async function requestFlightCheckinApproval(params: { telegramId: string; event: any; action: any }) {
  const { telegramId, event, action } = params
  const prepared = await supabaseAdmin.from('life_event_actions')
    .select('status,payload_json')
    .eq('life_event_id', event.id)
    .eq('action_key', 'prepare-web-checkin')
    .maybeSingle()
  if (prepared.error) throw new Error(`life_event_prepare_state_failed:${prepared.error.message}`)
  if (prepared.data?.status !== 'completed') {
    await markAction(String(action.id), 'ready', { ...(action.payload_json || {}), waitingFor: 'prepare-web-checkin' })
    return { status: 'deferred' as const }
  }

  const seat = freeSeatPolicy(event)
  const runId = await createRun({
    telegramId, event, action, status: 'waiting_approval',
    summary: 'Airline check-in is prepared. Waiting for your approval before Gogo submits it.',
    metadata: {
      plan_type: 'life_event_checkin',
      checkin_url: String((prepared.data.payload_json as any)?.checkInUrl || (action.payload_json as any)?.checkInUrl || ''),
      seat_policy: seat.policy,
    },
  })

  const { data: existing, error: existingError } = await supabaseAdmin.from('agent_approvals')
    .select('id,status')
    .eq('telegram_id', telegramId)
    .eq('run_id', runId)
    .eq('action_type', 'booking')
    .in('status', ['pending','approved'])
    .limit(1)
    .maybeSingle()
  if (existingError) throw new Error(`life_event_approval_lookup_failed:${existingError.message}`)

  let approvalId = String(existing?.id || '')
  if (!approvalId) {
    const { data, error } = await supabaseAdmin.from('agent_approvals').insert({
      telegram_id: telegramId,
      run_id: runId,
      action_type: 'booking',
      title: 'Approve airline web check-in',
      description: 'Gogo has prepared the airline check-in flow. Approval allows Gogo to submit check-in using the saved booking context. Paid seats/add-ons, payment authentication, OTPs, CAPTCHAs, passkeys and other human-auth steps remain separate and will stop for you.',
      payload_preview: [
        { label: 'Flight', value: safe(event.title, 180) },
        { label: 'Airline', value: safe(event.provider || 'Airline', 120) },
        { label: 'Seat policy', value: seat.label },
        { label: 'Payment', value: 'No paid seat/add-on without separate approval' },
      ],
      execution_payload: { plan_type: 'life_event_checkin', lifeEventId: String(event.id), lifeEventActionId: String(action.id), action: 'submit_web_checkin' },
      risk_level: 'high',
      status: 'pending',
    }).select('id').single()
    if (error || !data?.id) throw new Error(`life_event_approval_create_failed:${error?.message || 'unknown'}`)
    approvalId = String(data.id)
  }

  await markAction(String(action.id), 'waiting_approval', { ...(action.payload_json || {}), runId, approvalId, seatPolicy: seat.policy })
  await supabaseAdmin.from('life_events').update({ lifecycle_state: 'waiting_approval', updated_at: new Date().toISOString() }).eq('id', event.id).eq('telegram_id', telegramId)
  await activity(telegramId, runId, 'approval_requested', 'Approval required before Gogo submits airline web check-in.', { approval_id: approvalId, life_event_id: event.id })
  await sendAgentPush(telegramId, { title: 'Check-in is ready', body: `${safe(event.title, 160)} is prepared. Approve when you want Gogo to submit check-in.`, path: '/agent', data: { runId, approvalId, lifeEventId: String(event.id) } }).catch(() => {})
  return { status: 'waiting_approval' as const, runId, approvalId }
}

async function processAction(action: any, event: any, telegramId: string) {
  if (action.action_key === 'prepare-web-checkin' && event.event_type === 'travel' && event.subtype === 'flight') {
    return prepareFlightCheckin({ telegramId, event, action })
  }
  if (action.action_key === 'checkin-submit-approval' && event.event_type === 'travel' && event.subtype === 'flight') {
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

  // email_watch / monitor / calendar_draft are intentionally left queued for their
  // dedicated connector executors. Do not fake completion or create noisy polling.
  await markAction(String(action.id), 'ready', { ...(action.payload_json || {}), executorPending: true })
  return { status: 'deferred' as const }
}

export async function processDueLifeEventActions(limit = 12) {
  const now = new Date()
  const { data, error } = await supabaseAdmin.from('life_event_actions')
    .select('id,life_event_id,telegram_id,action_key,action_type,capability,title,due_at,requires_approval,irreversible,status,payload_json,created_at')
    .in('status', ['queued','ready'])
    .not('due_at', 'is', null)
    .lte('due_at', now.toISOString())
    .order('due_at', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`life_event_due_read_failed:${error.message}`)

  let checked = 0, claimed = 0, completed = 0, waitingApproval = 0, blocked = 0, deferred = 0, failed = 0
  for (const action of (data || []) as any[]) {
    checked++
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
  return { checked, claimed, completed, waitingApproval, blocked, deferred, failed }
}
