import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { checkCostAllowance, COST_ESTIMATES_PAISE, getCostBudget, recordCostEvent } from '@/lib/services/cost-guard'
import { adaptiveWatcherCadence } from './watch-cost-policy'
import { runSecureBrowser } from './secure-computer'
import { listRecentWorkspaceInbox } from './google-workspace-read'
import { buildVaultAddLink } from '@/lib/vault/connect-link'
import type { AgentActor } from './actor'
import {
  appendBoundedHistory,
  assessWebWatchResult,
  canonicalWatcherUrl,
  watcherResultSignature,
  webWatchAlertAllowed,
} from './watcher-quality'

export type WatcherDelivery = 'app' | 'whatsapp' | 'both'

export type DeadlineWatcherCondition = {
  title: string
  deadline: string
  notifyBeforeHours: number
  delivery: WatcherDelivery
}

export type InboxTriageWatcherCondition = {
  title: string
  delivery: WatcherDelivery
  cadenceMinutes: number
}

export type ProductStockWatcherCondition = {
  title: string
  productUrl: string
  variant: string
  addToCart: boolean
  delivery: WatcherDelivery
  cadenceMinutes: number
}

export type WebSearchWatcherCondition = {
  title: string
  query: string
  triggerKeywords: string[]
  delivery: WatcherDelivery
  cadenceMinutes: number
  burstUntil?: string | null
}

function validDate(value: unknown): string | null {
  const d = new Date(String(value || ''))
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

function normalizeDelivery(value: unknown): WatcherDelivery {
  return ['app','whatsapp','both'].includes(String(value)) ? String(value) as WatcherDelivery : 'both'
}

export function normalizeDeadlineWatcher(input: any): DeadlineWatcherCondition | null {
  const title = String(input?.title || '').trim().slice(0, 180)
  const deadline = validDate(input?.deadline)
  const notifyBeforeHours = Math.max(1, Math.min(24 * 30, Math.floor(Number(input?.notifyBeforeHours || 24))))
  const delivery = normalizeDelivery(input?.delivery)
  if (!title || !deadline) return null
  return { title, deadline, notifyBeforeHours, delivery }
}

export function normalizeInboxTriageWatcher(input:any): InboxTriageWatcherCondition | null {
  const title=String(input?.title||'Inbox action watch').trim().slice(0,180)
  const delivery=normalizeDelivery(input?.delivery)
  const cadenceMinutes=Math.max(60,Math.min(24*60,Math.floor(Number(input?.cadenceMinutes||60))))
  if(!title)return null
  return {title,delivery,cadenceMinutes}
}

export function normalizeProductStockWatcher(input: any): ProductStockWatcherCondition | null {
  const title = String(input?.title || '').trim().slice(0, 180)
  const rawUrl = String(input?.productUrl || '').trim()
  let productUrl = ''
  try {
    const url = new URL(rawUrl)
    if (['http:','https:'].includes(url.protocol)) {
      url.hash = ''
      productUrl = url.toString()
    }
  } catch {}
  const variant = String(input?.variant || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const addToCart = input?.addToCart === true
  const delivery = normalizeDelivery(input?.delivery)
  const cadenceMinutes = Math.max(15, Math.min(24 * 60, Math.floor(Number(input?.cadenceMinutes || 60))))
  if (!title || !productUrl || !variant) return null
  return { title, productUrl, variant, addToCart, delivery, cadenceMinutes }
}

export function normalizeWebSearchWatcher(input: any): WebSearchWatcherCondition | null {
  const title = String(input?.title || '').trim().slice(0, 180)
  const query = String(input?.query || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  const triggerKeywords = Array.isArray(input?.triggerKeywords)
    ? Array.from(new Set(input.triggerKeywords.map((x:any)=>String(x || '').trim().toLowerCase()).filter(Boolean))).slice(0, 12) as string[]
    : []
  const delivery = normalizeDelivery(input?.delivery)
  const cadenceMinutes = Math.max(15, Math.min(24 * 60, Math.floor(Number(input?.cadenceMinutes || 60))))
  const burstUntil = input?.burstUntil ? validDate(input.burstUntil) : null
  if (!title || !query) return null
  return { title, query, triggerKeywords, delivery, cadenceMinutes, burstUntil }
}

export async function createDeadlineWatcher(params: {
  telegramId: string
  condition: DeadlineWatcherCondition
  goalId?: string | null
}) {
  const now = new Date()
  const deadline = new Date(params.condition.deadline)
  const threshold = new Date(deadline.getTime() - params.condition.notifyBeforeHours * 3600_000)
  const nextCheck = threshold.getTime() > now.getTime() ? threshold : now
  const { data, error } = await supabaseAdmin.from('agent_watchers').insert({
    telegram_id: params.telegramId,
    goal_id: params.goalId || null,
    type: 'deadline',
    condition_json: params.condition,
    cadence_minutes: 60,
    active: true,
    last_state_json: {},
    next_check_at: nextCheck.toISOString(),
  }).select('id, type, condition_json, cadence_minutes, active, next_check_at, created_at').single()
  if (error || !data) throw new Error(`agent_watcher_create_failed:${error?.message || 'unknown'}`)
  return data
}

export async function createInboxTriageWatcher(params:{
  telegramId:string
  condition:InboxTriageWatcherCondition
  goalId?:string|null
}) {
  const {data,error}=await supabaseAdmin.from('agent_watchers').insert({
    telegram_id:params.telegramId,
    goal_id:params.goalId||null,
    type:'email_triage',
    condition_json:params.condition,
    cadence_minutes:params.condition.cadenceMinutes,
    active:true,
    last_state_json:{seenMessageIds:[],lastActionCount:0},
    next_check_at:new Date().toISOString(),
  }).select('id,type,condition_json,cadence_minutes,active,next_check_at,created_at').single()
  if(error||!data)throw new Error(`agent_watcher_create_failed:${error?.message||'unknown'}`)
  return data
}

export async function createProductStockWatcher(params: {
  telegramId: string
  condition: ProductStockWatcherCondition
  goalId?: string | null
}) {
  const { data, error } = await supabaseAdmin.from('agent_watchers').insert({
    telegram_id:params.telegramId,
    goal_id:params.goalId || null,
    type:'product_stock',
    condition_json:params.condition,
    cadence_minutes:params.condition.cadenceMinutes,
    active:true,
    last_state_json:{ availability:'unknown', blockedNotified:false, cartAttempted:false },
    next_check_at:new Date().toISOString(),
  }).select('id, type, condition_json, cadence_minutes, active, next_check_at, created_at').single()
  if (error || !data) throw new Error(`agent_watcher_create_failed:${error?.message || 'unknown'}`)
  return data
}

export async function createWebSearchWatcher(params: {
  telegramId: string
  condition: WebSearchWatcherCondition
  goalId?: string | null
}) {
  const { data, error } = await supabaseAdmin.from('agent_watchers').insert({
    telegram_id: params.telegramId,
    goal_id: params.goalId || null,
    type: 'web_search',
    condition_json: params.condition,
    cadence_minutes: params.condition.cadenceMinutes,
    active: true,
    last_state_json: { quietChecks:0, seenUrls:[], seenSignatures:[], alertTimes:[] },
    next_check_at: new Date().toISOString(),
  }).select('id, type, condition_json, cadence_minutes, active, next_check_at, created_at').single()
  if (error || !data) throw new Error(`agent_watcher_create_failed:${error?.message || 'unknown'}`)
  return data
}

async function writeActivity(telegramId: string, message: string, metadata: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: telegramId,
    event_type: 'watcher_triggered',
    message: message.slice(0, 900),
    metadata_json: metadata,
  })
  if (error) console.error('AGENT_WATCHER_ACTIVITY_FAILED:', error.message)
}

async function createDeadlineIdea(telegramId: string, condition: DeadlineWatcherCondition, watcherId: string) {
  const reason = `${condition.title} is approaching its deadline.`
  const { error } = await supabaseAdmin.from('agent_ideas').insert({
    telegram_id: telegramId,
    title: condition.title,
    reason,
    expected_value: 'Review it now so it does not become a last-minute problem.',
    value_score: 0.9,
    action_label: 'Review',
    source_refs: [{ type: 'watcher', id: watcherId }],
    status: 'new',
  })
  if (error) console.error('AGENT_WATCHER_IDEA_FAILED:', error.message)
}

async function createWebIdea(telegramId: string, condition: WebSearchWatcherCondition, watcherId: string, result: WebSearchResult | null, matchedKeywords: string[], relevance = 0.8) {
  const detail = matchedKeywords.length
    ? `A new relevant result matched: ${matchedKeywords.join(', ')}.`
    : 'A new result materially matched this watch.'
  const sourceRefs:any[] = [{ type:'watcher', id:watcherId }]
  if (result?.url) sourceRefs.push({ type:'url', url:result.url })
  const { error } = await supabaseAdmin.from('agent_ideas').insert({
    telegram_id: telegramId,
    title: condition.title,
    reason: detail,
    expected_value: result?.title ? `${result.title}${result.snippet ? ` — ${result.snippet.slice(0, 180)}` : ''}` : 'Open the latest result to review what changed.',
    value_score: Math.max(0.78, Math.min(0.96, relevance)),
    action_label: 'Review update',
    source_refs: sourceRefs,
    status: 'new',
  })
  if (error) console.error('AGENT_WATCHER_IDEA_FAILED:', error.message)
}

async function sendWhatsAppIfWanted(telegramId: string, delivery: WatcherDelivery, message: string) {
  if (delivery !== 'whatsapp' && delivery !== 'both') return
  const tg = Number(telegramId)
  if (!Number.isFinite(tg)) return
  const { data } = await supabaseAdmin.from('users').select('whatsapp_id').eq('telegram_id', tg).maybeSingle()
  const phone = String(data?.whatsapp_id || '').trim()
  if (!phone) return
  await sendWhatsAppMessage(phone, message)
  await recordCostEvent({ telegramId, category:'whatsapp_outbound', metadata:{ source:'background_gogo' } })
}

function searchFingerprint(results: WebSearchResult[]) {
  const stable = results.slice(0, 5).map(r => `${r.title.toLowerCase()}\n${canonicalWatcherUrl(r.url)}`).join('\n---\n')
  return createHash('sha256').update(stable).digest('hex')
}

async function activeWebWatchCount(telegramId:string) {
  const { count, error } = await supabaseAdmin.from('agent_watchers')
    .select('id', { count:'exact', head:true })
    .eq('telegram_id', telegramId)
    .in('type', ['web_search','product_stock'])
    .eq('active', true)
  if (error) throw new Error(`agent_watcher_count_failed:${error.message}`)
  return Math.max(1, count || 1)
}

async function processDeadlineWatcher(watcher:any, now:Date) {
  const condition = normalizeDeadlineWatcher(watcher.condition_json)
  if (!condition) {
    await supabaseAdmin.from('agent_watchers').update({ active:false, last_checked_at:now.toISOString(), last_state_json:{ error:'invalid_condition' } }).eq('id', watcher.id)
    return { triggered:false, failed:true }
  }
  const deadline = new Date(condition.deadline)
  const thresholdMs = deadline.getTime() - condition.notifyBeforeHours * 3600_000
  const due = now.getTime() >= thresholdMs
  const alreadyTriggered = watcher.last_state_json?.triggered === true

  if (due && !alreadyTriggered) {
    await createDeadlineIdea(String(watcher.telegram_id), condition, String(watcher.id))
    await sendWhatsAppIfWanted(String(watcher.telegram_id), condition.delivery, `⏳ Gogo noticed a deadline coming up\n\n${condition.title}\n\nI’ve also added this to your Gogo Activity/Ideas in the app.`).catch(err => console.error('AGENT_WATCHER_WHATSAPP_FAILED:', err?.message || err))
    await writeActivity(String(watcher.telegram_id), `Background Gogo surfaced: ${condition.title}`, { watcher_id: watcher.id, type:'deadline', delivery:condition.delivery })
    await supabaseAdmin.from('agent_watchers').update({
      active:false,
      last_checked_at:now.toISOString(),
      last_state_json:{ triggered:true, triggeredAt:now.toISOString(), deadline:condition.deadline },
      next_check_at:null,
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    return { triggered:true, failed:false }
  }

  const next = new Date(Math.min(deadline.getTime(), Math.max(now.getTime() + 3600_000, thresholdMs)))
  await supabaseAdmin.from('agent_watchers').update({
    last_checked_at:now.toISOString(),
    last_state_json:{ triggered:alreadyTriggered, deadline:condition.deadline },
    next_check_at:next.toISOString(),
    updated_at:now.toISOString(),
  }).eq('id', watcher.id)
  return { triggered:false, failed:false }
}


export function assessProductAvailabilityText(pageText: string, variant: string): 'available'|'unavailable'|'unknown' {
  const text = String(pageText || '').replace(/\s+/g, ' ').toLowerCase()
  const wanted = String(variant || '').trim().toLowerCase()
  if (!text || !wanted) return 'unknown'

  const escapeRegExp = (value:string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wantedRe = escapeRegExp(wanted)
  const unavailable = /\b(sold\s*out|out\s*of\s*stock|currently\s*unavailable|unavailable|not\s*available|notify\s*me\s*when\s*available|notify\s+when\s+available|email\s+me\s+when\s+available|coming\s*soon)\b/i
  const available = /\b(in\s*stock|available\s*now|available\s*today|ready\s*to\s*ship|add\s*to\s*(?:cart|bag|basket)|buy\s*now)\b/i

  // Prefer an explicit selected-size marker such as `Size: XL`.
  const selectedRe = new RegExp('\\b(?:selected\\s+size|size)\\s*[:=-]?\\s*' + wantedRe + '\\b', 'i')
  const selected = selectedRe.exec(text)
  if (selected) {
    const selectedEnd = selected.index + selected[0].length
    const sizeTokenRe = /\b(?:xxxs|xxs|xs|xxxl|xxl|xl|3xl|4xl|5xl|s|m|l)\b/ig
    sizeTokenRe.lastIndex = selectedEnd
    const next = sizeTokenRe.exec(text)
    const segmentEnd = next ? Math.min(next.index, selectedEnd + 220) : Math.min(text.length, selectedEnd + 220)
    const segment = text.slice(selected.index, segmentEnd)
    if (unavailable.test(segment)) return 'unavailable'
    if (available.test(segment)) return 'available'
    return 'unknown'
  }

  // Without a selected-size marker, accept only direct variant/state wording.
  const directUnavailable = new RegExp(
    '(?:\\b' + wantedRe + '\\b\\s*(?:is\\s+)?(?:sold\\s*out|out\\s*of\\s*stock|unavailable|not\\s*available)|(?:sold\\s*out|out\\s*of\\s*stock|unavailable|not\\s*available)\\s*(?:for\\s+)?\\b' + wantedRe + '\\b)',
    'i',
  )
  const directAvailable = new RegExp(
    '(?:\\b' + wantedRe + '\\b\\s*(?:is\\s+)?(?:in\\s*stock|available\\s*now|available\\s*today)|(?:in\\s*stock|available\\s*now|available\\s*today)\\s*(?:for\\s+)?\\b' + wantedRe + '\\b)',
    'i',
  )
  if (directUnavailable.test(text)) return 'unavailable'
  if (directAvailable.test(text)) return 'available'
  return 'unknown'
}

function cartLooksVerified(pageText: string) {
  const text = String(pageText || '').replace(/\s+/g, ' ').toLowerCase()
  return /\b(added\s*to\s*(?:cart|bag|basket)|view\s*(?:cart|bag|basket)|go\s*to\s*(?:cart|bag|basket)|your\s*(?:cart|bag|basket)\s*\(?\s*1\b|(?:cart|bag|basket)\s*\(?\s*1\b)/i.test(text)
}

async function createProductIdea(telegramId:string, condition:ProductStockWatcherCondition, watcherId:string, cartVerified:boolean) {
  const { error } = await supabaseAdmin.from('agent_ideas').insert({
    telegram_id:telegramId,
    title:`${condition.title} is available`,
    reason:`${condition.variant} is now available on the product page.`,
    expected_value:cartVerified
      ? 'Gogo verified the requested variant in your cart. Checkout still needs your approval.'
      : 'Open the product now while the requested variant is available.',
    value_score:0.95,
    action_label:cartVerified ? 'Review cart' : 'Open product',
    source_refs:[{ type:'watcher', id:watcherId }, { type:'url', url:condition.productUrl }],
    status:'new',
  })
  if (error) console.error('AGENT_PRODUCT_WATCH_IDEA_FAILED:', error.message)
}


function senderLabel(value:string) {
  return String(value||'').replace(/<[^>]+>/g,'').replace(/"/g,'').trim().slice(0,80) || 'sender'
}

export function inboxActionStep(message:any): {subject:string;from:string;step:string}|null {
  const subject=String(message?.subject||'(No subject)').replace(/\s+/g,' ').trim().slice(0,180)
  const from=senderLabel(String(message?.from||''))
  const snippet=String(message?.snippet||'').replace(/\s+/g,' ').trim()
  const text=`${subject} ${snippet}`.toLowerCase()

  if(/\b(unsubscribe|newsletter|weekly digest|daily digest|sale|discount|offer|coupon|promotion|promotional)\b/i.test(text)
    && !/\b(action required|deadline|due|invoice|payment|renew|expire|response required)\b/i.test(text)) return null

  let step=''
  if(/\b(action required|response required|please respond|please reply|reply required)\b/i.test(text)) step='Review the request and reply if it is valid.'
  else if(/\b(sign|signature|approve|approval)\b/i.test(text)) step='Review the request and approve or sign only if appropriate.'
  else if(/\b(invoice|payment|amount due|due payment|past due|overdue)\b/i.test(text)) step='Check the amount and due date, then decide whether payment or follow-up is needed.'
  else if(/\b(rsvp|meeting invite|calendar invite|schedule|reschedule|appointment)\b/i.test(text)) step='Check the date/time and confirm, decline, or reschedule.'
  else if(/\b(submit|submission|complete the form|complete your|upload|provide the requested)\b/i.test(text)) step='Complete or submit the requested information before the stated deadline.'
  else if(/\b(renew|renewal|expire|expiry|expires|expiration)\b/i.test(text)) step='Review the renewal or expiry and decide whether to renew, cancel, or update it.'
  else if(/\b(deadline|due by|due date|before [a-z]{3,9}\s+\d{1,2})\b/i.test(text)) step='Check the deadline and schedule the required action.'
  else if(/\b(please review|review requested|needs your attention|requires your attention|follow up|follow-up)\b/i.test(text)) step='Review this email and complete the requested follow-up.'
  else return null

  return {subject,from,step}
}

async function watcherActor(telegramId:string):Promise<AgentActor|null> {
  const {data,error}=await supabaseAdmin.from('users')
    .select('id,telegram_id,whatsapp_id,name')
    .eq('telegram_id',Number(telegramId))
    .maybeSingle()
  if(error)throw new Error(`email_triage_user_read_failed:${error.message}`)
  if(!data?.id||!data?.whatsapp_id||!Number.isFinite(Number(data.telegram_id)))return null
  return {
    userId:String(data.id),
    legacyTelegramId:Number(data.telegram_id),
    whatsappId:String(data.whatsapp_id),
    name:String(data.name||'Gogo'),
  }
}

async function processInboxTriageWatcher(watcher:any,now:Date) {
  const condition=normalizeInboxTriageWatcher(watcher.condition_json)
  if(!condition) {
    await supabaseAdmin.from('agent_watchers').update({
      active:false,last_checked_at:now.toISOString(),next_check_at:null,
      last_state_json:{error:'invalid_condition'},updated_at:now.toISOString(),
    }).eq('id',watcher.id)
    return {triggered:false,failed:true}
  }

  const telegramId=String(watcher.telegram_id)
  const actor=await watcherActor(telegramId)
  if(!actor) {
    await supabaseAdmin.from('agent_watchers').update({
      active:false,last_checked_at:now.toISOString(),next_check_at:null,
      last_state_json:{...(watcher.last_state_json||{}),error:'workspace_user_unavailable'},updated_at:now.toISOString(),
    }).eq('id',watcher.id)
    return {triggered:false,failed:true}
  }

  let messages:any[]=[]
  try {
    messages=(await listRecentWorkspaceInbox(actor,12)).messages||[]
  } catch(err:any) {
    const reason=String(err?.message||'workspace_read_failed')
    const alreadyNotified=watcher.last_state_json?.workspaceErrorNotified===true
    if(!alreadyNotified) {
      await sendWhatsAppIfWanted(
        telegramId,condition.delivery,
        reason.includes('workspace_reconnect_required')||reason.includes('workspace_not_connected')
          ? 'Your inbox watch is paused because Google Workspace needs to be reconnected. I did not read or change any mail.'
          : 'I could not read your inbox safely on this check. I will retry later; I did not change any mail.',
      ).catch(()=>{})
    }
    await supabaseAdmin.from('agent_watchers').update({
      last_checked_at:now.toISOString(),
      next_check_at:new Date(now.getTime()+6*3600_000).toISOString(),
      last_state_json:{...(watcher.last_state_json||{}),lastError:reason,workspaceErrorNotified:true,lastErrorAt:now.toISOString()},
      updated_at:now.toISOString(),
    }).eq('id',watcher.id)
    return {triggered:false,failed:false}
  }

  const seen=Array.isArray(watcher.last_state_json?.seenMessageIds)?watcher.last_state_json.seenMessageIds.map(String):[]
  const seenSet=new Set(seen)
  const fresh=messages.filter((m:any)=>m?.id&&!seenSet.has(String(m.id)))
  const actions=fresh.map(inboxActionStep).filter(Boolean).slice(0,5) as Array<{subject:string;from:string;step:string}>
  const currentIds=messages.map((m:any)=>String(m?.id||'')).filter(Boolean)
  const nextSeen=Array.from(new Set([...currentIds,...seen])).slice(0,120)

  if(actions.length) {
    const lines=actions.map((a,i)=>`${i+1}. *${a.subject}* — ${a.from}\n   Next: ${a.step}`).join('\n\n')
    const message=`📬 *Your inbox needs attention*\n\n${lines}\n\nI only read this mail. I did not reply, send, delete, archive, approve, pay, or change anything.`
    await sendWhatsAppIfWanted(telegramId,condition.delivery,message)
      .catch(err=>console.error('AGENT_EMAIL_TRIAGE_WHATSAPP_FAILED:',err?.message||err))
    await supabaseAdmin.from('agent_ideas').insert({
      telegram_id:telegramId,
      title:`Inbox: ${actions.length} action item${actions.length===1?'':'s'}`,
      reason:'New inbox messages appear to require your attention.',
      expected_value:actions.map(a=>`${a.subject}: ${a.step}`).join(' | ').slice(0,1200),
      value_score:0.88,
      action_label:'Review inbox',
      source_refs:[{type:'watcher',id:String(watcher.id)}],
      status:'new',
    }).then(({error})=>{if(error)console.error('AGENT_EMAIL_TRIAGE_IDEA_FAILED:',error.message)})
    await writeActivity(telegramId,`Inbox triage surfaced ${actions.length} action item(s).`,{
      watcher_id:watcher.id,type:'email_triage',action_count:actions.length,
    })
  }

  await supabaseAdmin.from('agent_watchers').update({
    cadence_minutes:condition.cadenceMinutes,
    last_checked_at:now.toISOString(),
    next_check_at:new Date(now.getTime()+condition.cadenceMinutes*60_000).toISOString(),
    last_state_json:{
      ...(watcher.last_state_json||{}),
      seenMessageIds:nextSeen,
      lastActionCount:actions.length,
      lastActionAt:actions.length?now.toISOString():watcher.last_state_json?.lastActionAt||null,
      workspaceErrorNotified:false,
      lastError:null,
    },
    updated_at:now.toISOString(),
  }).eq('id',watcher.id)
  return {triggered:actions.length>0,failed:false}
}

async function processProductStockWatcher(watcher:any, now:Date) {
  const condition = normalizeProductStockWatcher(watcher.condition_json)
  if (!condition) {
    await supabaseAdmin.from('agent_watchers').update({
      active:false,
      last_checked_at:now.toISOString(),
      last_state_json:{ error:'invalid_condition' },
      next_check_at:null,
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    return { triggered:false, failed:true }
  }

  const telegramId = String(watcher.telegram_id)
  const budget = await getCostBudget(telegramId)
  if (budget.activeWebWatchersMax <= 0) {
    await supabaseAdmin.from('agent_watchers').update({
      active:false,
      last_checked_at:now.toISOString(),
      last_state_json:{ ...(watcher.last_state_json || {}), costGuard:'plan_not_eligible', stoppedAt:now.toISOString() },
      next_check_at:null,
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    return { triggered:false, failed:false }
  }

  const allowance = await checkCostAllowance(telegramId, COST_ESTIMATES_PAISE.web_search_basic)
  if (!allowance.allowed) {
    const deferMinutes = allowance.state?.maxWatcherCadenceMinutes || budget.maxWatcherCadenceMinutes || 1440
    await supabaseAdmin.from('agent_watchers').update({
      cadence_minutes:deferMinutes,
      last_checked_at:now.toISOString(),
      next_check_at:new Date(now.getTime() + deferMinutes * 60_000).toISOString(),
      last_state_json:{ ...(watcher.last_state_json || {}), costGuard:'deferred', costGuardReason:allowance.reason || 'budget' },
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    return { triggered:false, failed:false }
  }

  let browser:any
  try {
    browser = await runSecureBrowser({
      userId:telegramId,
      url:condition.productUrl,
      objective:`Check only whether product variant/size "${condition.variant}" is currently available. Select that variant if the page requires it. Do not add to cart, buy, checkout, log in, submit personal data, or make any consequential action.`,
      mode:'read',
    })
  } catch (err:any) {
    const retryMinutes = Math.max(60, condition.cadenceMinutes)
    await supabaseAdmin.from('agent_watchers').update({
      last_checked_at:now.toISOString(),
      next_check_at:new Date(now.getTime() + retryMinutes * 60_000).toISOString(),
      last_state_json:{ ...(watcher.last_state_json || {}), lastError:'browser_check_failed', lastErrorAt:now.toISOString() },
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    console.error('AGENT_PRODUCT_WATCH_BROWSER_FAILED:', watcher.id, err?.message || err)
    return { triggered:false, failed:true }
  }

  await recordCostEvent({
    telegramId,
    category:'web_search_basic',
    metadata:{ source:'product_stock_watch', watcher_id:String(watcher.id) },
  })

  if (browser.status === 'blocked') {
    const alreadyNotified = watcher.last_state_json?.blockedNotified === true
    const humanAuth = browser.blockReason === 'human_auth_required'
    const retryMinutes = humanAuth ? Math.max(60, condition.cadenceMinutes) : Math.max(240, budget.maxWatcherCadenceMinutes || 240)
    if (!alreadyNotified) {
      let message = `I’m watching ${condition.title}, but this store is currently blocking Gogo’s cloud browser, so I can’t honestly verify ${condition.variant} stock yet. I’ll keep retrying in the background. If you want to check immediately, open: ${condition.productUrl}`
      if (humanAuth) {
        let host=''
        try{host=new URL(browser.url||condition.productUrl).hostname}catch{}
        const vault=host ? await buildVaultAddLink({telegramId,domain:host}).catch(()=>null) : null
        message = vault
          ? `I’m still watching ${condition.title}, but the store needs a sign-in before I can verify ${condition.variant}. Don’t send your password here. Save the ${vault.provider.label} login securely:\n${vault.url}\n\nAfter that, the background watch will keep checking with the authenticated browser.`
          : `I’m still watching ${condition.title}, but the store needs you to sign in. Use AskGogo’s browser Take Control flow; don’t send passwords or one-time codes in chat.`
      }
      await sendWhatsAppIfWanted(
        telegramId,
        condition.delivery,
        message,
      ).catch(err => console.error('AGENT_PRODUCT_WATCH_WHATSAPP_FAILED:', err?.message || err))
    }
    await supabaseAdmin.from('agent_watchers').update({
      cadence_minutes:retryMinutes,
      last_checked_at:now.toISOString(),
      next_check_at:new Date(now.getTime() + retryMinutes * 60_000).toISOString(),
      last_state_json:{
        ...(watcher.last_state_json || {}),
        blockedNotified:true,
        blockReason:browser.blockReason || 'browser_blocked',
        authReason:browser.authReason || null,
        blockedAt:now.toISOString(),
      },
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    return { triggered:false, failed:false }
  }

  const availability = assessProductAvailabilityText(browser.pageText, condition.variant)
  const priorAvailability = String(watcher.last_state_json?.availability || 'unknown')

  if (availability !== 'available') {
    const quietChecks = Math.max(0, Number(watcher.last_state_json?.quietChecks || 0)) + 1
    // Product availability is a direct page check, not a broad web-search watch.
    // Keep the user's promised hourly cadence while the cost guard allows it.
    const cadenceMinutes = Math.max(60, condition.cadenceMinutes)
    await supabaseAdmin.from('agent_watchers').update({
      cadence_minutes:cadenceMinutes,
      condition_json:{ ...condition, cadenceMinutes },
      last_checked_at:now.toISOString(),
      next_check_at:new Date(now.getTime() + cadenceMinutes * 60_000).toISOString(),
      last_state_json:{
        ...(watcher.last_state_json || {}),
        availability,
        quietChecks,
        lastUrl:browser.url || condition.productUrl,
        lastTitle:browser.title || '',
        costGuard:'ok',
      },
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    return { triggered:false, failed:false }
  }

  if (priorAvailability === 'available' && watcher.last_state_json?.triggered === true) {
    await supabaseAdmin.from('agent_watchers').update({
      active:false,
      next_check_at:null,
      last_checked_at:now.toISOString(),
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    return { triggered:false, failed:false }
  }

  let cartVerified = false
  let cartStatus = 'not_requested'
  let handoffReason:string | null = null

  if (condition.addToCart) {
    cartStatus = 'attempted'
    try {
      const cart = await runSecureBrowser({
        userId:telegramId,
        url:condition.productUrl,
        objective:`Select product variant/size "${condition.variant}" and add exactly one item to the cart/bag. Stop immediately after it is added. Do not checkout, place an order, pay, authenticate, or submit personal/payment data.`,
        mode:'draft',
      })
      if (cart.status === 'blocked') {
        cartStatus = 'blocked'
        handoffReason = cart.blockReason || 'browser_blocked'
      } else {
        cartVerified = cartLooksVerified(cart.pageText)
        cartStatus = cartVerified ? 'verified' : 'not_verified'
      }
    } catch (err:any) {
      cartStatus = 'failed'
      console.error('AGENT_PRODUCT_WATCH_CART_FAILED:', watcher.id, err?.message || err)
    }
  }

  await createProductIdea(telegramId, condition, String(watcher.id), cartVerified)
  const actionText = !condition.addToCart
    ? 'I found it available.'
    : cartVerified
      ? 'I added one to your cart and verified the cart state.'
      : handoffReason
        ? 'It is available, but the store requires you to continue on the site before I can complete the cart step.'
        : 'It is available, but I could not verify that the cart step completed.'

  await sendWhatsAppIfWanted(
    telegramId,
    condition.delivery,
    `✅ ${condition.variant} is available\n\n${condition.title}\n${actionText}\n\n${condition.productUrl}\n\nI will not checkout or make a payment without your approval.`,
  ).catch(err => console.error('AGENT_PRODUCT_WATCH_WHATSAPP_FAILED:', err?.message || err))

  await writeActivity(telegramId, `Product watcher triggered: ${condition.title}`, {
    watcher_id:watcher.id,
    type:'product_stock',
    variant:condition.variant,
    product_url:condition.productUrl,
    cart_status:cartStatus,
  })

  await supabaseAdmin.from('agent_watchers').update({
    active:false,
    last_checked_at:now.toISOString(),
    next_check_at:null,
    last_state_json:{
      ...(watcher.last_state_json || {}),
      availability:'available',
      triggered:true,
      triggeredAt:now.toISOString(),
      cartAttempted:condition.addToCart,
      cartStatus,
      cartVerified,
      handoffReason,
      lastUrl:browser.url || condition.productUrl,
      lastTitle:browser.title || '',
      costGuard:'ok',
    },
    updated_at:now.toISOString(),
  }).eq('id', watcher.id)
  return { triggered:true, failed:false }
}

async function processWebSearchWatcher(watcher:any, now:Date) {
  const condition = normalizeWebSearchWatcher(watcher.condition_json)
  if (!condition) {
    await supabaseAdmin.from('agent_watchers').update({ active:false, last_checked_at:now.toISOString(), last_state_json:{ error:'invalid_condition' } }).eq('id', watcher.id)
    return { triggered:false, failed:true }
  }

  const telegramId = String(watcher.telegram_id)
  const budget = await getCostBudget(telegramId)
  if (budget.activeWebWatchersMax <= 0) {
    await supabaseAdmin.from('agent_watchers').update({
      active:false,
      last_checked_at:now.toISOString(),
      last_state_json:{ ...(watcher.last_state_json || {}), costGuard:'plan_not_eligible', stoppedAt:now.toISOString() },
      next_check_at:null,
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    return { triggered:false, failed:false }
  }

  const allowance = await checkCostAllowance(telegramId, COST_ESTIMATES_PAISE.web_search_basic)
  const currentQuiet = Math.max(0, Number(watcher.last_state_json?.quietChecks || 0))
  const activeCount = await activeWebWatchCount(telegramId)
  if (!allowance.allowed) {
    const deferMinutes = allowance.state?.maxWatcherCadenceMinutes || budget.maxWatcherCadenceMinutes || 1440
    await supabaseAdmin.from('agent_watchers').update({
      cadence_minutes:deferMinutes,
      last_checked_at:now.toISOString(),
      next_check_at:new Date(now.getTime() + deferMinutes * 60_000).toISOString(),
      last_state_json:{
        ...(watcher.last_state_json || {}),
        quietChecks:currentQuiet,
        costGuard:'deferred',
        costGuardReason:allowance.reason || 'budget',
        costDeferredAt:now.toISOString(),
      },
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    return { triggered:false, failed:false }
  }

  const results = await searchWebResults(condition.query)
  await recordCostEvent({
    telegramId,
    category:'web_search_basic',
    metadata:{ source:'background_gogo', watcher_id:String(watcher.id) },
  })

  if (!results.length) {
    const quietChecks = currentQuiet + 1
    const cadenceMinutes = adaptiveWatcherCadence({
      budget,
      activeWatcherCount:activeCount,
      quietChecks,
      material:false,
      usageRatio:allowance.state?.usageRatio || 0,
      burstUntil:condition.burstUntil,
      now,
    })
    await supabaseAdmin.from('agent_watchers').update({
      cadence_minutes:cadenceMinutes,
      condition_json:{ ...condition, cadenceMinutes },
      last_checked_at:now.toISOString(),
      next_check_at:new Date(now.getTime() + cadenceMinutes * 60_000).toISOString(),
      last_state_json:{ ...(watcher.last_state_json || {}), quietChecks, lastEmptyAt:now.toISOString(), costGuard:'ok' },
      updated_at:now.toISOString(),
    }).eq('id', watcher.id)
    return { triggered:false, failed:false }
  }

  const topResults = results.slice(0, 5)
  const fingerprint = searchFingerprint(topResults)
  const isBaseline = !watcher.last_state_json?.fingerprint
  const priorSeenUrls = Array.isArray(watcher.last_state_json?.seenUrls)
    ? watcher.last_state_json.seenUrls
    : Array.isArray(watcher.last_state_json?.urls) ? watcher.last_state_json.urls : []
  const priorSeenSignatures = Array.isArray(watcher.last_state_json?.seenSignatures) ? watcher.last_state_json.seenSignatures : []

  const assessments = topResults.map(result => ({
    result,
    quality: assessWebWatchResult({
      query: condition.query,
      title: result.title,
      snippet: result.snippet,
      url: result.url,
      triggerKeywords: condition.triggerKeywords,
      seenUrls: priorSeenUrls,
      seenSignatures: priorSeenSignatures,
    }),
  }))
  const candidate = assessments.find(item => item.quality.eligible) || null
  const alertGate = webWatchAlertAllowed({
    now,
    lastAlertAt: watcher.last_state_json?.lastAlertAt || watcher.last_state_json?.lastTriggeredAt || null,
    alertTimes: Array.isArray(watcher.last_state_json?.alertTimes) ? watcher.last_state_json.alertTimes : [],
  })
  const material = !isBaseline && Boolean(candidate) && alertGate.allowed
  const suppressedReason = !isBaseline && candidate && !alertGate.allowed ? alertGate.reason : null
  const quietChecks = material || isBaseline ? 0 : currentQuiet + 1
  const cadenceMinutes = adaptiveWatcherCadence({
    budget,
    activeWatcherCount:activeCount,
    quietChecks,
    material,
    usageRatio:allowance.state?.usageRatio || 0,
    burstUntil:condition.burstUntil,
    now,
  })

  if (material && candidate) {
    await createWebIdea(telegramId, condition, String(watcher.id), candidate.result, candidate.quality.matchedKeywords, candidate.quality.relevance)
    await sendWhatsAppIfWanted(
      telegramId,
      condition.delivery,
      `🔎 Gogo found a high-signal update\n\n${condition.title}\n${candidate.result.title}\n\nI saved the source in Ideas. I’ll stay quiet unless something materially different appears.`,
    ).catch(err => console.error('AGENT_WATCHER_WHATSAPP_FAILED:', err?.message || err))
    await writeActivity(telegramId, `Background Gogo found a high-signal web update: ${condition.title}`, {
      watcher_id:watcher.id,
      type:'web_search',
      source_url:candidate.quality.canonicalUrl,
      relevance:candidate.quality.relevance,
      matched_keywords:candidate.quality.matchedKeywords,
    })
  }

  const currentUrls = topResults.map(result => canonicalWatcherUrl(result.url)).filter(Boolean)
  const currentSignatures = topResults.map(result => watcherResultSignature(result.title, result.snippet || ''))
  const seenUrls = appendBoundedHistory(priorSeenUrls, currentUrls)
  const seenSignatures = appendBoundedHistory(priorSeenSignatures, currentSignatures)
  const alertTimes = material
    ? [...alertGate.recentAlertTimes, now.toISOString()]
    : alertGate.recentAlertTimes

  await supabaseAdmin.from('agent_watchers').update({
    cadence_minutes:cadenceMinutes,
    condition_json:{ ...condition, cadenceMinutes },
    last_checked_at:now.toISOString(),
    next_check_at:new Date(now.getTime() + cadenceMinutes * 60_000).toISOString(),
    last_state_json:{
      fingerprint,
      urls:currentUrls,
      seenUrls,
      seenSignatures,
      quietChecks,
      baselineAt:watcher.last_state_json?.baselineAt || now.toISOString(),
      lastTriggeredAt:material ? now.toISOString() : watcher.last_state_json?.lastTriggeredAt || null,
      lastAlertAt:material ? now.toISOString() : watcher.last_state_json?.lastAlertAt || null,
      alertTimes,
      suppressedReason,
      suppressedAt:suppressedReason ? now.toISOString() : null,
      candidateReason:candidate?.quality.reason || assessments[0]?.quality.reason || 'none',
      candidateRelevance:candidate?.quality.relevance || 0,
      costGuard:'ok',
    },
    updated_at:now.toISOString(),
  }).eq('id', watcher.id)
  return { triggered:material, failed:false }
}

export async function processDueAgentWatchers(limit = 40) {
  const now = new Date()
  const { data, error } = await supabaseAdmin.from('agent_watchers')
    .select('id, telegram_id, type, condition_json, last_state_json, active, next_check_at')
    .eq('active', true)
    .lte('next_check_at', now.toISOString())
    .order('next_check_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`agent_watchers_read_failed:${error.message}`)

  let checked = 0, triggered = 0, failed = 0
  for (const watcher of (data || []) as any[]) {
    checked++
    try {
      const outcome = watcher.type === 'deadline'
        ? await processDeadlineWatcher(watcher, now)
        : watcher.type === 'web_search'
          ? await processWebSearchWatcher(watcher, now)
          : watcher.type === 'product_stock'
            ? await processProductStockWatcher(watcher, now)
            : watcher.type === 'email_triage'
              ? await processInboxTriageWatcher(watcher, now)
              : null
      if (!outcome) {
        await supabaseAdmin.from('agent_watchers').update({ next_check_at: new Date(now.getTime() + 3600_000).toISOString(), last_checked_at: now.toISOString() }).eq('id', watcher.id)
        continue
      }
      if (outcome.triggered) triggered++
      if (outcome.failed) failed++
    } catch (err:any) {
      failed++
      console.error('AGENT_WATCHER_PROCESS_FAILED:', watcher.id, err?.message || err)
    }
  }
  return { checked, triggered, failed }
}
