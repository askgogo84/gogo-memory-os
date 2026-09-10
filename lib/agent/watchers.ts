import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { checkCostAllowance, COST_ESTIMATES_PAISE, getCostBudget, recordCostEvent } from '@/lib/services/cost-guard'
import { adaptiveWatcherCadence } from './watch-cost-policy'

export type WatcherDelivery = 'app' | 'whatsapp' | 'both'

export type DeadlineWatcherCondition = {
  title: string
  deadline: string
  notifyBeforeHours: number
  delivery: WatcherDelivery
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
    last_state_json: { quietChecks:0 },
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

async function createWebIdea(telegramId: string, condition: WebSearchWatcherCondition, watcherId: string, result: WebSearchResult | null, matchedKeywords: string[]) {
  const detail = matchedKeywords.length
    ? `New result matched: ${matchedKeywords.join(', ')}.`
    : 'A new top web result appeared since the previous check.'
  const sourceRefs:any[] = [{ type:'watcher', id:watcherId }]
  if (result?.url) sourceRefs.push({ type:'url', url:result.url })
  const { error } = await supabaseAdmin.from('agent_ideas').insert({
    telegram_id: telegramId,
    title: condition.title,
    reason: detail,
    expected_value: result?.title ? `${result.title}${result.snippet ? ` — ${result.snippet.slice(0, 180)}` : ''}` : 'Open the latest results to review what changed.',
    value_score: matchedKeywords.length ? 0.92 : 0.78,
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
  const stable = results.slice(0, 5).map(r => `${r.title.toLowerCase()}\n${r.url.toLowerCase()}`).join('\n---\n')
  return createHash('sha256').update(stable).digest('hex')
}

function resultText(result: WebSearchResult) {
  return `${result.title} ${result.snippet} ${result.url}`.toLowerCase()
}

async function activeWebWatchCount(telegramId:string) {
  const { count, error } = await supabaseAdmin.from('agent_watchers')
    .select('id', { count:'exact', head:true })
    .eq('telegram_id', telegramId)
    .eq('type', 'web_search')
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

  const fingerprint = searchFingerprint(results)
  const currentUrls = results.slice(0, 5).map(r => r.url).filter(Boolean)
  const previousUrls = Array.isArray(watcher.last_state_json?.urls) ? watcher.last_state_json.urls : []
  const isBaseline = !watcher.last_state_json?.fingerprint
  const newUrls = currentUrls.filter((url:string) => !previousUrls.includes(url))
  const matchedKeywords = condition.triggerKeywords.filter(keyword => results.some(r => resultText(r).includes(keyword)))
  const previousMatches = Array.isArray(watcher.last_state_json?.matchedKeywords) ? watcher.last_state_json.matchedKeywords : []
  const newlyMatchedKeywords = matchedKeywords.filter(keyword => !previousMatches.includes(keyword))
  const changed = fingerprint !== watcher.last_state_json?.fingerprint
  const material = !isBaseline && changed && (condition.triggerKeywords.length ? newlyMatchedKeywords.length > 0 : newUrls.length > 0)
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

  if (material) {
    const lead = results.find(r => newUrls.includes(r.url)) || results[0] || null
    await createWebIdea(telegramId, condition, String(watcher.id), lead, newlyMatchedKeywords)
    await sendWhatsAppIfWanted(telegramId, condition.delivery, `🔎 Background Gogo found a meaningful web update\n\n${condition.title}${lead?.title ? `\n${lead.title}` : ''}\n\nI’ve added the update to Ideas in the app.`).catch(err => console.error('AGENT_WATCHER_WHATSAPP_FAILED:', err?.message || err))
    await writeActivity(telegramId, `Background Gogo found a web update: ${condition.title}`, { watcher_id:watcher.id, type:'web_search', new_urls:newUrls.slice(0,5), matched_keywords:newlyMatchedKeywords })
  }

  await supabaseAdmin.from('agent_watchers').update({
    cadence_minutes:cadenceMinutes,
    condition_json:{ ...condition, cadenceMinutes },
    last_checked_at:now.toISOString(),
    next_check_at:new Date(now.getTime() + cadenceMinutes * 60_000).toISOString(),
    last_state_json:{
      fingerprint,
      urls:currentUrls,
      matchedKeywords,
      quietChecks,
      baselineAt:watcher.last_state_json?.baselineAt || now.toISOString(),
      lastTriggeredAt:material ? now.toISOString() : watcher.last_state_json?.lastTriggeredAt || null,
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
