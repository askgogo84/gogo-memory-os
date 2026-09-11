import { supabaseAdmin } from '@/lib/supabase-admin'
import { runSecureBrowser } from './secure-computer'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import { evaluateAgentSentinel } from './sentinel'
import type { AgentActor } from './actor'

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

export async function executeApprovedLifeEventCheckin(params: { actor: AgentActor; runId: string }) {
  const tg = String(params.actor.legacyTelegramId)
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs')
    .select('id,status,metadata_json')
    .eq('id', params.runId)
    .eq('telegram_id', tg)
    .maybeSingle()
  if (runError) throw new Error(`life_event_checkin_run_read_failed:${runError.message}`)
  if (!run) throw new Error('agent_run_not_found')
  const meta: any = run.metadata_json || {}
  if (String(meta.plan_type || '') !== 'life_event_checkin') throw new Error('not_life_event_checkin')

  const lifeEventId = String(meta.life_event_id || '')
  const lifeEventActionId = String(meta.life_event_action_id || '')
  if (!lifeEventId || !lifeEventActionId) throw new Error('life_event_context_missing')

  const [{ data: event, error: eventError }, { data: action, error: actionError }, { data: approval, error: approvalError }] = await Promise.all([
    supabaseAdmin.from('life_events')
      .select('id,event_type,subtype,title,provider,confirmation_ref,preferences_json,metadata_json')
      .eq('id', lifeEventId).eq('telegram_id', tg).maybeSingle(),
    supabaseAdmin.from('life_event_actions')
      .select('id,status,payload_json')
      .eq('id', lifeEventActionId).eq('life_event_id', lifeEventId).eq('telegram_id', tg).maybeSingle(),
    supabaseAdmin.from('agent_approvals')
      .select('id,status,execution_payload')
      .eq('run_id', params.runId).eq('telegram_id', tg).eq('action_type', 'booking').eq('status', 'approved')
      .order('resolved_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (eventError) throw new Error(`life_event_checkin_event_read_failed:${eventError.message}`)
  if (actionError) throw new Error(`life_event_checkin_action_read_failed:${actionError.message}`)
  if (approvalError) throw new Error(`life_event_checkin_approval_read_failed:${approvalError.message}`)
  if (!event || !action) throw new Error('life_event_context_missing')
  if (!approval || (approval.execution_payload as any)?.action !== 'submit_web_checkin') throw new Error('approval_required')
  if (event.event_type !== 'travel' || event.subtype !== 'flight') throw new Error('not_flight_life_event')

  const confirmation = String(event.confirmation_ref || '').trim()
  const url = String(meta.checkin_url || (event.metadata_json as any)?.checkInUrl || '').trim()
  if (!confirmation || !url) throw new Error('checkin_context_incomplete')

  // Re-check permission and Sentinel at execution time. A user can revoke Browser
  // access after approving but before execution, and that revocation must win.
  const permissionLevel = await browserPermission(tg)
  const policy = evaluateAgentExecutionPolicy({
    capability: 'browser',
    permissionLevel,
    mode: 'execute',
    risk: 'high',
    irreversible: true,
    approvalStatus: 'approved',
  })
  if (!policy.allowed) throw new Error(policy.reason)
  const sentinel = evaluateAgentSentinel({
    capability: 'browser',
    mode: 'execute',
    risk: 'high',
    irreversible: true,
    approved: true,
    instruction: 'Submit the already-approved airline web check-in without buying add-ons or handling credentials.',
    url,
    actionCount: 12,
  })
  if (!sentinel.allowed) throw new Error(`sentinel_${sentinel.reason}`)

  const pref: any = event.preferences_json || {}
  const seatPreference = safe(pref.seatPreference || pref.seat_preference || '', 100)
  const seatInstruction = seatPreference
    ? `Use the remembered seat preference "${seatPreference}" only when it is free. Do not purchase a paid seat or add-on.`
    : 'Use free seat allocation only. Do not purchase a paid seat or add-on.'

  const now = new Date().toISOString()
  await supabaseAdmin.from('agent_runs').update({
    status: 'running', progress: 55,
    summary: 'Approved check-in is running in Gogo Secure Computer.',
    updated_at: now,
  }).eq('id', params.runId).eq('telegram_id', tg)
  await supabaseAdmin.from('life_event_actions').update({ status: 'running', updated_at: now })
    .eq('id', lifeEventActionId).eq('telegram_id', tg)
  await supabaseAdmin.from('life_events').update({ lifecycle_state: 'in_progress', updated_at: now })
    .eq('id', lifeEventId).eq('telegram_id', tg)

  const result = await runSecureBrowser({
    userId: params.actor.userId,
    url,
    mode: 'execute',
    objective: `Complete the already-approved airline web check-in for ${safe(event.title, 180)}. Booking reference/PNR: ${confirmation}. ${seatInstruction} Do not buy baggage, meals, upgrades, insurance, priority boarding, or any other paid add-on. If a password, OTP, CAPTCHA, passkey, passport/identity verification, payment authentication, or any new charge/terms beyond ordinary check-in appears, stop before that step and return control to the user.`,
  })
  const at = new Date().toISOString()

  if (result.status === 'blocked') {
    await supabaseAdmin.from('agent_runs').update({
      status: 'paused', progress: 65, summary: safe(result.summary || 'Gogo paused at a secure human step.', 1000),
      error: result.blockReason || 'human_auth_required', updated_at: at,
    }).eq('id', params.runId).eq('telegram_id', tg)
    await supabaseAdmin.from('life_event_actions').update({
      status: 'blocked',
      payload_json: { ...(action.payload_json as any || {}), blockedReason: result.blockReason || 'human_auth_required', authReason: result.authReason || null, blockedAt: at },
      updated_at: at,
    }).eq('id', lifeEventActionId).eq('telegram_id', tg)
    await supabaseAdmin.from('agent_activity').insert({
      telegram_id: tg, run_id: params.runId, event_type: 'human_auth_required',
      message: 'Gogo paused approved airline check-in at a human authentication or protected step.',
      metadata_json: { life_event_id: lifeEventId, action_id: lifeEventActionId, auth_reason: result.authReason || null },
    })
    return {
      runId: params.runId,
      status: 'paused' as const,
      capability: 'browser' as const,
      risk: 'high' as const,
      handledBy: 'life-event-checkin' as const,
      blockedReason: 'human_auth_required' as const,
      text: `${safe(result.summary || 'Check-in reached a secure step.', 900)}\n\nI stopped before the protected step. I did not request, infer, or store a password, OTP, passkey, CAPTCHA response, or payment-auth value.`,
    }
  }

  await Promise.all([
    supabaseAdmin.from('agent_runs').update({
      status: 'completed', progress: 100,
      summary: 'Approved airline web check-in completed. Gogo will continue watching for the boarding pass/confirmation.',
      completed_at: at, updated_at: at,
    }).eq('id', params.runId).eq('telegram_id', tg),
    supabaseAdmin.from('life_event_actions').update({
      status: 'completed',
      payload_json: { ...(action.payload_json as any || {}), executedAt: at, resultUrl: result.url },
      updated_at: at,
    }).eq('id', lifeEventActionId).eq('telegram_id', tg),
    supabaseAdmin.from('life_events').update({ lifecycle_state: 'watching', updated_at: at })
      .eq('id', lifeEventId).eq('telegram_id', tg),
    supabaseAdmin.from('agent_approvals').update({ status: 'executed', executed_at: at })
      .eq('id', approval.id).eq('telegram_id', tg).eq('status', 'approved'),
  ])
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: tg, run_id: params.runId, event_type: 'life_event_checkin_completed',
    message: 'Approved airline web check-in completed in Gogo Secure Computer.',
    metadata_json: { life_event_id: lifeEventId, action_id: lifeEventActionId, provider: event.provider || null },
  })

  return {
    runId: params.runId,
    status: 'completed' as const,
    capability: 'travel' as const,
    risk: 'high' as const,
    handledBy: 'life-event-checkin' as const,
    text: 'Done. I completed the approved airline check-in without purchasing a paid seat or add-on. I’ll keep the trip in a watching state for the boarding pass/confirmation flow.',
  }
}
