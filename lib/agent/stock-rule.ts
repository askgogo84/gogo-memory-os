// Share-price watch rules (26 Oct, owner): "Tata Motors share price watch" became a generic news watch and sent news
// links. A share-price watch reads one live exchange quote and alerts only when the price moves by the person's
// percentage from the starting price, or crosses a level they gave. Pure functions; no network here.

export type StockRule = {
  symbol: string            // provider symbol, e.g. "TMPV.NS"
  name: string              // company name as listed
  exchange: 'NSE' | 'BSE'
  kind: 'move' | 'level'
  direction: 'any' | 'up' | 'down' | 'above' | 'below'
  pct: number | null        // for kind=move
  level: number | null      // for kind=level, INR
  baseline: number | null   // price when the watch started (or last alert, for moves)
  baselineAt: string | null
  startArmed?: boolean      // false when a level was already past at creation: alert only after it comes back and crosses
}

export type ParsedStockWatch = {
  company: string
  kind: 'move' | 'level'
  direction: StockRule['direction']
  pct: number | null
  level: number | null
  defaulted: boolean        // no threshold given: default 5% either way
}

export const DEFAULT_MOVE_PCT = 5

const STOCK_WORDS = /\b(?:share\s*price|stock\s*price|share|shares|stock|stocks|scrip)\b/i
const WATCH_WORDS = /\b(?:watch|track|monitor|alert|notify|tell\s+me|let\s+me\s+know|ping\s+me|keep\s+(?:an\s+)?eye)\b/i

const MOVE_WORDS = '(?:drops?|falls?|dips?|declines?|rises?|jumps?|gains?|climbs?|crosses|goes|moves?|is\\s+(?:up|down)|hits?|touches)'

/** True for a share-price watch request; leaves product stock ("in stock"), gold, reminders and "X shares the doc" alone. */
export function isStockWatchPhrasing(text: string) {
  const t = String(text || '').replace(/[’']/g, "'")
  if (!STOCK_WORDS.test(t) || !WATCH_WORDS.test(t)) return false
  if (/^\s*(?:please\s+|pls\s+)?remind\b/i.test(t)) return false
  if (/\b(?:in\s+stock|out\s+of\s+stock|back\s+in\s+stock|restock|stock\s+up|gold|silver)\b/i.test(t)) return false
  // "Divya shares the doc", "my shares are worth": a verb or a portfolio question, not a quote watch.
  if (/\bshares\s+(?:the|a|an|my|his|her|their|this|that|it|with)\b/i.test(t) || /\b(?:my|our)\s+(?:shares|stocks|portfolio|holdings)\b/i.test(t)) return false
  if (new RegExp(`\\b(?:share\\s*price|stock\\s*price|share\\s+of|(?:share|shares|stock)\\s+${MOVE_WORDS}|nse|bse|scrip)\\b`, 'i').test(t)) return true
  // Bare "shares" ("Nithin shares updates") is a quote watch only with a price, %, level or move alongside it.
  return /\bshares\b/i.test(t) && /(?:%|₹\s*\d|\brs\.?\s*\d|\b(?:percent|price|below|above|under|over|drops?|falls?|rises?|moves?|crosses|jumps?|dips?)\b)/i.test(t)
}

function cleanCompany(raw: string) {
  return raw
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b(?:please|pls|can\s+you|could\s+you|for\s+me|the|my|of|for|on|in|nse|bse|ltd|limited|price|prices|today|now|daily)\b/gi, ' ')
    .replace(/[^a-z0-9&.\- ]/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}

export function parseStockWatchCommand(text: string): ParsedStockWatch | null {
  // "Tata Motors' share price": drop possessive apostrophes so the company name stays whole.
  const raw = String(text || '').replace(/[’]/g, "'").replace(/'s\b/g, '').replace(/(\w)'(?=\s)/g, '$1').trim()
  if (!isStockWatchPhrasing(raw)) return null
  // Company: the words right before "share/stock (price)", else right after the watch verb.
  let company = ''
  const before = raw.match(/([A-Za-z0-9&.\- ]{2,60}?)\s*(?:'s\s+)?(?:share\s*price|stock\s*price|shares?|stock)\b/i)
  // Everything up to the last command/filler word ("alert me if", "keep an eye on") is not the company.
  if (before) company = cleanCompany(before[1].replace(/^.*\b(?:watch|track|monitor|alert|notify|tell\s+me|let\s+me\s+know|ping\s+me|keep\s+(?:an\s+)?eye\s+on|me|if|when|whenever|about|on)\b\s*/i, ''))
  if (!company) {
    const after = raw.match(new RegExp(`${WATCH_WORDS.source}\\s+(?:me\\s+)?(?:on\\s+|about\\s+)?([A-Za-z0-9&.\\- ]{2,60})`, 'i'))
    if (after) company = cleanCompany(after[1].replace(STOCK_WORDS, ' '))
  }
  company = company.replace(new RegExp(WATCH_WORDS.source, 'gi'), ' ').replace(/\b(?:if|when|it|by|drops?|falls?|rises?|goes|moves?|up|down)\b.*$/i, '').replace(/\s+/g, ' ').trim()
  if (!company || company.length < 2) return null
  if (/^(?:how|what|which|when|why|it|this|that|they|we|i|you|she|he|him|her|them|someone|somebody|everyone)\b/i.test(company)) return null

  const levelMatch = raw.match(/\b(below|under|less\s+than|falls?\s+(?:below|under)|drops?\s+(?:below|under)|above|over|more\s+than|crosses|goes\s+above|rises?\s+above)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)(?!\s*%)/i)
  if (levelMatch) {
    const level = Number(levelMatch[2].replace(/,/g, ''))
    if (Number.isFinite(level) && level > 0) {
      const below = /below|under|less/i.test(levelMatch[1])
      return { company, kind: 'level', direction: below ? 'below' : 'above', pct: null, level, defaulted: false }
    }
  }
  const pctMatch = raw.match(/(\d{1,2}(?:\.\d+)?)\s*(?:%|percent|per\s*cent)/i)
  const pct = pctMatch ? Number(pctMatch[1]) : null
  const down = /\b(?:drops?|falls?|down|dips?|declines?|crash(?:es)?|lower)\b/i.test(raw)
  const up = /\b(?:rises?|up|jumps?|gains?|climbs?|higher|surges?)\b/i.test(raw)
  const either = /\b(?:either|both|any\s+direction|up\s+or\s+down|down\s+or\s+up|moves?|changes?)\b/i.test(raw) || (down && up)
  const direction: StockRule['direction'] = either || (!down && !up) ? 'any' : down ? 'down' : 'up'
  if (pct !== null && (!(pct > 0) || pct > 50)) return null
  return { company, kind: 'move', direction, pct: pct ?? DEFAULT_MOVE_PCT, level: null, defaulted: pct === null }
}

export function normalizeStockRule(input: any): StockRule | null {
  if (!input || typeof input !== 'object') return null
  const symbol = String(input.symbol || '').trim().toUpperCase()
  if (!/^[A-Z0-9&.\-]{1,24}\.(?:NS|BO)$/.test(symbol)) return null
  const kind = input.kind === 'level' ? 'level' : input.kind === 'move' ? 'move' : null
  if (!kind) return null
  const direction = ['any', 'up', 'down', 'above', 'below'].includes(input.direction) ? input.direction : null
  if (!direction) return null
  const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : NaN)
  const pct = num(input.pct), level = num(input.level), baseline = num(input.baseline)
  if ([pct, level, baseline].some(v => Number.isNaN(v))) return null
  if (kind === 'move' && (pct === null || pct > 50 || !['any', 'up', 'down'].includes(direction))) return null
  if (kind === 'level' && (level === null || !['above', 'below'].includes(direction))) return null
  return {
    symbol, name: String(input.name || symbol).slice(0, 120), exchange: symbol.endsWith('.BO') ? 'BSE' : 'NSE',
    kind, direction, pct: kind === 'move' ? pct : null, level: kind === 'level' ? level : null,
    baseline: baseline ?? null, baselineAt: input.baselineAt ? String(input.baselineAt) : null,
    ...(input.startArmed === false ? { startArmed: false } : {}),
  }
}

/** NSE trading window (IST, Mon–Fri, with a small margin). Outside it a quote cannot move, so checks are slower. */
export function nseMarketOpen(now: Date) {
  const ist = new Date(now.getTime() + 330 * 60_000)
  const day = ist.getUTCDay(), mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return day >= 1 && day <= 5 && mins >= 9 * 60 && mins <= 15 * 60 + 45
}

/** The next NSE opening (09:15 IST, Mon–Fri) after now. */
export function nextNseOpen(now: Date) {
  const ist = new Date(now.getTime() + 330 * 60_000)
  for (let d = 0; d < 8; d++) {
    const day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + d, 9, 15))
    const wd = day.getUTCDay()
    const utc = new Date(day.getTime() - 330 * 60_000)
    if (wd >= 1 && wd <= 5 && utc.getTime() > now.getTime()) return utc
  }
  return new Date(now.getTime() + 24 * 3600_000)
}

export const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function stockRuleSummary(rule: StockRule) {
  if (rule.kind === 'level') return `${rule.name} goes ${rule.direction === 'below' ? 'below' : 'above'} ${inr(rule.level!)}`
  const dir = rule.direction === 'down' ? 'falls' : rule.direction === 'up' ? 'rises' : 'moves'
  return `${rule.name} ${dir} ${rule.pct}%${rule.direction === 'any' ? ' either way' : ''}${rule.baseline ? ` from ${inr(rule.baseline)}` : ''}`
}

export type StockState = { armed: boolean; baseline: number | null; alertCount: number }

export function stockStateFrom(raw: any, rule: StockRule): StockState {
  return {
    armed: typeof raw?.stockArmed === 'boolean' ? raw.stockArmed : rule.startArmed !== false,
    baseline: Number(raw?.stockBaseline) > 0 ? Number(raw.stockBaseline) : rule.baseline,
    alertCount: Number.isInteger(raw?.stockAlertCount) && raw.stockAlertCount >= 0 ? raw.stockAlertCount : 0,
  }
}

export type StockVerdict = { notify: boolean; reason: string; changePct: number | null; next: StockState }

/**
 * Moves: alert when the change from the baseline reaches the percentage in the asked direction; the alert price
 * becomes the new baseline, so each further move of that size alerts once. Levels: alert once when crossed;
 * re-arm only after the price is back on the other side.
 */
export function evaluateStockRule(rule: StockRule, price: number, state: StockState): StockVerdict {
  if (!(price > 0)) return { notify: false, reason: 'no_price', changePct: null, next: state }
  if (rule.kind === 'level') {
    const past = rule.direction === 'below' ? price < rule.level! : price > rule.level!
    if (past && state.armed) return { notify: true, reason: 'crossed', changePct: null, next: { ...state, armed: false } }
    if (!past && !state.armed) return { notify: false, reason: 'rearmed', changePct: null, next: { ...state, armed: true } }
    return { notify: false, reason: past ? 'still_past' : 'not_crossed', changePct: null, next: state }
  }
  if (!state.baseline) return { notify: false, reason: 'baseline_set', changePct: 0, next: { ...state, baseline: price } }
  const changePct = ((price - state.baseline) / state.baseline) * 100
  const hit = rule.direction === 'down' ? changePct <= -rule.pct! : rule.direction === 'up' ? changePct >= rule.pct! : Math.abs(changePct) >= rule.pct!
  if (hit) return { notify: true, reason: 'moved', changePct, next: { ...state, baseline: price } }
  return { notify: false, reason: 'within_range', changePct, next: state }
}

export function stockAlertText(rule: StockRule, price: number, verdict: StockVerdict, asOf: string, previousBaseline: number | null) {
  const head = `📈 ${rule.name} (${rule.symbol.replace(/\.(NS|BO)$/, '')}, ${rule.exchange}) is now ${inr(price)}`
  const why = rule.kind === 'level'
    ? `It has gone ${rule.direction === 'below' ? 'below' : 'above'} your level of ${inr(rule.level!)}.`
    : `That is ${verdict.changePct! >= 0 ? 'up' : 'down'} ${Math.abs(verdict.changePct!).toFixed(1)}% from ${inr(previousBaseline || 0)}, past your ${rule.pct}% alert.`
  const next = rule.kind === 'move' ? ` I'll alert again if it moves another ${rule.pct}% from ${inr(price)}.` : ''
  return `${head} (as of ${asOf}).\n${why}${next}\n\nPrice from Yahoo Finance's market feed (can lag the exchange by a few minutes); I never buy or sell. Say "stop watching ${rule.name}" to stop.`
}
