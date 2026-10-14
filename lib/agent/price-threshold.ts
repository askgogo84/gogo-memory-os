// Numeric price watch. A search watcher alerts on "a relevant result"; that is not the same as
// "the price is below X". "Tell me if it drops below ₹24,000" must never alert on a result that
// shows ₹25,000 plus a ₹3,000 cashback. This module reads the prices a result states, says what
// each amount IS (selling price, offer price, saving, MRP, EMI), and decides by code, never by
// model prose, whether the rule is met. Pure: no I/O, no clock, no model.

export type PriceRule = {
  threshold: number
  comparison: 'below'
  // excluded: only the listed selling price counts. included: an "effective price after offers"
  // counts too. A saving ("₹3,000 cashback"), an MRP and an EMI instalment never count.
  offers: 'excluded' | 'included'
}

export type PriceKind = 'listed' | 'offer_price' | 'savings' | 'mrp' | 'emi'
export type ObservedPrice = { amount: number; kind: PriceKind; text: string }

// An amount far below the threshold is an accessory, an instalment or a typo, not the product.
export const IMPLAUSIBLE_FRACTION = 0.35

/** "₹24,000", "Rs. 23,500", "24000", "₹24k", "1.2 lakh", "₹1,29,900/-" → rupees, else null. */
export function parseMoneyAmount(raw: string): number | null {
  const text = String(raw || '').toLowerCase().replace(/ /g, ' ')
  const m = text.match(/(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|lakhs?|lacs?|l)?\b/)
  if (!m) return null
  let value = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = m[2]
  if (unit === 'k') value *= 1_000
  else if (unit) value *= 100_000
  return Math.round(value * 100) / 100
}

const AMOUNT_RE = /(?:₹|rs\.?|inr)\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(k|lakhs?|lacs?))?/gi

const SAVINGS_BEFORE = /(?:save|saving|savings|cashback|cash\s*back|off|discount|upto|up\s*to|extra|flat|get|instant)\s*:?\s*$/i
const SAVINGS_AFTER = /^\s*\**\s*(?:off\b|cash\s*back|discount|instant|savings?|extra\s+off)/i
const EMI_BEFORE = /(?:emi|instal+ments?)\s*(?:from|starts?|starting|@|at|of)?\s*:?\s*$/i
const EMI_AFTER = /^\s*(?:\/\s*(?:mo|month)\b|per\s+month|a\s+month|\/m\b|x\s*\d+\s*(?:months?|mo)\b|emi\b|monthly)/i
const MRP_BEFORE = /(?:m\.?\s?r\.?\s?p\.?|list\s+price|original\s+price|regular\s+price|retail\s+price|market\s+price|was|strike\s*price)\s*:?\s*$/i
// '₹34,990 MRP' labels the amount before it; '₹24,990 (MRP ₹34,990)' labels the amount AFTER the label.
const MRP_AFTER = /^\s*\(?\s*m\.?\s?r\.?\s?p\b(?!\s*:?\s*(?:₹|rs\.?|inr))/i
const OFFER_BEFORE = /(?:effective(?:\s+price)?|net(?:\s+price)?|deal\s+price|offer\s+price|after\s+(?:all\s+|bank\s+|card\s+)?(?:offers?|discounts?|cashback)|with\s+(?:all\s+|bank\s+|card\s+|exchange\s+)?(?:offers?|discounts?|cashback|exchange))\s*:?\s*$/i
const OFFER_AFTER = /^\s*(?:\(?\s*)?(?:with|after|effective|incl(?:uding)?|inclusive\s+of)\s+(?:all\s+)?(?:bank|card|offers?|cashback|exchange|coupons?|discounts?)/i

function classify(before: string, after: string): PriceKind {
  if (EMI_BEFORE.test(before) || EMI_AFTER.test(after)) return 'emi'
  if (SAVINGS_BEFORE.test(before) || SAVINGS_AFTER.test(after)) return 'savings'
  if (MRP_BEFORE.test(before) || MRP_AFTER.test(after)) return 'mrp'
  if (OFFER_BEFORE.test(before) || OFFER_AFTER.test(after)) return 'offer_price'
  return 'listed'
}

/** Every rupee amount a result states, each labelled by what it is. Needs a currency marker. */
export function extractPrices(text: string): ObservedPrice[] {
  const source = String(text || '').replace(/ /g, ' ')
  const out: ObservedPrice[] = []
  for (const m of source.matchAll(AMOUNT_RE)) {
    let amount = Number(m[1].replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount <= 0) continue
    const unit = (m[2] || '').toLowerCase()
    if (unit === 'k') amount *= 1_000
    else if (unit) amount *= 100_000
    const start = m.index ?? 0
    const before = source.slice(Math.max(0, start - 36), start)
    const after = source.slice(start + m[0].length, start + m[0].length + 36)
    out.push({ amount, kind: classify(before, after), text: m[0].trim() })
  }
  return out
}

export type PriceVerdict = {
  action: 'alert' | 'silent'
  reason: 'below_threshold' | 'not_below' | 'no_price'
  observed: number | null
  kind: PriceKind | null
}

/** Strictly below the threshold alerts; equal, above or no usable price stays silent. */
export function evaluatePriceRule(rule: PriceRule, prices: ObservedPrice[]): PriceVerdict {
  const counts: PriceKind[] = rule.offers === 'included' ? ['listed', 'offer_price'] : ['listed']
  const usable = prices.filter((p) => counts.includes(p.kind) && p.amount >= rule.threshold * IMPLAUSIBLE_FRACTION)
  if (!usable.length) return { action: 'silent', reason: 'no_price', observed: null, kind: null }
  const lowest = usable.reduce((a, b) => (b.amount < a.amount ? b : a))
  return lowest.amount < rule.threshold
    ? { action: 'alert', reason: 'below_threshold', observed: lowest.amount, kind: lowest.kind }
    : { action: 'silent', reason: 'not_below', observed: lowest.amount, kind: lowest.kind }
}

// Notification policy, explicit and deterministic (never decided by a model at run time):
// alert on the first time the price is below the threshold, then only on a new lower price, or
// again after the price has been seen back at or above the threshold (re-armed).
export type PriceAlertState = { armed: boolean; lastAlertPrice: number | null }
export const INITIAL_PRICE_STATE: PriceAlertState = { armed: true, lastAlertPrice: null }

export function decidePriceAlert(state: PriceAlertState, verdict: PriceVerdict): {
  notify: boolean
  reason: 'first_alert' | 'new_low' | 're_armed' | 'already_alerted' | 'not_below' | 'no_price'
  next: PriceAlertState
} {
  if (verdict.reason === 'no_price') return { notify: false, reason: 'no_price', next: state }
  if (verdict.action === 'silent') {
    return { notify: false, reason: 'not_below', next: { ...state, armed: true } }
  }
  const observed = verdict.observed as number
  if (state.lastAlertPrice === null) {
    return { notify: true, reason: 'first_alert', next: { armed: false, lastAlertPrice: observed } }
  }
  if (observed < state.lastAlertPrice) {
    return { notify: true, reason: 'new_low', next: { armed: false, lastAlertPrice: observed } }
  }
  if (state.armed) {
    return { notify: true, reason: 're_armed', next: { armed: false, lastAlertPrice: observed } }
  }
  return { notify: false, reason: 'already_alerted', next: state }
}

// One ledger line per check, so the definition, the executions and the notifications agree.
export type PriceRun = {
  at: string
  outcome: 'alert' | 'sent_nothing' | 'no_price_found' | 'no_relevant_result'
  observed: number | null
  kind: PriceKind | null
  reason: string
  source: string | null
}
export const PRICE_RUN_HISTORY = 40

export function appendPriceRun(runs: PriceRun[] | undefined, run: PriceRun): PriceRun[] {
  return [...(Array.isArray(runs) ? runs : []), run].slice(-PRICE_RUN_HISTORY)
}

export function summarizePriceRuns(runs: PriceRun[] | undefined) {
  const list = Array.isArray(runs) ? runs : []
  return {
    checks: list.length,
    alerts: list.filter((r) => r.outcome === 'alert').length,
    silent: list.filter((r) => r.outcome === 'sent_nothing').length,
    noPrice: list.filter((r) => r.outcome === 'no_price_found' || r.outcome === 'no_relevant_result').length,
    last: list[list.length - 1] || null,
  }
}

/** One readable line of what this price watch has actually done, from the run ledger. */
export function priceRunLine(runs: PriceRun[] | undefined, rule?: PriceRule | null): string {
  const list = Array.isArray(runs) ? runs : []
  const limit = rule ? `Alert when the price is below ${formatRupees(rule.threshold)}` : 'Price watch'
  if (!list.length) return `${limit}. No check has finished yet.`
  const summary = summarizePriceRuns(list)
  const parts = [`${summary.checks} check${summary.checks === 1 ? '' : 's'}`, `${summary.alerts} alert${summary.alerts === 1 ? '' : 's'} sent`]
  if (summary.silent) parts.push(`${summary.silent} at or above the limit`)
  if (summary.noPrice) parts.push(`${summary.noPrice} with no price found`)
  const last = summary.last
  const lastWhen = last ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(last.at)) + ' IST' : ''
  const lastWhat = !last ? '' : last.outcome === 'alert' ? `alert sent at ${formatRupees(last.observed as number)}`
    : last.outcome === 'sent_nothing' ? `${last.observed !== null ? formatRupees(last.observed) : 'price'}, not below the limit`
    : last.outcome === 'no_price_found' ? 'a result came back but with no clear price' : 'no matching result'
  return `${limit}. ${parts.join(', ')}.${last ? ` Last check ${lastWhen}: ${lastWhat}.` : ''}`
}

export function normalizePriceRule(input: any): PriceRule | null {
  const threshold = Number(input?.threshold)
  if (!Number.isFinite(threshold) || threshold <= 0) return null
  return { threshold, comparison: 'below', offers: input?.offers === 'included' ? 'included' : 'excluded' }
}

export function formatRupees(amount: number): string {
  return '₹' + Math.round(amount).toLocaleString('en-IN')
}

// ---- one check of a price watch --------------------------------------------------------------
// `results` are the search results that already passed the relevance gate. The watcher sends the
// alerting one (the lowest qualifying price) and records the ledger line this returns.
export type PriceCheck = {
  pick: number | null
  verdict: PriceVerdict | null
  decision: ReturnType<typeof decidePriceAlert> | null
}

export function assessPriceCheck(
  rule: PriceRule,
  state: PriceAlertState,
  results: Array<{ title: string; snippet?: string }>,
): PriceCheck {
  const scored = results
    .map((result, index) => ({
      index,
      verdict: evaluatePriceRule(rule, extractPrices(`${result.title}. ${result.snippet || ''}`)),
    }))
    .filter((x) => x.verdict.observed !== null)
  if (!scored.length) {
    return { pick: null, verdict: results.length ? { action: 'silent', reason: 'no_price', observed: null, kind: null } : null, decision: null }
  }
  const lowest = scored.reduce((a, b) => ((b.verdict.observed as number) < (a.verdict.observed as number) ? b : a))
  const decision = decidePriceAlert(state, lowest.verdict)
  return { pick: decision.notify ? lowest.index : null, verdict: lowest.verdict, decision }
}

export function priceStateFrom(lastState: any): PriceAlertState {
  const last = lastState?.lastAlertPrice
  const number = last === null || last === undefined || last === '' ? NaN : Number(last)
  return { armed: lastState?.priceArmed !== false, lastAlertPrice: Number.isFinite(number) ? number : null }
}

export function buildPriceRun(params: {
  now: Date
  eligibleCount: number
  check: PriceCheck
  sent: boolean
  gateReason?: string | null
  source?: string | null
}): PriceRun {
  const { check } = params
  const base = { at: params.now.toISOString(), observed: check.verdict?.observed ?? null, kind: check.verdict?.kind ?? null, source: params.source ?? null }
  if (params.sent) return { ...base, outcome: 'alert', reason: check.decision?.reason || 'alert' }
  if (!params.eligibleCount) return { ...base, outcome: 'no_relevant_result', reason: 'no_relevant_result' }
  if (check.verdict?.reason === 'no_price') return { ...base, outcome: 'no_price_found', reason: 'no_price' }
  return { ...base, outcome: 'sent_nothing', reason: params.gateReason || check.decision?.reason || 'not_below' }
}

export function priceAlertText(params: {
  title: string
  url: string
  host: string
  observed: number
  rule: PriceRule
  at: Date
}): string {
  const when = params.at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
  return (
    `${params.title}\n\n` +
    `Listed price ${formatRupees(params.observed)} is below your ${formatRupees(params.rule.threshold)} ` +
    `(${params.rule.offers === 'included' ? 'offers counted' : 'bank, card and exchange offers not counted'}). ` +
    `Seen in a search result on ${params.host} at ${when} IST. ` +
    `That is the price in the search result, not confirmed on the store page, so check it there. I never buy for you.\n\n` +
    `${params.url}\n\n` +
    `I'll keep checking and only message you again on a new lower price, or after it has gone back up and dropped again.`
  )
}
