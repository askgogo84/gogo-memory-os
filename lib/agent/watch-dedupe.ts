// R02 (22 Oct live): the owner had three near-duplicate gold watches ("gold rate", "Gold price below ₹X/g",
// "watch gold") and a 27 Sep flight-status watch still active on 22 Oct. Pure helpers that decide
// (a) whether a new watch is the same subject as an active one, so creation updates it instead of inserting,
// (b) which active watches have outlived their own date, and (c) how existing duplicates collapse
// (keep the most specific, then newest; retire the rest with a reason). No I/O here: callers do owner-scoped writes.
import { watchEnds } from './owner-confirmation'
import { canonicalWatcherUrl } from './watcher-quality'

export type DedupeRow = {
  id: string
  telegram_id?: string | number | null
  type?: string | null
  title?: string | null
  created_at?: string | null
  condition_json?: any
  last_state_json?: any
}

export type WatchSubject = { key: string; karat: string | null }
export type WatchRetirement = { id: string; telegramId: string; reason: 'date_passed' | 'duplicate'; label: string; keptId?: string }

/** Only the user-created background watch types collapse; deadline/goal/inbox watches have their own lifecycles. */
export const DEDUPE_WATCH_TYPES = ['web_search', 'web_page', 'product_stock'] as const

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const textOf = (row: Pick<DedupeRow, 'title' | 'condition_json'>) => {
  const c = row.condition_json || {}
  return [row.title, c.title, c.query, c.originalRequest].map(clean).filter(Boolean).join(' ')
}

const GOLD_NOT_PRICE = /\b(loan|loans|etf|etfs|fund|funds|bond|bonds|sgb|card|cards|membership|medal|medals|coast|silver|platinum|scheme|savings plan|chit)\b/i
const PRICE_WORDS = /\b(rate|rates|price|prices|cost|per\s*gram|gram|\/\s*g|karat|carat|\d{2}\s*k(?:t|arat)?|today|drop|drops|falls?|below|under|above)\b|₹|\/g\b/i

/** Gold-price watches: a stored gold rule, or a plain web query that is clearly about the gold rate. */
export function isGoldPriceWatch(row: Pick<DedupeRow, 'title' | 'condition_json'>): boolean {
  const c = row.condition_json || {}
  if (c.goldRule && String(c.goldRule.metal || 'gold') === 'gold') return true
  const q = clean(c.query || c.title || row.title).toLowerCase()
  if (!/\bgold\b/.test(q) || GOLD_NOT_PRICE.test(q)) return false
  const words = q.replace(/[^a-z0-9₹/ ]/g, ' ').split(/\s+/).filter(Boolean)
  return PRICE_WORDS.test(q) || words.length <= 3
}

export function goldKaratOf(row: Pick<DedupeRow, 'title' | 'condition_json'>): string | null {
  const c = row.condition_json || {}
  if (c.goldRule?.karat) return String(c.goldRule.karat)
  const m = clean([c.query, c.title, row.title].join(' ')).match(/\b(24|22|18)\s*(?:k|kt|karat|carat|ct)\b/i)
  return m ? m[1] : null
}

// A flight number followed or preceded by flight context. "AT 9 flight status" is real (Royal Air Maroc), so a
// two-letter code that is also an English word only counts when "flight" sits right next to it.
const WORD_CODES = new Set(['AT', 'AM', 'PM', 'ON', 'TO', 'IN', 'BY', 'OF', 'OR', 'AN', 'AS', 'IF', 'IS', 'IT', 'ME', 'MY', 'WE', 'US', 'GO', 'DO', 'NO', 'SO', 'UP'])
export function flightSubjectOf(text: string): string | null {
  const t = clean(text)
  if (!/\b(flight|flights|pnr|boarding|departure|arrival|gate)\b/i.test(t)) return null
  const re = /\b([A-Z][A-Z0-9]|[0-9][A-Z])\s?-?\s?(\d{1,4})\b(\s+flight)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const code = m[1].toUpperCase()
    const before = t.slice(Math.max(0, m.index - 8), m.index)
    if (WORD_CODES.has(code) && !m[3] && !/flight\s*$/i.test(before)) continue
    if (!/[A-Z]/.test(code)) continue
    return `${code}${m[2]}`.toLowerCase()
  }
  return null
}

function isoDay(d: Date) { return d.toISOString().slice(0, 10) }

const MONTH_WORD = 'jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec'
function dateTokenOf(text: string): string | null {
  const t = clean(text).toLowerCase()
  const iso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (iso) return iso[1]
  const m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_WORD})[a-z]*`)) || t.match(new RegExp(`\\b(${MONTH_WORD})[a-z]*\\.?\\s+(\\d{1,2})\\b`))
  if (!m) return null
  const [day, mon] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]]
  return `${mon.slice(0, 3)}-${day.padStart(2, '0')}`
}

/** "watch gold rate below ₹7,000" and "gold rate under 6500" share a subject; product names and numbers that are
 *  not money survive (iPhone 15 ≠ iPhone 16). */
export function normalizeSubjectQuery(raw: string): string {
  return clean(raw).toLowerCase()
    .replace(/(?:₹|rs\.?|inr)\s*[\d,.]+\s*(?:k|lakh|lakhs|l|cr)?(?:\s*\/\s*g(?:ram)?)?/g, ' ')
    .replace(/\b(?:below|under|less than|lower than|above|over|more than|drops? (?:to|below)?|falls? (?:to|below)?)\s*[\d,.]+\s*(?:k|lakh|lakhs)?\b/g, ' ')
    .replace(/\b(?:please|watch|track|monitor|keep an eye on|alert me|notify me|tell me|let me know|about|when|if|whenever|the|a|an|for|me|on|of|price|prices|rate|rates|cost|today|todays|current|latest|below|under|drops?|falls?)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

/** The subject a watch is about, or null when it is not a dedupe candidate (contextual travel watches are
 *  compiled and retired by their own context key). */
export function watchSubject(row: DedupeRow): WatchSubject | null {
  const c = row.condition_json || {}
  if (c.contextual === true) return null
  const type = String(row.type || '')
  if (type === 'product_stock') {
    if (!c.productUrl) return null
    return { key: `product:${canonicalWatcherUrl(String(c.productUrl))}#${clean(c.variant).toLowerCase()}`, karat: null }
  }
  if (type === 'web_page') {
    if (!c.url) return null
    return { key: `page:${canonicalWatcherUrl(String(c.url))}#${String(c.watch || 'title')}`, karat: null }
  }
  if (type !== 'web_search') return null
  if (isGoldPriceWatch(row)) return { key: 'gold:price', karat: goldKaratOf(row) }
  const text = textOf(row)
  const flight = flightSubjectOf(text)
  if (flight) return { key: `flight:${flight}:${dateTokenOf(text) || 'undated'}`, karat: null }
  const q = normalizeSubjectQuery(String(c.query || c.title || row.title || ''))
  return q ? { key: `query:${q}`, karat: null } : null
}

export function sameWatchSubject(a: DedupeRow, b: DedupeRow): boolean {
  if (String(a.type || '') !== String(b.type || '')) return false
  const sa = watchSubject(a), sb = watchSubject(b)
  if (!sa || !sb || sa.key !== sb.key) return false
  // 22K and 24K are different watches; a watch that never named a karat matches either.
  return !sa.karat || !sb.karat || sa.karat === sb.karat
}

/** Higher is more specific: a numeric rule beats a named karat beats a bare query. */
export function watchSpecificity(row: DedupeRow): number {
  const c = row.condition_json || {}
  if (c.goldRule || c.priceRule) return 2
  if (goldKaratOf(row)) return 1
  return 0
}

function newerFirst(a: DedupeRow, b: DedupeRow) {
  const ta = Date.parse(String(a.created_at || '')) || 0, tb = Date.parse(String(b.created_at || '')) || 0
  return tb - ta || String(b.id).localeCompare(String(a.id))
}
function keeperOrder(a: DedupeRow, b: DedupeRow) {
  return watchSpecificity(b) - watchSpecificity(a) || newerFirst(a, b)
}

/** A watch tied to its own date (an explicit expiry, or a dated non-price search such as a flight on 27 Sep)
 *  whose date is over. Gold/price thresholds are evergreen: a date in their wording is the baseline, not the end. */
export function watchDatePassed(row: DedupeRow, now: Date = new Date()): { passed: boolean; label: string } {
  const c = row.condition_json || {}
  if (c.contextual === true) return { passed: false, label: '' }
  const hasExpiry = Number.isFinite(Date.parse(String(c.expiresAt || c.expires_at || '')))
  const datedSearch = String(row.type || '') === 'web_search' && !c.goldRule && !c.priceRule && !isGoldPriceWatch(row)
  if (!hasExpiry && !datedSearch) return { passed: false, label: '' }
  const ends = watchEnds({ title: row.title, type: row.type, created_at: row.created_at, condition_json: c }, now)
  return { passed: ends.datePassed, label: ends.datePassed ? ends.label : '' }
}

/** Active rows for one owner that are the same subject as the candidate, keeper first. */
export function matchingActiveWatches(rows: DedupeRow[], candidate: Omit<DedupeRow, 'id'> & { id?: string }, now: Date = new Date()): DedupeRow[] {
  const probe = { id: candidate.id || '__candidate__', ...candidate } as DedupeRow
  return (rows || [])
    .filter(row => row && row.id !== probe.id && !watchDatePassed(row, now).passed && sameWatchSubject(row, probe))
    .sort(keeperOrder)
}

/** Idempotent cleanup plan for any batch of active rows (any number of owners): retire watches whose own date
 *  passed, then collapse each owner's same-subject groups to one keeper. Running it twice yields nothing new. */
export function planWatchCleanup(rows: DedupeRow[], now: Date = new Date()): WatchRetirement[] {
  const out: WatchRetirement[] = []
  const live: DedupeRow[] = []
  for (const row of rows || []) {
    if (!row?.id || !DEDUPE_WATCH_TYPES.includes(String(row.type) as any)) continue
    const tg = String(row.telegram_id ?? '')
    if (!tg) continue
    const date = watchDatePassed(row, now)
    if (date.passed) out.push({ id: row.id, telegramId: tg, reason: 'date_passed', label: date.label })
    else live.push(row)
  }
  // Group by owner + type + subject key; gold rows without a karat join their owner's single karat group.
  const groups = new Map<string, DedupeRow[]>()
  const loose: Array<{ base: string; row: DedupeRow }> = []
  for (const row of live) {
    const s = watchSubject(row)
    if (!s) continue
    const base = `${row.telegram_id}|${row.type}|${s.key}`
    if (s.key === 'gold:price' && !s.karat) { loose.push({ base, row }); continue }
    const k = `${base}|${s.karat || ''}`
    groups.set(k, [...(groups.get(k) || []), row])
  }
  for (const { base, row } of loose) {
    const karatGroups = Array.from(groups.keys()).filter(k => k.startsWith(`${base}|`))
    // Several karats: join the group holding the newest watch, so the merge is deterministic.
    const target = karatGroups.length === 0 ? `${base}|`
      : karatGroups.length === 1 ? karatGroups[0]
        : karatGroups.map(k => ({ k, top: [...(groups.get(k) || [])].sort(newerFirst)[0] })).sort((a, b) => newerFirst(a.top, b.top))[0].k
    groups.set(target, [...(groups.get(target) || []), row])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const [keeper, ...rest] = [...group].sort(keeperOrder)
    for (const row of rest) {
      out.push({ id: row.id, telegramId: String(row.telegram_id), reason: 'duplicate', keptId: keeper.id, label: `Same as watch ${keeper.id}` })
    }
  }
  return out
}

export function reusedWatchText(updated: boolean, label: string): string {
  const what = clean(label).slice(0, 120) || 'this'
  return updated
    ? `You already have this watch — I updated it (${what}) instead of adding a duplicate.`
    : `You already have this watch (${what}), so I kept it instead of adding a duplicate.`
}
