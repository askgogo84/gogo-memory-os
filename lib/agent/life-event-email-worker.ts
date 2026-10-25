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

export function assertBoardingPassSchedule(action:any,event:any){
  if((action.payload_json?.scheduleRevision??null)!==(event.metadata_json?.ticketScheduleRevision??null)){
    throw new Error('life_event_schedule_changed')
  }
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
  let tripIdentitySignals = 0
  if (boardingSignal) score += 5
  if (confirmation && compactHay.includes(confirmation)) { score += 7; tripIdentitySignals++ }
  if (flightNo && compactHay.includes(flightNo)) { score += 5; tripIdentitySignals++ }
  if (provider && hay.includes(provider)) score += 2
  if (/\bboarding pass\b/i.test(hay)) score += 2
  if (/\b(check[- ]?in (?:complete|completed|confirmed|successful)|you(?:'|’)re checked in|you are checked in)\b/i.test(hay)) score += 2
  if (promoSignal && !boardingSignal) score -= 8

  return { score, boardingSignal, identitySignals: tripIdentitySignals, tripIdentitySignals, accepted: boardingSignal && tripIdentitySignals >= 1 && score >= 7 }
}

function identityTerms(event: any, action: any) {
  const payload = action?.payload_json || {}
  return [
    payload?.confirmationRef || event?.confirmation_ref,
    payload?.flightNo || event?.metadata_json?.flightNo,
    event?.provider,
  ].map((x) => safe(x, 100)).filter(Boolean)
}

export function buildBoardingPassSearchText(event: any, action: any) {
  return ['boarding pass', ...identityTerms(event, action)].join(' ')
}

export function buildBoardingPassSearchTexts(event: any, action: any) {
  const identity = identityTerms(event, action)
  return [
    ['boarding pass', ...identity],
    ['check-in confirmation', ...identity],
    ['checked in', ...identity],
    ['web check-in', ...identity],
  ].map((parts) => parts.join(' ')).filter((value, index, all) => all.indexOf(value) === index)
}

async function resolveActor(telegramId: string): Promise<AgentActor> {
  const { data, error } = await supabaseAdmin.from('users')
    .select('id,telegram_id,whatsapp_id,name,gmail_connected')
    .eq('telegram_id', Number(telegramId))
    .maybeSingle()
  if (error) throw new Error(`life_event_email_actor_lookup_failed:${error.message}`)
  if (!data?.id || !data?.telegram_id) throw new Error('life_event_email_actor_missing')
  if (!data.gmail_connected) throw new Error('workspace_not_connected')
  return { userId: String(data.id), legacyTelegramId: Number(data.telegram_id), whatsappId: String(data.whatsapp_id || ''), name: String(data.name || 'Gogo') }
}

async function claimAction(action: any, now: Date) {
  const leaseUntil = plusMinutes(now, EMAIL_WATCH_LEASE_MINUTES)
  const expectedStatus = String(action.status || 'ready')
  let query = supabaseAdmin.from('life_event_actions')
    .update({ status: 'running', updated_at: now.toISOString(), payload_json: { ...(action.payload_json || {}), emailWatchLeaseUntil: leaseUntil } })
    .eq('id', action.id).eq('status', expectedStatus)
  if (expectedStatus === 'running' && action.updated_at) query = query.eq('updated_at', action.updated_at)
  const { data, error } = await query.select('id').maybeSingle()
  if (error) throw new Error(`life_event_email_claim_failed:${error.message}`)
  return Boolean(data?.id)
}

async function deferAction(action: any, minutes: number, extra: Record<string, unknown> = {}) {
  const now = new Date(), dueAt = plusMinutes(now, minutes)
  const { error } = await supabaseAdmin.from('life_event_actions').update({ status: 'ready', due_at: dueAt, updated_at: now.toISOString(), payload_json: { ...(action.payload_json || {}), ...extra, emailWatchNextAt: dueAt } }).eq('id', action.id).eq('status', 'running')
  if (error) throw new Error(`life_event_email_defer_failed:${error.message}`)
}

export async function completeAction(action: any, extra: Record<string, unknown> = {}) {
  const at = new Date().toISOString()
  let query = supabaseAdmin.from('life_event_actions').update({ status: 'completed', updated_at: at, payload_json: { ...(action.payload_json || {}), ...extra, completedAt: at } }).eq('id', action.id).eq('status', 'running')
  const revision=action.payload_json?.scheduleRevision
  query=typeof revision==='string'?query.eq('payload_json->>scheduleRevision',revision):query.is('payload_json->>scheduleRevision',null)
  const { data, error } = await query.select('id,payload_json').maybeSingle()
  if (error) throw new Error(`life_event_email_complete_failed:${error.message}`)
  if (!data?.id || (data.payload_json?.scheduleRevision??null)!==(revision??null)) throw new Error('life_event_schedule_changed')
}

export async function publishBoardingPass(action:any,event:any,telegramId:string,boardingPass:any){
  const {data,error}=await supabaseAdmin.rpc('gogo_publish_boarding_pass',{
    p_action_id:action.id,p_event_id:event.id,p_telegram_id:telegramId,
    p_revision:action.payload_json?.scheduleRevision??null,p_boarding_pass:boardingPass,
  })
  if(error||typeof data!=='string')throw new Error(`life_event_email_publish_failed:${error?.message||'missing_run'}`)
  return data
}

export async function deliverBoardingPassNotices(){
  const {data,error}=await supabaseAdmin.from('boarding_pass_outbox').select('id').eq('status','pending').order('created_at').limit(20)
  if(error)throw new Error(`life_event_email_outbox_read_failed:${error.message}`)
  for(const row of data||[]){
    const {data:notice,error:claimError}=await supabaseAdmin.rpc('gogo_claim_boarding_pass_notice',{p_id:row.id})
    if(claimError)throw new Error(`life_event_email_outbox_claim_failed:${claimError.message}`)
    if(!notice)continue
    // The notification is deliberately a historical update, not a claim that
    // an old pass remains valid after a later schedule change. Never replay a
    // claimed send automatically: delivery may have happened before a crash.
    const result=await sendAgentPush(String(notice.telegramId),{title:'Saved flight update',body:'Gogo recorded a flight update. Open AskGogo for the current schedule and boarding-pass details.',path:'/dashboard/today',data:{runId:notice.runId,lifeEventId:notice.lifeEventId,scheduleRevision:notice.scheduleRevision}})
    const {error:updateError}=await supabaseAdmin.from('boarding_pass_outbox').update({status:result.failed?'failed':'sent',updated_at:new Date().toISOString()}).eq('id',row.id).eq('status','claimed')
    if(updateError)throw new Error(`life_event_email_outbox_finish_failed:${updateError.message}`)
  }
}

export function eligibleBoardingPassMessages(messages:any[],action:any){
  const excluded=new Set((Array.isArray(action?.payload_json?.excludedGmailMessageIds)?action.payload_json.excludedGmailMessageIds:[]).filter((id:unknown)=>typeof id==='string'&&id))
  return messages.filter(message=>!excluded.has(String(message.id)))
}

async function processBoardingPassWatch(action: any, event: any, telegramId: string) {
  const cutoff = cutoffAt(event.start_at)
  if (cutoff && Date.now() > new Date(cutoff).getTime()) { await completeAction(action, { closedReason: 'boarding_pass_watch_window_ended', cutoffAt: cutoff }); return { status: 'completed' as const, matched: false } }

  const actor = await resolveActor(telegramId)
  const searchTexts = buildBoardingPassSearchTexts(event, action)
  const messageMap = new Map<string, any>()
  for (const searchText of searchTexts) {
    const result = await searchWorkspaceEmails(actor, searchText)
    for (const message of result.messages || []) messageMap.set(String(message.id), message)
  }
  const messages = eligibleBoardingPassMessages([...messageMap.values()],action)
  const payload = action.payload_json || {}, flightNo = payload.flightNo || event?.metadata_json?.flightNo || null, confirmationRef = payload.confirmationRef || event.confirmation_ref || null
  const ranked = messages.map((message: any) => ({ message, match: scoreBoardingPassCandidate({ subject: message.subject, from: message.from, snippet: message.snippet, provider: event.provider, confirmationRef, flightNo }) })).sort((a: any, b: any) => b.match.score - a.match.score)

  let best = ranked.find((row: any) => row.match.accepted) || null
  let attachment: Awaited<ReturnType<typeof readWorkspaceEmailBrief>> | null = null
  if (!best) {
    for (const row of ranked.slice(0, 3)) {
      const candidateAttachment = await readWorkspaceEmailBrief(actor, [row.message], searchTexts[0])
      if (candidateAttachment.status !== 'found') continue
      const match = scoreBoardingPassCandidate({ subject: row.message.subject, from: row.message.from, snippet: row.message.snippet, attachmentText: candidateAttachment.text, provider: event.provider, confirmationRef, flightNo })
      if (match.accepted) { best = { message: row.message, match }; attachment = candidateAttachment; break }
    }
  }

  if (!best) { await deferAction(action, EMAIL_WATCH_RETRY_MINUTES, { lastCheckedAt: new Date().toISOString(), lastResult: 'no_strong_boarding_pass_match', messagesChecked: messages.length }); return { status: 'deferred' as const, matched: false } }
  if (!attachment) attachment = await readWorkspaceEmailBrief(actor, [best.message], searchTexts[0])

  const at = new Date().toISOString(), boardingPass = { source: 'gmail', gmailMessageId: String(best.message.id), gmailThreadId: String(best.message.threadId || ''), subject: safe(best.message.subject, 240), from: safe(best.message.from, 240), detectedAt: at, attachment: attachment?.status === 'found' ? { filename: safe(attachment.filename, 240), mimeType: safe(attachment.mimeType, 160) } : null }
  const existingMeta = event.metadata_json || {}, alreadyMatched = String(existingMeta?.boardingPass?.gmailMessageId || '') === boardingPass.gmailMessageId
  if (alreadyMatched) { await completeAction(action, { boardingPassDetected: true, duplicateSuppressed: true, gmailMessageId: boardingPass.gmailMessageId }); return { status: 'completed' as const, matched: true, duplicate: true } }

  const runId=await publishBoardingPass(action,event,telegramId,boardingPass)
  return { status: 'completed' as const, matched: true, runId }
}

export async function processDueLifeEventEmailWatches(limit = 10) {
  const now = new Date(), staleBefore = new Date(now.getTime() - EMAIL_WATCH_LEASE_MINUTES * 60_000).toISOString(), select = 'id,life_event_id,telegram_id,action_key,action_type,capability,title,due_at,status,payload_json,created_at,updated_at'
  const [due, stale] = await Promise.all([
    supabaseAdmin.from('life_event_actions').select(select).eq('action_type', 'email_watch').in('status', ['queued', 'ready']).not('due_at', 'is', null).lte('due_at', now.toISOString()).order('due_at', { ascending: true }).limit(limit),
    supabaseAdmin.from('life_event_actions').select(select).eq('action_type', 'email_watch').eq('status', 'running').lte('updated_at', staleBefore).order('updated_at', { ascending: true }).limit(limit),
  ])
  if (due.error) throw new Error(`life_event_email_due_read_failed:${due.error.message}`)
  if (stale.error) throw new Error(`life_event_email_stale_read_failed:${stale.error.message}`)
  const rows = [...(stale.data || []), ...(due.data || [])].filter((row: any, index: number, all: any[]) => all.findIndex((x: any) => String(x.id) === String(row.id)) === index).slice(0, limit)
  let checked = 0, claimed = 0, matched = 0, deferred = 0, completed = 0, failed = 0
  for (const action of rows) {
    checked++
    if (!(await claimAction(action, now))) continue
    claimed++
    try {
      const { data: event, error } = await supabaseAdmin.from('life_events').select('id,telegram_id,event_type,subtype,title,provider,start_at,confirmation_ref,lifecycle_state,metadata_json,source_refs').eq('id', action.life_event_id).eq('telegram_id', String(action.telegram_id)).maybeSingle()
      if (error) throw new Error(`life_event_email_event_read_failed:${error.message}`)
      if (!event) throw new Error('life_event_email_event_missing')
      assertBoardingPassSchedule(action,event)
      if (event.event_type !== 'travel' || event.subtype !== 'flight' || action.action_key !== 'watch-boarding-pass-email') { await completeAction(action, { skippedReason: 'unsupported_email_watch' }); completed++; continue }
      const result = await processBoardingPassWatch(action, event, String(action.telegram_id))
      if (result.status === 'completed') { completed++; if (result.matched) matched++ } else deferred++
    } catch (error: any) {
      failed++
      console.error('LIFE_EVENT_EMAIL_WATCH_FAILED:', action.id, error?.message || error)
      await deferAction(action, EMAIL_WATCH_ERROR_RETRY_MINUTES, { lastError: safe(error?.message || 'email_watch_failed', 400), lastCheckedAt: new Date().toISOString() }).catch(() => {})
    }
  }
  await deliverBoardingPassNotices()
  return { checked, claimed, matched, completed, deferred, failed }
}
