import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWorkspaceEmails, readWorkspaceEmailBrief } from './google-workspace-read'
import { sendAgentPush } from './push'
import type { AgentActor } from './actor'

const EMAIL_WATCH_RETRY_MINUTES = 10
const EMAIL_WATCH_ERROR_RETRY_MINUTES = 30
const EMAIL_WATCH_LEASE_MINUTES = 5
const BOARDING_PASS_CUTOFF_HOURS_AFTER_DEPARTURE = 6

function safe(value: unknown, max = 600) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalized(value: unknown) {
  return safe(value, 500).toLowerCase()
}

function compactRef(value: unknown) {
  return normalized(value).replace(/[^a-z0-9]/g, '')
}

function plusMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000).toISOString()
}

function cutoffAt(startAt: unknown) {
  const d = new Date(String(startAt || ''))
  if (!Number.isFinite(d.getTime())) return null
  return new Date(d.getTime() + BOARDING_PASS_CUTOFF_HOURS_AFTER_DEPARTURE * 3600_000).toISOString()
}

export type BoardingPassMatchInput = {
  subject?: string
  from?: string
  snippet?: string
  attachmentText?: string
  provider?: string | null
  confirmationRef?: string | null
  flightNo?: string | null
}

export function scoreBoardingPassCandidate(input: BoardingPassMatchInput) {
  const hay = normalized(`${input.subject || ''} ${input.from || ''} ${input.snippet || ''} ${input.attachmentText || ''}`)
  const compactHay = compactRef(hay)
  const confirmation = compactRef(input.confirmationRef)
  const flightNo = compactRef(input.flightNo)
  const provider = normalized(input.provider)

  const boardingSignal = /\b(boarding pass|check[- ]?in confirmation|checked in|web check[- ]?in|download (?:your )?boarding pass)\b/i.test(hay)
  const promoSignal = /\b(sale|offer|deal|discount|newsletter|promo|promotion|upgrade offer|miles offer)\b/i.test(hay)

  let score = 0
  let identitySignals = 0
  if (boardingSignal) score += 5
  if (confirmation && compactHay.includes(confirmation)) { score += 7; identitySignals++ }
  if (flightNo && compactHay.includes(flightNo)) { score += 5; identitySignals++ }
  if (provider && hay.includes(provider)) { score += 2; identitySignals++ }
  if (/\bboarding pass\b/i.test(hay)) score += 2
  if (/\b(check[- ]?in (?:complete|completed|confirmed|successful)|you(?:'|’)re checked in|you are checked in)\b/i.test(hay)) score += 2
  if (promoSignal && !boardingSignal) score -= 8

  return {
    score,
    boardingSignal,
    identitySignals,
    accepted: boardingSignal && identitySignals >= 1 && score >= 7,
  }
}

export function buildBoardingPassSearchText(event: any, action: any) {
  const payload = action?.payload_json || {}
  const pieces = [
    'boarding pass',
    'check-in confirmation',
    event?.provider,
    payload?.flightNo || event?.metadata_json?.flightNo,
    payload?.confirmationRef || event?.confirmation_ref,
  ].map((x) => safe(x, 100)).filter(Boolean)
  return pieces.join(' ')
}

async function resolveActor(telegramId: string): Promise<AgentActor> {
  const { data, error } = await supabaseAdmin.from('users')
    .select('id,telegram_id,whatsapp_id,name,gmail_connected')
    .eq('telegram_id', Number(telegramId))
    .maybeSingle()
  if (error) throw new Error(`life_event_email_actor_lookup_failed:${error.message}`)
  if (!data?.id || !data?.telegram_id) throw new Error('life_event_email_actor_missing')
  if (!data.gmail_connected) throw new Error('workspace_not_connected')
  return {
    userId: String(data.id),
    legacyTelegramId: Number(data.telegram_id),
    whatsappId: String(data.whatsapp_id || ''),
    name: String(data.name || 'Gogo'),
  }
}

async function claimAction(action: any, now: Date) {
  const leaseUntil = plusMinutes(now, EMAIL_WATCH_LEASE_MINUTES)
  const expectedStatus = String(action.status || 'ready')
  let query = supabaseAdmin.from('life_event_actions')
    .update({
      status: 'running',
      updated_at: now.toISOString(),
      payload_json: { ...(action.payload_json || {}), emailWatchLeaseUntil: leaseUntil },
    })
    .eq('id', action.id)
    .eq('status', expectedStatus)
  if (expectedStatus === 'running' && action.updated_at) query = query.eq('updated_at', action.updated_at)
  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw new Error(`life_event_email_claim_failed:${error.message}`)
  return Boolean(data?.id)
}

async function deferAction(action: any, minutes: number, extra: Record<string, unknown> = {}) {
  const now = new Date()
  const dueAt = plusMinutes(now, minutes)
  const { error } = await supabaseAdmin.from('life_event_actions').update({
    status: 'ready',
    due_at: dueAt,
    updated_at: now.toISOString(),
    payload_json: { ...(action.payload_json || {}), ...extra, emailWatchNextAt: dueAt },
  }).eq('id', action.id).eq('status', 'running')
  if (error) throw new Error(`life_event_email_defer_failed:${error.message}`)
}

async function completeAction(action: any, extra: Record<string, unknown> = {}) {
  const at = new Date().toISOString()
  const { error } = await supabaseAdmin.from('life_event_actions').update({
    status: 'completed',
    updated_at: at,
    payload_json: { ...(action.payload_json || {}), ...extra, completedAt: at },
  }).eq('id', action.id).eq('status', 'running')
  if (error) throw new Error(`life_event_email_complete_failed:${error.message}`)
}

async function createRun(telegramId: string, event: any, action: any, summary: string, metadata: Record<string, unknown>) {
  const at = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: telegramId,
    type: 'life_event',
    capability: 'email',
    status: 'completed',
    title: `Gogo · ${safe(event.title, 140)}`,
    summary: safe(summary, 1200),
    progress: 100,
    why: 'Background Gogo matched a connected Gmail message to a saved flight Life Event.',
    source: 'background_life_event',
    metadata_json: {
      plan_type: 'life_event_boarding_pass',
      life_event_id: String(event.id),
      life_event_action_id: String(action.id),
      action_key: String(action.action_key),
      ...metadata,
    },
    started_at: at,
    completed_at: at,
    updated_at: at,
  }).select('id').single()
  if (error || !data?.id) throw new Error(`life_event_email_run_create_failed:${error?.message || 'unknown'}`)
  return String(data.id)
}

async function activity(telegramId: string, runId: string | null, eventType: string, message: string, metadata: Record<string, unknown>) {
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: telegramId,
    run_id: runId,
    event_type: eventType,
    message: safe(message, 900),
    metadata_json: metadata,
  })
}

async function processBoardingPassWatch(action: any, event: any, telegramId: string) {
  const cutoff = cutoffAt(event.start_at)
  if (cutoff && Date.now() > new Date(cutoff).getTime()) {
    await completeAction(action, { closedReason: 'boarding_pass_watch_window_ended', cutoffAt: cutoff })
    return { status: 'completed' as const, matched: false }
  }

  const actor = await resolveActor(telegramId)
  const searchText = buildBoardingPassSearchText(event, action)
  const emailResult = await searchWorkspaceEmails(actor, searchText)
  const payload = action.payload_json || {}
  const flightNo = payload.flightNo || event?.metadata_json?.flightNo || null
  const confirmationRef = payload.confirmationRef || event.confirmation_ref || null

  const ranked = emailResult.messages.map((message: any) => ({
    message,
    match: scoreBoardingPassCandidate({
      subject: message.subject,
      from: message.from,
      snippet: message.snippet,
      provider: event.provider,
      confirmationRef,
      flightNo,
    }),
  })).sort((a: any, b: any) => b.match.score - a.match.score)

  let best = ranked.find((row: any) => row.match.accepted) || null
  let attachment: Awaited<ReturnType<typeof readWorkspaceEmailBrief>> | null = null

  if (!best && emailResult.messages.length) {
    attachment = await readWorkspaceEmailBrief(actor, emailResult.messages, searchText)
    if (attachment.status === 'found') {
      for (const row of ranked) {
        const match = scoreBoardingPassCandidate({
          subject: row.message.subject,
          from: row.message.from,
          snippet: row.message.snippet,
          attachmentText: attachment.text,
          provider: event.provider,
          confirmationRef,
          flightNo,
        })
        if (match.accepted) {
          best = { message: row.message, match }
          break
        }
      }
    }
  }

  if (!best) {
    await deferAction(action, EMAIL_WATCH_RETRY_MINUTES, {
      lastCheckedAt: new Date().toISOString(),
      lastResult: 'no_strong_boarding_pass_match',
      messagesChecked: emailResult.messages.length,
    })
    return { status: 'deferred' as const, matched: false }
  }

  if (!attachment && emailResult.messages.length) {
    attachment = await readWorkspaceEmailBrief(actor, [best.message], searchText)
  }

  const at = new Date().toISOString()
  const boardingPass = {
    source: 'gmail',
    gmailMessageId: String(best.message.id),
    gmailThreadId: String(best.message.threadId || ''),
    subject: safe(best.message.subject, 240),
    from: safe(best.message.from, 240),
    detectedAt: at,
    attachment: attachment?.status === 'found' ? {
      filename: safe(attachment.filename, 240),
      mimeType: safe(attachment.mimeType, 160),
    } : null,
  }

  const existingMeta = event.metadata_json || {}
  const alreadyMatched = String(existingMeta?.boardingPass?.gmailMessageId || '') === boardingPass.gmailMessageId
  if (alreadyMatched) {
    await completeAction(action, { boardingPassDetected: true, duplicateSuppressed: true, gmailMessageId: boardingPass.gmailMessageId })
    return { status: 'completed' as const, matched: true, duplicate: true }
  }

  const sourceRefs = Array.isArray(event.source_refs) ? event.source_refs : []
  const nextRefs = sourceRefs.some((x: any) => String(x?.gmailMessageId || '') === boardingPass.gmailMessageId)
    ? sourceRefs
    : [...sourceRefs, { source: 'gmail', gmailMessageId: boardingPass.gmailMessageId, kind: 'boarding_pass_or_checkin_confirmation' }]

  const { error: eventError } = await supabaseAdmin.from('life_events').update({
    lifecycle_state: 'watching',
    metadata_json: { ...existingMeta, boardingPass },
    source_refs: nextRefs,
    updated_at: at,
  }).eq('id', event.id).eq('telegram_id', telegramId)
  if (eventError) throw new Error(`life_event_email_event_update_failed:${eventError.message}`)

  await completeAction(action, {
    boardingPassDetected: true,
    gmailMessageId: boardingPass.gmailMessageId,
    attachmentFilename: boardingPass.attachment?.filename || null,
  })

  const runId = await createRun(
    telegramId,
    event,
    action,
    boardingPass.attachment?.filename
      ? `Boarding pass/check-in confirmation found in Gmail: ${boardingPass.attachment.filename}.`
      : 'Boarding pass/check-in confirmation found in Gmail.',
    { gmail_message_id: boardingPass.gmailMessageId, attachment_present: Boolean(boardingPass.attachment) },
  )

  await activity(telegramId, runId, 'life_event_boarding_pass_found', 'Gogo matched a Gmail boarding-pass/check-in message to this flight.', {
    life_event_id: String(event.id),
    gmail_message_id: boardingPass.gmailMessageId,
    attachment_filename: boardingPass.attachment?.filename || null,
  })

  await sendAgentPush(telegramId, {
    title: 'Your boarding pass is ready',
    body: boardingPass.attachment?.filename
      ? `${safe(event.title, 150)} · ${boardingPass.attachment.filename}`
      : `${safe(event.title, 180)} · check-in confirmation found in Gmail`,
    path: '/dashboard/today',
    data: { runId, lifeEventId: String(event.id), gmailMessageId: boardingPass.gmailMessageId },
  }).catch(() => {})

  return { status: 'completed' as const, matched: true, runId }
}

export async function processDueLifeEventEmailWatches(limit = 10) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - EMAIL_WATCH_LEASE_MINUTES * 60_000).toISOString()
  const select = 'id,life_event_id,telegram_id,action_key,action_type,capability,title,due_at,status,payload_json,created_at,updated_at'
  const [due, stale] = await Promise.all([
    supabaseAdmin.from('life_event_actions')
      .select(select)
      .eq('action_type', 'email_watch')
      .in('status', ['queued', 'ready'])
      .not('due_at', 'is', null)
      .lte('due_at', now.toISOString())
      .order('due_at', { ascending: true })
      .limit(limit),
    supabaseAdmin.from('life_event_actions')
      .select(select)
      .eq('action_type', 'email_watch')
      .eq('status', 'running')
      .lte('updated_at', staleBefore)
      .order('updated_at', { ascending: true })
      .limit(limit),
  ])
  if (due.error) throw new Error(`life_event_email_due_read_failed:${due.error.message}`)
  if (stale.error) throw new Error(`life_event_email_stale_read_failed:${stale.error.message}`)

  const rows = [...(stale.data || []), ...(due.data || [])]
    .filter((row: any, index: number, all: any[]) => all.findIndex((x: any) => String(x.id) === String(row.id)) === index)
    .slice(0, limit)

  let checked = 0, claimed = 0, matched = 0, deferred = 0, completed = 0, failed = 0
  for (const action of rows) {
    checked++
    if (!(await claimAction(action, now))) continue
    claimed++
    try {
      const { data: event, error } = await supabaseAdmin.from('life_events')
        .select('id,telegram_id,event_type,subtype,title,provider,start_at,confirmation_ref,lifecycle_state,metadata_json,source_refs')
        .eq('id', action.life_event_id)
        .eq('telegram_id', String(action.telegram_id))
        .maybeSingle()
      if (error) throw new Error(`life_event_email_event_read_failed:${error.message}`)
      if (!event) throw new Error('life_event_email_event_missing')

      if (event.event_type !== 'travel' || event.subtype !== 'flight' || action.action_key !== 'watch-boarding-pass-email') {
        await completeAction(action, { skippedReason: 'unsupported_email_watch' })
        completed++
        continue
      }

      const result = await processBoardingPassWatch(action, event, String(action.telegram_id))
      if (result.status === 'deferred') deferred++
      else completed++
      if (result.matched) matched++
    } catch (error: any) {
      failed++
      const reason = safe(error?.message || 'life_event_email_watch_failed', 300)
      console.error('LIFE_EVENT_EMAIL_WATCH_FAILED:', action.id, reason)
      await deferAction(action, EMAIL_WATCH_ERROR_RETRY_MINUTES, { lastError: reason, lastErrorAt: new Date().toISOString() }).catch(() => {})
    }
  }

  return { checked, claimed, matched, deferred, completed, failed }
}
