// Gold-rate watch. "Alert me if gold rate drops by 10%" is a numeric rule on a verified per-gram
// metal quote, not a one-off quote and not a retail product price watch. This module parses the
// request, picks a single verified per-gram value from the shared gold quote extractor, and decides
// by code whether the rule is met. Pure: no I/O, no clock, no model.

import type { GoldQuote, GoldQuoteExtraction } from '@/lib/bot/handlers/gold-quotes'

export type GoldMetal = 'gold' | 'silver'
export type GoldKarat = '24' | '22' | '18'

export type GoldRateWatchCommand = {
  metal: GoldMetal
  karat: GoldKarat | null
  // True when the person named no purity and 24K was assumed.
  karatDefaulted: boolean
  direction: 'down' | 'up'
  mode: 'percent' | 'absolute'
  value: number
  // Grams the stated absolute amount refers to (1 = per gram, 10 = per 10 g). null = not stated.
  unitGrams: number | null
  place: string | null
}

export type GoldRule = {
  metal: 'gold'
  karat: GoldKarat
  direction: 'down' | 'up'
  mode: 'percent' | 'absolute'
  value: number
  baselinePerGram: number | null
  thresholdPerGram: number
  place: string | null
  baselineSource: string | null
  baselineDate: string | null
}

// Common typos for the direction verb. "drips" is the 19 Oct live message.
const TYPO_FIXES: Array<[RegExp, string]> = [
  [/\b(?:drips|drps|dorps|drpos|dropes|dorp|dops|drpo|droos)\b/gi, 'drops'],
  [/\b(?:drip|drp)\b/gi, 'drop'],
  [/\b(?:fals|fallls|flls)\b/gi, 'falls'],
  [/\b(?:dipps|dpis)\b/gi, 'dips'],
  [/\b(?:glod|gols|goldd)\b/gi, 'gold'],
  [/\b(?:rais|riese|rsies)\b/gi, 'rises'],
]

function normalizeText(raw: string): string {
  let text = String(raw || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
  for (const [re, to] of TYPO_FIXES) text = text.replace(re, to)
  return text
}

const ALERT_LEAD = /\b(?:alert|notify|tell|ping|message|inform|warn|text|whatsapp)\s+me\b|\blet\s+me\s+know\b|\bsend\s+(?:me\s+)?an?\s+(?:alert|message|notification)\b|\bset\s+(?:up\s+)?an?\s+(?:alert|watch)\b|\b(?:watch|monitor|track)\b|\bkeep\s+an?\s+eye\b|\bgive\s+me\s+an?\s+(?:alert|heads[\s-]?up)\b/i
const CONDITIONAL = /\b(?:if|when|whenever|once|as\s+soon\s+as|in\s+case)\b/i
const METAL_RE = /\b(gold|silver)\b/i
// A coin, jewellery, fund, loan or stock is a product or instrument, not the metal rate.
const NOT_METAL_RATE = /\b(?:coins?|jewel(?:le)?ry|jewelery|necklace|ring|chain|bangles?|etfs?|funds?|sgb|bonds?|loans?|plated|card|goldman|golden|stocks?|shares?|amazon|flipkart|myntra|tanishq\s+offer|mutual)\b/i
const DOWN_RE = /\b(?:drops?|dropped|dips?|dipped|falls?|fell|declines?|declined|slips?|slides?|crash(?:es)?|decreases?|reduces?|tumbles?|goes\s+down|go\s+down|comes?\s+down|come\s+down|gets?\s+cheaper|below|under|less\s+than|lower\s+than|cheaper\s+than)\b/i
const UP_RE = /\b(?:rises?|rose|goes\s+up|go\s+up|increases?|increased|jumps?|climbs?|crosses|surges?|spikes?|shoots?\s+up|above|over|more\s+than|higher\s+than|exceeds?|tops?)\b/i
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*(?:%|percent\b|per\s*cent\b|pc\b)/i
const MONEY_RE = /(?:₹|\brs\.?|\binr)\s*(\d[\d,]*(?:\.\d+)?)\s*(k|lakhs?|lacs?|l)?\b|\b(\d[\d,]*(?:\.\d+)?)\s*(k|lakhs?|lacs?|rupees|rs\.?|inr)\b|\b(\d{1,3}(?:,\d{2,3})+|\d{4,})\b/i
const KARAT_RE = /\b(18|22|24)\s*[-–]?\s*(?:kts?|karats?|carats?|ct|k)\b/i
const PLACE_STOP = new Set(['price', 'prices', 'rate', 'rates', 'value', 'terms', 'total', 'today', 'future', 'case', 'general', 'the', 'a', 'an', 'my', 'percent', 'per', 'rupees', 'inr', 'grams', 'gram'])

/** Alert-shaped request about the gold/silver rate, whether or not every slot can be read. */
export function isGoldRateAlertPhrasing(raw: string): boolean {
  const text = normalizeText(raw)
  if (!METAL_RE.test(text) || NOT_METAL_RATE.test(text)) return false
  if (!ALERT_LEAD.test(text) || !CONDITIONAL.test(text)) return false
  return DOWN_RE.test(text) || UP_RE.test(text) || PERCENT_RE.test(text) || /\b(?:changes?|moves?)\b/i.test(text)
}

function parsePlace(text: string): string | null {
  for (const m of text.matchAll(/\bin\s+([A-Za-z][A-Za-z]+(?:\s+(?!and\b|if\b|when\b|alert\b|by\b|below\b|under\b|above\b|over\b|to\b|from\b|for\b|per\b|today\b|now\b)[A-Za-z]+)?)/g)) {
    const words = m[1].split(/\s+/)
    if (PLACE_STOP.has(words[0].toLowerCase())) continue
    const kept = words.filter((w) => !PLACE_STOP.has(w.toLowerCase()))
    if (!kept.length) continue
    return kept.join(' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return null
}

function moneyValue(m: RegExpMatchArray): number | null {
  const raw = m[1] || m[3] || m[5]
  const unit = (m[2] || m[4] || '').toLowerCase()
  let value = Number(String(raw || '').replace(/,/g, ''))
  if (!Number.isFinite(value) || value <= 0) return null
  if (unit === 'k') value *= 1_000
  else if (/^(?:lakhs?|lacs?|l)$/.test(unit)) value *= 100_000
  return Math.round(value * 100) / 100
}

function unitGramsAfter(text: string): number | null {
  const m = text.match(/^\s*(?:\/|per|a|for|of)?\s*(?:(\d+(?:\.\d+)?)\s*)?(kg|kilo(?:gram)?s?|grams?|gms?|g)\b/i)
  if (!m) return null
  const weight = Number(m[1] || 1)
  return /^k/i.test(m[2]) ? weight * 1000 : weight
}

/**
 * "alert me if gold rate drops/dips/drips by 10%", "tell me when 22K gold goes below ₹13,000 per gram",
 * "notify me if gold price rises by 5% from today", "watch gold rate in Bangalore and alert me if it falls 3%".
 * Returns null for quote asks ("what is the gold rate today") and anything that is not an alert rule.
 */
export function parseGoldRateWatchCommand(raw: string): GoldRateWatchCommand | null {
  const text = normalizeText(raw)
  if (!text || text.length > 400) return null
  const metalMatch = text.match(METAL_RE)
  if (!metalMatch || NOT_METAL_RATE.test(text)) return null
  if (!ALERT_LEAD.test(text) || !CONDITIONAL.test(text)) return null
  // A reminder to check the rate is a reminder, not a rule.
  if (/\bremind\s+me\b/i.test(text)) return null

  // Only read the rule from the condition clause onward ("... if it falls 3%").
  const condIndex = text.search(CONDITIONAL)
  const clause = text.slice(condIndex)
  const down = clause.match(DOWN_RE)
  const up = clause.match(UP_RE)
  if (!down && !up) return null
  // The first direction word decides ("falls under", "goes up over").
  const direction: 'down' | 'up' = down && (!up || (down.index ?? 0) <= (up.index ?? 0)) ? 'down' : 'up'

  let mode: 'percent' | 'absolute'
  let value: number
  let unitGrams: number | null = null
  const pct = clause.match(PERCENT_RE)
  if (pct) {
    mode = 'percent'
    value = Number(pct[1])
    if (!Number.isFinite(value) || value <= 0 || value >= 100) return null
  } else {
    // Skip a karat number ("22K") when reading the amount.
    const withoutKarat = clause.replace(new RegExp(KARAT_RE.source, 'gi'), ' ')
    const money = withoutKarat.match(MONEY_RE)
    if (!money) return null
    const amount = moneyValue(money)
    if (amount === null || amount < 10) return null
    mode = 'absolute'
    value = amount
    unitGrams = unitGramsAfter(withoutKarat.slice((money.index ?? 0) + money[0].length))
  }

  const metal = metalMatch[1].toLowerCase() as GoldMetal
  const karatMatch = text.match(KARAT_RE)
  const karat = metal === 'gold' ? ((karatMatch?.[1] as GoldKarat | undefined) || '24') : null
  return {
    metal,
    karat,
    karatDefaulted: metal === 'gold' && !karatMatch,
    direction,
    mode,
    value,
    unitGrams,
    place: parsePlace(text),
  }
}

export function goldRateSearchQuery(place: string | null): string {
  return `gold rate per gram today in ${(place || 'India').toLowerCase()} 24 carat 22 carat`
}

/** The same "N. title / snippet / Source: url" blocks the chat gold quote reads. */
export function goldSearchContext(results: Array<{ title: string; snippet?: string; url: string }>): string {
  return results.map((r, i) => `${i + 1}. ${r.title}\n${r.snippet || ''}\nSource: ${r.url}`).join('\n\n')
}

export type UnverifiedGoldValue = Extract<VerifiedGoldValue, { ok: false }>

export const GOLD_SOURCE_SPREAD = 0.01

export type VerifiedGoldValue =
  | { ok: true; perGram: number; values: number[]; source: string; sources: string[]; date: string; locationKnown: boolean }
  | { ok: false; reason: 'no_quote' | 'sources_differ' | 'not_current'; values: number[]; detail: string }

function round2(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * One verified current per-gram value for a karat: every selected quote is dated today (or says
 * today with no other date) and all of them agree within 1%. Anything else is not a single value.
 */
export function selectVerifiedGoldValue(extraction: GoldQuoteExtraction, karat: GoldKarat): VerifiedGoldValue {
  const selected: GoldQuote[] = extraction.selected[karat] || []
  if (!selected.length) return { ok: false, reason: 'no_quote', values: [], detail: `no source-bound ${karat}K per-gram quote` }
  const current = selected.filter((q) => q.date === extraction.today || (q.date === null && q.reportedToday))
  const values = [...new Set(selected.map((q) => q.perGram))].sort((a, b) => a - b)
  if (!current.length || current.length !== selected.length) {
    return { ok: false, reason: 'not_current', values, detail: `the ${karat}K quote is not dated today` }
  }
  const low = values[0], high = values[values.length - 1]
  if ((high - low) / low > GOLD_SOURCE_SPREAD) {
    return { ok: false, reason: 'sources_differ', values, detail: `sources differ (${values.map(formatPerGram).join(' vs ')})` }
  }
  const sorted = current.map((q) => q.perGram).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const perGram = round2(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
  const pick = current.find((q) => q.perGram === sorted[mid]) || current[0]
  return {
    ok: true,
    perGram,
    values,
    source: pick.source,
    sources: [...new Set(current.map((q) => q.source))],
    date: current.find((q) => q.date)?.date || extraction.today,
    locationKnown: current.some((q) => q.locationKnown),
  }
}

export function goldThreshold(baseline: number, direction: 'down' | 'up', pct: number): number {
  return round2(baseline * (direction === 'down' ? 1 - pct / 100 : 1 + pct / 100))
}

export function normalizeGoldRule(input: any): GoldRule | null {
  if (!input || typeof input !== 'object') return null
  if (input.metal !== 'gold') return null
  const karat = String(input.karat) as GoldKarat
  if (!['24', '22', '18'].includes(karat)) return null
  const direction = input.direction === 'up' ? 'up' : input.direction === 'down' ? 'down' : null
  const mode = input.mode === 'percent' ? 'percent' : input.mode === 'absolute' ? 'absolute' : null
  const value = Number(input.value)
  const thresholdPerGram = Number(input.thresholdPerGram)
  if (!direction || !mode || !Number.isFinite(value) || value <= 0 || !Number.isFinite(thresholdPerGram) || thresholdPerGram <= 0) return null
  const baseline = input.baselinePerGram === null || input.baselinePerGram === undefined ? null : Number(input.baselinePerGram)
  if (mode === 'percent' && !(Number.isFinite(baseline) && (baseline as number) > 0)) return null
  return {
    metal: 'gold',
    karat,
    direction,
    mode,
    value,
    baselinePerGram: baseline !== null && Number.isFinite(baseline) && baseline > 0 ? baseline : null,
    thresholdPerGram,
    place: input.place ? String(input.place).slice(0, 60) : null,
    baselineSource: input.baselineSource ? String(input.baselineSource).slice(0, 500) : null,
    baselineDate: input.baselineDate ? String(input.baselineDate).slice(0, 10) : null,
  }
}

export function formatPerGram(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export function sourceHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// ---- one check of a gold watch ---------------------------------------------------------------
export type GoldVerdict = {
  action: 'alert' | 'silent'
  reason: 'crossed' | 'not_crossed' | 'mixed' | 'no_quote' | 'sources_differ' | 'not_current'
  observed: number | null
  source: string | null
  date: string | null
  detail: string
}

function crosses(rule: GoldRule, value: number) {
  return rule.direction === 'down' ? value < rule.thresholdPerGram : value > rule.thresholdPerGram
}

/** Alerts only when a single verified per-gram value strictly crosses the threshold. */
export function evaluateGoldRule(rule: GoldRule, extraction: GoldQuoteExtraction): GoldVerdict {
  const verified = selectVerifiedGoldValue(extraction, rule.karat)
  if (!verified.ok) {
    const failed = verified as UnverifiedGoldValue
    return { action: 'silent', reason: failed.reason, observed: null, source: null, date: null, detail: failed.detail }
  }
  const all = verified.values.map((v) => crosses(rule, v))
  const base = { observed: verified.perGram, source: verified.source, date: verified.date }
  if (all.every(Boolean)) return { action: 'alert', reason: 'crossed', ...base, detail: 'every verified quote crosses the threshold' }
  if (all.some(Boolean)) return { action: 'silent', reason: 'mixed', ...base, detail: 'verified quotes straddle the threshold' }
  return { action: 'silent', reason: 'not_crossed', ...base, detail: 'verified quote has not crossed the threshold' }
}

// Notification policy: alert on the first verified crossing, then stay quiet while it stays past
// the threshold (a daily price moving a little further is not news). A verified quote back on the
// other side re-arms the watch. Unverified or ambiguous evidence never alerts and never re-arms.
export type GoldAlertState = { armed: boolean; lastAlertPerGram: number | null }

export function goldStateFrom(lastState: any): GoldAlertState {
  const last = lastState?.lastAlertPerGram
  const number = last === null || last === undefined || last === '' ? NaN : Number(last)
  return { armed: lastState?.goldArmed !== false, lastAlertPerGram: Number.isFinite(number) ? number : null }
}

export function decideGoldAlert(state: GoldAlertState, verdict: GoldVerdict): {
  notify: boolean
  reason: 'first_alert' | 're_armed' | 'already_alerted' | 'not_crossed' | 'unverified'
  next: GoldAlertState
} {
  if (verdict.reason === 'not_crossed') return { notify: false, reason: 'not_crossed', next: { ...state, armed: true } }
  if (verdict.action !== 'alert') return { notify: false, reason: 'unverified', next: state }
  if (!state.armed) return { notify: false, reason: 'already_alerted', next: state }
  return {
    notify: true,
    reason: state.lastAlertPerGram === null ? 'first_alert' : 're_armed',
    next: { armed: false, lastAlertPerGram: verdict.observed },
  }
}

export type GoldRun = { at: string; outcome: 'alert' | 'sent_nothing' | 'unverified' | 'no_results'; observed: number | null; reason: string; source: string | null; date: string | null }
export const GOLD_RUN_HISTORY = 40

export function appendGoldRun(runs: GoldRun[] | undefined, run: GoldRun): GoldRun[] {
  return [...(Array.isArray(runs) ? runs : []), run].slice(-GOLD_RUN_HISTORY)
}

export function goldRuleSummary(rule: GoldRule): string {
  const verb = rule.direction === 'down' ? 'falls below' : 'rises above'
  const why = rule.mode === 'percent' && rule.baselinePerGram
    ? ` (${rule.value}% ${rule.direction === 'down' ? 'drop' : 'rise'} from ${formatPerGram(rule.baselinePerGram)})`
    : ''
  return `${rule.karat}K gold${rule.place ? ` in ${rule.place}` : ''} ${verb} ${formatPerGram(rule.thresholdPerGram)}/g${why}`
}

export function goldAlertText(params: { rule: GoldRule; verdict: GoldVerdict; at: Date }): string {
  const { rule, verdict } = params
  const when = params.at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
  const verb = rule.direction === 'down' ? 'below' : 'above'
  const baseline = rule.mode === 'percent' && rule.baselinePerGram
    ? ` (${rule.value}% ${rule.direction === 'down' ? 'under' : 'over'} the ${formatPerGram(rule.baselinePerGram)} baseline from ${rule.baselineDate || 'setup'})`
    : ''
  return (
    `Gold rate alert: ${rule.karat}K${rule.place ? ` in ${rule.place}` : ''} is ${formatPerGram(verdict.observed as number)}/g ` +
    `(${sourceHost(verdict.source || '')}, as of ${verdict.date}), ${verb} your ${formatPerGram(rule.thresholdPerGram)}/g threshold${baseline}. ` +
    `Checked ${when} IST. This is a published metal rate, not a jeweller's final price (making charges and GST are extra). ` +
    `I never buy or sell, and this is not financial advice.\n\n${verdict.source || ''}\n\n` +
    `I'll stay quiet now unless it goes back ${rule.direction === 'down' ? 'above' : 'below'} ${formatPerGram(rule.thresholdPerGram)} and crosses again.`
  )
}
