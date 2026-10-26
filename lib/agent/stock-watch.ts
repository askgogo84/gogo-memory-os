import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { createWebSearchWatcher, normalizeWebSearchWatcher, type ReusedWatcher } from './watchers'
import { reusedWatchText } from './watch-dedupe'
import { fetchStockQuote, resolveStockSymbols, type StockMatch } from './stock-quote'
import { inr, normalizeStockRule, parseStockWatchCommand, stockRuleSummary, type StockRule } from './stock-rule'

// A share price moves through the trading day; a half-hourly read is a plain JSON quote with no AI or search cost.
export const STOCK_WATCH_CADENCE_MINUTES = 30

type StockWatchResult = { runId: string; status: 'completed' | 'paused' | 'waiting_user'; capability: 'browser'; risk: 'low'; text: string; handledBy: 'stock-price-watch' }
const reply = (status: StockWatchResult['status'], text: string, runId = 'stock-watch'): StockWatchResult =>
  ({ runId, status, capability: 'browser', risk: 'low', text, handledBy: 'stock-price-watch' })

/** "Watch Tata Motors share price, alert if it moves 10%": a live-quote rule, never a news or search watch. */
export async function tryCreateStockWatchFromCommand(params: { actor: AgentActor; surface: AgentSurface; text: string }, fetchImpl: typeof fetch = fetch): Promise<StockWatchResult | null> {
  const parsed = parseStockWatchCommand(params.text)
  if (!parsed) return null
  const tg = String(params.actor.legacyTelegramId)

  // A ticker the person typed ("TMPV", "RELIANCE.NS") is tried first; otherwise the name is looked up.
  let matches: StockMatch[] = []
  const tickerish = parsed.company.replace(/\s+/g, '').toUpperCase()
  if (/^[A-Z0-9&\-]{2,15}(?:\.(?:NS|BO))?$/.test(tickerish) && /[A-Z]/.test(parsed.company) && parsed.company === parsed.company.toUpperCase()) {
    const symbol = /\.(?:NS|BO)$/.test(tickerish) ? tickerish : `${tickerish}.NS`
    const q = await fetchStockQuote(symbol, fetchImpl).catch(() => null)
    if (q) matches = [{ symbol, name: tickerish.replace(/\.(?:NS|BO)$/, ''), exchange: symbol.endsWith('.BO') ? 'BSE' : 'NSE' }]
  }
  if (!matches.length) {
    try { matches = await resolveStockSymbols(parsed.company, fetchImpl) } catch (err: any) {
      console.error('STOCK_SEARCH_FAILED:', String(err?.message || err).slice(0, 120))
      return reply('paused', `I couldn't look up "${parsed.company}" on the exchange just now, so I haven't started a watch. Please try again in a few minutes.`)
    }
  }
  if (!matches.length) return reply('waiting_user', `I couldn't find an NSE or BSE listed company called "${parsed.company}". Send the exact company name or its NSE symbol, e.g. "watch RELIANCE share price 10%".`)
  if (matches.length > 1) {
    const lines = matches.slice(0, 4).map((m, i) => `${i + 1}. ${m.name} (${m.symbol.replace(/\.(?:NS|BO)$/, '')}, ${m.exchange})`)
    const example = matches[0].symbol.replace(/\.(?:NS|BO)$/, '')
    return reply('waiting_user', `"${parsed.company}" matches more than one listed company:\n${lines.join('\n')}\n\nReply with the symbol you mean, e.g. "watch ${example} share price ${parsed.kind === 'level' ? `${parsed.direction} ${parsed.level}` : `${parsed.pct}%`}".`)
  }

  const match = matches[0]
  let quote = null
  try { quote = await fetchStockQuote(match.symbol, fetchImpl) } catch (err: any) { console.error('STOCK_QUOTE_FAILED:', String(err?.message || err).slice(0, 120)) }
  if (!quote) return reply('paused', `I found ${match.name} (${match.symbol.replace(/\.(?:NS|BO)$/, '')}) but couldn't read a live exchange price, so I haven't started the watch. Please try again shortly.`)

  const now = new Date()
  // A level the price is already past alerts only after it comes back and crosses again (no false "crossed" alert).
  const alreadyPast = parsed.kind === 'level' && parsed.level !== null && (parsed.direction === 'below' ? quote.price < parsed.level : quote.price > parsed.level)
  const rule = normalizeStockRule({ symbol: match.symbol, name: match.name, kind: parsed.kind, direction: parsed.direction, pct: parsed.pct, level: parsed.level, baseline: quote.price, baselineAt: now.toISOString(), ...(alreadyPast ? { startArmed: false } : {}) }) as StockRule | null
  if (!rule) return reply('paused', 'I could not build that share-price rule. Try e.g. "watch Infosys share price, alert if it moves 10%".')

  const title = `Share price: ${stockRuleSummary(rule)}`
  const condition = normalizeWebSearchWatcher({
    title, query: `${match.name} share price ${match.exchange}`, triggerKeywords: [], delivery: 'both',
    cadenceMinutes: STOCK_WATCH_CADENCE_MINUTES, requestedCadenceMinutes: STOCK_WATCH_CADENCE_MINUTES,
    originalRequest: String(params.text || '').slice(0, 2000), stockRule: rule,
  })
  if (!(condition as any)?.stockRule) throw new Error('stock_watch_condition_invalid')

  const startedAt = now.toISOString()
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: tg, type: 'watcher', capability: 'browser', status: 'completed', title,
    summary: `Background Gogo reads the ${match.exchange} price of ${match.name} about every ${STOCK_WATCH_CADENCE_MINUTES} minutes during market hours and alerts only when your rule is met.`,
    progress: 100, why: 'You asked Gogo to watch a share price.', source: params.surface,
    metadata_json: { input_text: String(params.text || '').slice(0, 2000), watcher_type: 'web_search', stock_rule: rule },
    started_at: startedAt, updated_at: startedAt,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`agent_run_create_failed:${runError?.message || 'unknown'}`)

  const watcher = await createWebSearchWatcher({ telegramId: tg, condition: condition! })
  const { data: persisted, error: readError } = await supabaseAdmin.from('agent_watchers').select('id, condition_json, active')
    .eq('id', watcher.id).eq('telegram_id', tg).eq('active', true).maybeSingle()
  const saved = normalizeStockRule((persisted?.condition_json as any)?.stockRule)
  if (readError || !persisted?.id || !saved || saved.symbol !== rule.symbol || saved.kind !== rule.kind || saved.pct !== rule.pct || saved.level !== rule.level) {
    if (persisted?.id) await supabaseAdmin.from('agent_watchers').update({ active: false, next_check_at: null, updated_at: new Date().toISOString() }).eq('id', persisted.id).eq('telegram_id', tg)
    return reply('paused', 'I could not confirm the share-price watch was saved with your exact rule, so I have not started it. Please try again.')
  }
  // 26 Oct: an earlier "share price watch" became a news watch about the same company. Retire those so only the
  // quote watch remains (owner-scoped, active text watches without a numeric rule whose wording names the company).
  let retiredNews = 0
  try {
    const { data: older } = await supabaseAdmin.from('agent_watchers').select('id, condition_json')
      .eq('telegram_id', tg).eq('type', 'web_search').eq('active', true)
    const words = match.name.toLowerCase().replace(/\b(?:ltd|limited|the|india|passenger|vehicles)\b/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length > 2).slice(0, 2)
    const asked = parsed.company.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)
    const key = asked.length ? asked : words
    for (const row of (older || []) as any[]) {
      const c = row.condition_json || {}
      if (row.id === watcher.id || c.stockRule || c.goldRule || c.priceRule || c.contextual) continue
      const hay = `${c.title || ''} ${c.query || ''} ${c.originalRequest || ''}`.toLowerCase()
      const has = (w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay)
      if (key.length && key.every(has) && /\b(?:share|shares|stock|news)\b/.test(hay)) {
        const { data: prev } = await supabaseAdmin.from('agent_watchers').select('last_state_json').eq('id', row.id).eq('telegram_id', tg).maybeSingle()
        const { error } = await supabaseAdmin.from('agent_watchers').update({ active: false, next_check_at: null, updated_at: new Date().toISOString(),
          last_state_json: { ...((prev?.last_state_json as any) || {}), retiredReason: 'replaced_by_share_price_watch', replacedBy: watcher.id } })
          .eq('id', row.id).eq('telegram_id', tg).eq('active', true)
        if (!error) retiredNews++
      }
    }
  } catch (err: any) { console.error('STOCK_WATCH_NEWS_RETIRE_FAILED:', String(err?.message || err).slice(0, 120)) }

  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: tg, run_id: String(run.id), event_type: 'watcher_created',
    message: `Background Gogo started a share-price watch: ${stockRuleSummary(saved)}`.slice(0, 900),
    metadata_json: { watcher_id: watcher.id, type: 'web_search', stock_rule: saved, cadence_minutes: STOCK_WATCH_CADENCE_MINUTES },
  })

  const ticker = `${saved.symbol.replace(/\.(?:NS|BO)$/, '')}, ${saved.exchange}`
  const band = saved.kind === 'level'
    ? saved.startArmed === false
      ? `It's already ${saved.direction} ${inr(saved.level!)}, so I'll alert you when it comes back and crosses ${saved.direction === 'below' ? 'below' : 'above'} ${inr(saved.level!)} again.`
      : `I'll alert you when it goes ${saved.direction} ${inr(saved.level!)}.`
    : saved.direction === 'any'
      ? `I'll alert you if it moves ${saved.pct}% either way: at or below ${inr(quote.price * (1 - saved.pct! / 100))} or at or above ${inr(quote.price * (1 + saved.pct! / 100))}.`
      : `I'll alert you if it ${saved.direction === 'down' ? 'falls' : 'rises'} ${saved.pct}%, to ${inr(quote.price * (1 + (saved.direction === 'down' ? -1 : 1) * saved.pct! / 100))}.`
  const defaulted = parsed.defaulted ? ` You didn't give a size, so I used ${saved.pct}%; send e.g. "alert at 10%" to change it.` : ''
  const news = retiredNews ? ` I stopped your older ${retiredNews === 1 ? 'news watch' : `${retiredNews} news watches`} about it, so you'll only get price alerts.` : ''
  return reply('completed', `${'reused' in watcher ? `${reusedWatchText((watcher as ReusedWatcher).updated, `${saved.name} share price`)} ` : ''}Share-price watch set: ${saved.name} (${ticker}) is ${inr(quote.price)} (as of ${quote.asOf}, Yahoo Finance; can lag the exchange by a few minutes). ${band}${defaulted}${news} I check about every ${STOCK_WATCH_CADENCE_MINUTES} minutes during market hours and never buy or sell.`, String(run.id))
}
