import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshAccessToken } from '@/lib/google-calendar'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentActor } from './actor'

const PLAN_TYPE = 'workspace_meeting_prep'

function safe(value: unknown, max = 500) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

function validEmail(value: unknown) {
  const email = String(value || '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function validIso(value: unknown) {
  const text = String(value || '').trim()
  const ms = Date.parse(text)
  return text && Number.isFinite(ms) ? text : ''
}

function eventIdForRun(runId: string) {
  // Calendar custom event ids accept lowercase base32hex characters. A SHA-256
  // hex digest stays within that alphabet and makes retries idempotent.
  return `gogo${createHash('sha256').update(runId).digest('hex').slice(0, 32)}`
}

function parseInvite(raw: any) {
  const attendee = validEmail(raw?.attendee)
  const start = validIso(raw?.start)
  const end = validIso(raw?.end)
  const timezone = safe(raw?.timezone || 'Asia/Kolkata', 80) || 'Asia/Kolkata'
  const title = safe(raw?.title || 'Meeting', 180) || 'Meeting'
  if (!attendee || !start || !end || new Date(end).getTime() <= new Date(start).getTime()) return null
  return { attendee, start, end, timezone, title }
}

export async function attachWorkspaceMeetingApproval(params: { actor: AgentActor; result: any }) {
  const result = params.result
  if (!result || result.handledBy !== 'workspace-meeting-prep' || result.status !== 'completed' || !result.runId) return result

  const tg = String(params.actor.legacyTelegramId)
  const { data: run, error: runError } = await supabaseAdmin
    .from('agent_runs')
    .select('metadata_json')
    .eq('id', String(result.runId))
    .eq('telegram_id', tg)
    .maybeSingle()
  if (runError) throw new Error(`workspace_meeting_approval_run_read_failed:${runError.message}`)
  if (!run) return result

  const meta: any = run.metadata_json || {}
  if (String(meta.plan_type || '') !== PLAN_TYPE) return result
  const invite = parseInvite(meta.proposedInvite)
  if (!invite) {
    return {
      ...result,
      text: `${String(result.text || '').trim()}\n\nI did not create an approval card because the attendee or proposed slot was not unambiguously resolved. Nothing was scheduled.`,
    }
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('agent_approvals')
    .select('id,status')
    .eq('run_id', String(result.runId))
    .eq('telegram_id', tg)
    .eq('action_type', 'calendar_change')
    .in('status', ['pending','approved'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingError) throw new Error(`workspace_meeting_approval_lookup_failed:${existingError.message}`)

  let approvalId = existing?.id ? String(existing.id) : ''
  if (!approvalId) {
    const { data: approval, error } = await supabaseAdmin.from('agent_approvals').insert({
      telegram_id: tg,
      run_id: String(result.runId),
      action_type: 'calendar_change',
      title: 'Create the proposed meeting invite',
      description: 'This will create the prepared Google Calendar event and send the Calendar invitation to the resolved attendee. The prepared Gmail reply will remain unsent.',
      payload_preview: [
        { label: 'Meeting', value: invite.title },
        { label: 'Attendee', value: invite.attendee },
        { label: 'Starts', value: invite.start },
        { label: 'Ends', value: invite.end },
        { label: 'Email reply', value: 'Prepared only — not sent' },
      ],
      execution_payload: {
        plan_type: PLAN_TYPE,
        action: 'create_calendar_invite',
        artifactId: String(result.artifactId || meta.artifactId || ''),
      },
      risk_level: 'medium',
      status: 'pending',
    }).select('id').single()
    if (error || !approval?.id) throw new Error(`workspace_meeting_approval_create_failed:${error?.message || 'unknown'}`)
    approvalId = String(approval.id)

    const { error: activityError } = await supabaseAdmin.from('agent_activity').insert({
      telegram_id: tg,
      run_id: String(result.runId),
      event_type: 'approval_requested',
      message: 'Approval required before creating the prepared Calendar invite.',
      metadata_json: { approval_id: approvalId, action_type: 'calendar_change', source: PLAN_TYPE },
    })
    if (activityError) console.error('WORKSPACE_MEETING_APPROVAL_ACTIVITY_FAILED:', activityError.message)
  }

  const { error: updateError } = await supabaseAdmin.from('agent_runs').update({
    status: 'waiting_approval',
    progress: 90,
    summary: 'Meeting reply and invite are prepared. Waiting for approval before creating the Calendar invite.',
    updated_at: new Date().toISOString(),
  }).eq('id', String(result.runId)).eq('telegram_id', tg)
  if (updateError) throw new Error(`workspace_meeting_approval_run_update_failed:${updateError.message}`)

  return {
    ...result,
    status: 'waiting_approval',
    capability: 'calendar',
    risk: 'medium',
    approvalId,
    approvalRequired: true,
    text: `${String(result.text || '').trim()}\n\nApproval required: create the proposed Calendar invite for ${invite.attendee}. The Gmail reply will stay unsent.`,
  }
}

async function calendarToken(actor: AgentActor) {
  const { data, error } = await supabaseAdmin.from('users')
    .select('google_calendar_connected,google_refresh_token')
    .eq('telegram_id', actor.legacyTelegramId)
    .maybeSingle()
  if (error) throw new Error(`workspace_meeting_calendar_credentials_failed:${error.message}`)
  if (!data?.google_calendar_connected || !data?.google_refresh_token) throw new Error('calendar_not_connected')
  const token = await refreshAccessToken(String(data.google_refresh_token))
  if (!token) throw new Error('calendar_reconnect_required')
  return token
}

async function createOrConfirmCalendarInvite(params: { actor: AgentActor; runId: string; invite: NonNullable<ReturnType<typeof parseInvite>> }) {
  const token = await calendarToken(params.actor)
  const eventId = eventIdForRun(params.runId)
  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all`
  const body = {
    id: eventId,
    summary: params.invite.title,
    start: { dateTime: params.invite.start, timeZone: params.invite.timezone },
    end: { dateTime: params.invite.end, timeZone: params.invite.timezone },
    attendees: [{ email: params.invite.attendee }],
    extendedProperties: { private: { askgogo_run_id: params.runId, askgogo_source: PLAN_TYPE } },
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const data: any = await response.json().catch(() => ({}))
  if (response.ok) return { eventId: String(data?.id || eventId), htmlLink: String(data?.htmlLink || ''), reused: false }

  // A retry after an uncertain network response must not create a second invite.
  // The deterministic event id lets us verify the already-created event instead.
  if (response.status === 409) {
    const existing = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    const current: any = await existing.json().catch(() => ({}))
    const attendee = validEmail(current?.attendees?.[0]?.email)
    const start = validIso(current?.start?.dateTime)
    const end = validIso(current?.end?.dateTime)
    if (existing.ok && attendee.toLowerCase() === params.invite.attendee.toLowerCase() && start === params.invite.start && end === params.invite.end) {
      return { eventId: String(current?.id || eventId), htmlLink: String(current?.htmlLink || ''), reused: true }
    }
  }

  if (response.status === 401 || response.status === 403) throw new Error('calendar_reconnect_required')
  throw new Error(`workspace_meeting_calendar_create_failed:${response.status}:${safe(data?.error?.message || '', 180)}`)
}

export async function executeApprovedWorkspaceMeetingPlan(params: { actor: AgentActor; runId: string }) {
  const tg = String(params.actor.legacyTelegramId)
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs')
    .select('metadata_json,status')
    .eq('id', params.runId)
    .eq('telegram_id', tg)
    .maybeSingle()
  if (runError) throw new Error(`workspace_meeting_run_read_failed:${runError.message}`)
  if (!run) throw new Error('agent_run_not_found')

  const meta: any = run.metadata_json || {}
  if (String(meta.plan_type || '') !== PLAN_TYPE) throw new Error('not_workspace_meeting_plan')
  const invite = parseInvite(meta.proposedInvite)
  if (!invite) throw new Error('workspace_meeting_invite_invalid')

  const { data: approval, error: approvalError } = await supabaseAdmin.from('agent_approvals')
    .select('id,status,execution_payload')
    .eq('run_id', params.runId)
    .eq('telegram_id', tg)
    .eq('action_type', 'calendar_change')
    .eq('status', 'approved')
    .order('resolved_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (approvalError) throw new Error(`workspace_meeting_approval_read_failed:${approvalError.message}`)
  if (!approval || approval?.execution_payload?.action !== 'create_calendar_invite') throw new Error('approval_required')

  try {
    const created = await createOrConfirmCalendarInvite({ actor: params.actor, runId: params.runId, invite })
    const now = new Date().toISOString()
    const nextMeta = {
      ...meta,
      calendarExecution: {
        eventId: created.eventId,
        htmlLink: created.htmlLink,
        reused: created.reused,
        executedAt: now,
        attendee: invite.attendee,
      },
    }
    const { error: runUpdateError } = await supabaseAdmin.from('agent_runs').update({
      status: 'completed',
      progress: 100,
      summary: 'Approved Calendar invite created. The prepared Gmail reply remains unsent.',
      metadata_json: nextMeta,
      completed_at: now,
      updated_at: now,
    }).eq('id', params.runId).eq('telegram_id', tg)
    if (runUpdateError) throw new Error(`workspace_meeting_run_complete_failed:${runUpdateError.message}`)

    await supabaseAdmin.from('agent_approvals').update({ status: 'executed', executed_at: now })
      .eq('id', approval.id).eq('telegram_id', tg).eq('status', 'approved')

    const { error: activityError } = await supabaseAdmin.from('agent_activity').insert({
      telegram_id: tg,
      run_id: params.runId,
      event_type: 'calendar_invite_created',
      message: 'Approved Calendar invite created for the prepared meeting.',
      metadata_json: { approval_id: approval.id, event_id: created.eventId, source: PLAN_TYPE, idempotent_reuse: created.reused },
    })
    if (activityError) console.error('WORKSPACE_MEETING_EXECUTION_ACTIVITY_FAILED:', activityError.message)

    return {
      runId: params.runId,
      status: 'completed' as const,
      capability: 'calendar' as const,
      risk: 'medium' as const,
      handledBy: 'workspace-meeting-prep' as const,
      text: `Done. I created the approved Calendar invite for ${invite.attendee}. The prepared Gmail reply was not sent.`,
      eventId: created.eventId,
      eventUrl: created.htmlLink || undefined,
    }
  } catch (err: any) {
    const code = String(err?.message || '')
    if (code === 'calendar_not_connected' || code === 'calendar_reconnect_required') {
      const now = new Date().toISOString()
      await supabaseAdmin.from('agent_runs').update({
        status: 'paused',
        summary: 'Approval is recorded, but Calendar needs to be reconnected before the invite can be created.',
        updated_at: now,
      }).eq('id', params.runId).eq('telegram_id', tg)
      return {
        runId: params.runId,
        status: 'paused' as const,
        capability: 'calendar' as const,
        risk: 'medium' as const,
        handledBy: 'workspace-meeting-prep' as const,
        text: 'Your approval is recorded, but Google Calendar needs to be reconnected before I can create the invite. I did not send the Gmail reply or create a duplicate event.',
      }
    }
    throw err
  }
}
