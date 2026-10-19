import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWeb } from '@/lib/web-search'
import { getCostBudget } from '@/lib/services/cost-guard'
import { extractGoldQuotes } from '@/lib/bot/handlers/gold-quotes'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { createWebSearchWatcher, normalizeWebSearchWatcher } from './watchers'
import { initialWatcherCadence, watcherUpgradeMessage } from './watch-cost-policy'
import {
  formatPerGram,
  goldRateSearchQuery,
  goldRuleSummary,
  goldThreshold,
  isGoldRateAlertPhrasing,
  normalizeGoldRule,
  parseGoldRateWatchCommand,
  selectVerifiedGoldValue,
  sourceHost,
  type GoldRule,
  type UnverifiedGoldValue,
} from './gold-rate-rule'

// A metal rate changes about once a day. Checking more often than every 6 hours only adds cost.
export const GOLD_WATCH_CADENCE_MINUTES = 360

type GoldWatchResult = {
  runId: string
  status: 'completed' | 'paused'
  capability: 'browser'
  risk: 'low'
  text: string
  handledBy: 'gold-rate-watch'
  blockedReason?: string
}

function paused(runId: string, text: string, blockedReason?: string): GoldWatchResult {
  return { runId, status: 'paused', capability: 'browser', risk: 'low', text, handledBy: 'gold-rate-watch', ...(blockedReason ? { blockedReason } : {}) }
}

async function browserWatchAllowed(telegramId: number) {
  const { data, error } = await supabaseAdmin.from('agent_permissions')
    .select('level')
    .eq('telegram_id', String(telegramId))
    .eq('capability', 'browser')
    .maybeSingle()
  if (error) throw new Error(`agent_permission_unavailable:${error.message}`)
  return String(data?.level || 'draft') !== 'off'
}

function sameRule(a: GoldRule, b: GoldRule) {
  return a.karat === b.karat && a.direction === b.direction && a.mode === b.mode && a.value === b.value &&
    String(a.place || '').toLowerCase() === String(b.place || '').toLowerCase()
}

/**
 * "Alert me if gold rate drops by 10%" creates a persistent gold-rate watch measured from a verified
 * current per-gram quote. Returns null for anything that is not an alert-shaped gold/silver rate request.
 */
export async function tryCreateGoldRateWatchFromCommand(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
  now?: number
}): Promise<GoldWatchResult | null> {
  const parsed = parseGoldRateWatchCommand(params.text)
  if (!parsed) {
    if (!isGoldRateAlertPhrasing(params.text)) return null
    return paused('gold-watch-clarify',
      'I can watch the gold rate for you, but I need the rule. Say which way and how far, for example ' +
      '"alert me if 24K gold drops by 5%" or "tell me when 22K gold goes below ₹12,000 per gram". I have not set a watch yet.')
  }
  if (parsed.metal === 'silver') {
    return paused('gold-watch-silver-unsupported',
      "I can't yet verify a single per-gram silver rate from sources reliably, so I haven't set a silver watch. " +
      'I can set the same kind of watch on the gold rate, for example "alert me if 24K gold drops by 5%".')
  }

  const tg = String(params.actor.legacyTelegramId)
  if (!(await browserWatchAllowed(params.actor.legacyTelegramId))) {
    return paused('gold-watch-blocked', 'Browser monitoring is off in Gogo Safe Mode. Turn Browser access back on to create this watch.', 'browser_permission_off')
  }
  const budget = await getCostBudget(tg)
  if (budget.activeWebWatchersMax <= 0) {
    return paused('gold-watch-plan-blocked', watcherUpgradeMessage(budget.planCode), 'plan_background_watch_unavailable')
  }
  const { count, error: countError } = await supabaseAdmin.from('agent_watchers')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', tg)
    .in('type', ['web_search', 'web_page', 'product_stock'])
    .eq('active', true)
  if (countError) throw new Error(`agent_watcher_count_failed:${countError.message}`)
  const activeWatcherCount = count || 0
  if (activeWatcherCount >= budget.activeWebWatchersMax) {
    return paused('gold-watch-plan-limit', watcherUpgradeMessage(budget.planCode), 'plan_background_watch_limit')
  }

  const karat = parsed.karat || '24'
  const place = parsed.place
  const placeLabel = place || 'India'
  const query = goldRateSearchQuery(place)
  const now = params.now ?? Date.now()

  // The reference is the same source-bound per-gram extraction the chat gold quote uses.
  const context = await searchWeb(query)
  const extraction = extractGoldQuotes(`${karat}K gold rate today`, context, now, placeLabel)
  const verified = selectVerifiedGoldValue(extraction, karat)

  let baselinePerGram: number | null = null
  let baselineSource: string | null = null
  let baselineDate: string | null = null
  let thresholdPerGram: number
  let unitNote = ''
  if (verified.ok) {
    baselinePerGram = verified.perGram
    baselineSource = verified.source
    baselineDate = verified.date
  }
  if (parsed.mode === 'percent') {
    if (!verified.ok) {
      const why = !context.trim() ? 'I could not reach a rate source just now' : (verified as UnverifiedGoldValue).detail
      return paused('gold-watch-baseline-unverified',
        `I couldn't verify a current ${karat}K per-gram rate${place ? ` for ${place}` : ''} to measure ${parsed.value}% from (${why}), ` +
        `so I haven't set the watch. I won't guess a starting price. If you tell me an exact level instead, for example ` +
        `"tell me when ${karat}K gold goes ${parsed.direction === 'down' ? 'below' : 'above'} ₹12,000 per gram", I'll watch for that.`)
    }
    thresholdPerGram = goldThreshold(verified.perGram, parsed.direction, parsed.value)
  } else {
    let grams = parsed.unitGrams
    if (grams === null) {
      // No unit stated. A per-gram gold rate is never several times the verified rate; Indian rates
      // are also quoted per 10 g, so an amount like ₹1.3 lakh is read as per 10 g, and said so.
      const looksPer10g = verified.ok ? parsed.value >= verified.perGram * 4.5 : parsed.value >= 50_000
      grams = looksPer10g ? 10 : 1
      unitNote = looksPer10g
        ? ` I read ${formatPerGram(parsed.value)} as the price per 10 g.`
        : ` I read ${formatPerGram(parsed.value)} as the price per gram.`
    }
    thresholdPerGram = Math.round(parsed.value / grams * 100) / 100
  }

  const goldRule = normalizeGoldRule({
    metal: 'gold', karat, direction: parsed.direction, mode: parsed.mode, value: parsed.value,
    baselinePerGram, thresholdPerGram, place, baselineSource, baselineDate,
  })
  if (!goldRule) {
    return paused('gold-watch-rule-invalid', 'I could not turn that into a gold-rate rule I can check by number, so I have not set a watch. Try "alert me if 24K gold drops by 5%".')
  }

  // Dedup: the same rule already watched is reported, never duplicated.
  const { data: existing, error: existingError } = await supabaseAdmin.from('agent_watchers')
    .select('id, condition_json, created_at')
    .eq('telegram_id', tg)
    .eq('type', 'web_search')
    .eq('active', true)
  if (existingError) throw new Error(`agent_watcher_read_failed:${existingError.message}`)
  const duplicate = (existing || []).find((row: any) => {
    const rule = normalizeGoldRule((row.condition_json as any)?.goldRule)
    return rule && sameRule(rule, goldRule)
  })
  if (duplicate) {
    const rule = normalizeGoldRule((duplicate as any).condition_json?.goldRule) as GoldRule
    return {
      runId: `gold-watch-existing-${(duplicate as any).id}`, status: 'completed', capability: 'browser', risk: 'low',
      text: `You're already watching this: I'll alert you if ${goldRuleSummary(rule)}. I haven't created a duplicate. Say "show my watches" for status or stop it by name.`,
      handledBy: 'gold-rate-watch',
    }
  }

  const cadenceMinutes = Math.max(GOLD_WATCH_CADENCE_MINUTES, initialWatcherCadence({ budget, activeWatcherCount: activeWatcherCount + 1 }))
  const title = `Gold rate: ${goldRuleSummary(goldRule)}`
  const condition = normalizeWebSearchWatcher({
    title,
    query,
    triggerKeywords: [],
    delivery: 'both',
    cadenceMinutes,
    requestedCadenceMinutes: GOLD_WATCH_CADENCE_MINUTES,
    originalRequest: String(params.text || '').slice(0, 2000),
    goldRule,
  })
  if (!condition?.goldRule) throw new Error('gold_watch_condition_invalid')

  const startedAt = new Date(now).toISOString()
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: tg, type: 'watcher', capability: 'browser', status: 'completed', title,
    summary: `Background Gogo checks the ${karat}K gold rate about every ${Math.round(cadenceMinutes / 60)} hours and alerts only on a verified per-gram quote past ${formatPerGram(thresholdPerGram)}.`,
    progress: 100,
    why: 'You asked Gogo to watch the gold rate and alert you when it crosses your level.',
    source: params.surface,
    metadata_json: { input_text: String(params.text || '').slice(0, 2000), watcher_type: 'web_search', gold_rule: goldRule, plan_code: budget.planCode },
    started_at: startedAt, updated_at: startedAt,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`agent_run_create_failed:${runError?.message || 'unknown'}`)

  const watcher = await createWebSearchWatcher({ telegramId: tg, condition })

  // Confirm from the PERSISTED row, never from the template (same rule as finalizePriceWatch).
  const { data: persisted, error: readError } = await supabaseAdmin.from('agent_watchers')
    .select('id, condition_json, active')
    .eq('id', watcher.id).eq('telegram_id', tg).eq('active', true)
    .maybeSingle()
  if (readError || !persisted?.id) throw new Error('gold_watch_readback_failed')
  const saved = normalizeGoldRule((persisted.condition_json as any)?.goldRule)
  if (!saved || !sameRule(saved, goldRule) || saved.thresholdPerGram !== goldRule.thresholdPerGram || saved.baselinePerGram !== goldRule.baselinePerGram) {
    await supabaseAdmin.from('agent_watchers').update({ active: false, next_check_at: null, updated_at: new Date().toISOString() })
      .eq('id', persisted.id).eq('telegram_id', tg)
    return paused('gold-watch-verify-failed', 'I could not confirm the gold watch was saved with your exact rule, so I have not started it. Please try again.')
  }

  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: tg, run_id: String(run.id), event_type: 'watcher_created',
    message: `Background Gogo started a gold-rate watch: ${goldRuleSummary(saved)}`.slice(0, 900),
    metadata_json: { watcher_id: watcher.id, type: 'web_search', gold_rule: saved, cadence_minutes: cadenceMinutes },
  })

  const verb = saved.direction === 'down' ? 'falls below' : 'rises above'
  const change = saved.mode === 'percent' ? ` (${saved.value}% ${saved.direction === 'down' ? 'drop' : 'rise'})` : ''
  const baselineText = saved.baselinePerGram !== null
    ? `baseline ${formatPerGram(saved.baselinePerGram)}/g (${sourceHost(saved.baselineSource || '')}, ${saved.baselineDate})`
    : `no verified current baseline yet`
  const placeCaveat = verified.ok && !verified.locationKnown && place ? ` The source does not confirm the rate is specific to ${place}.` : ''
  const already = verified.ok && (saved.direction === 'down' ? verified.perGram < saved.thresholdPerGram : verified.perGram > saved.thresholdPerGram)
    ? ` The current verified rate is already past that level, so my first check will alert you.` : ''
  const karatText = parsed.karatDefaulted ? ` Default karat 24K — say "22K" to change.` : ''
  return {
    runId: String(run.id), status: 'completed', capability: 'browser', risk: 'low',
    text: `Gold watch set: ${saved.karat}K in ${placeLabel}, ${baselineText}. I'll alert you if a verified per-gram quote ${verb} ${formatPerGram(saved.thresholdPerGram)}${change}.${unitNote}${already}${placeCaveat}${karatText} ` +
      `I check about every ${Math.round(cadenceMinutes / 60)} hours and stay silent when sources disagree or aren't dated today. I never buy or sell, and this isn't financial advice.`,
    handledBy: 'gold-rate-watch',
  }
}
