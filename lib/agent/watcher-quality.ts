import { createHash } from 'node:crypto'

export const WEB_WATCH_MIN_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000
export const WEB_WATCH_MAX_ALERTS_24H = 2
export const WEB_WATCH_MAX_HISTORY = 40
// Event-key dedup re-arms after this window so a genuinely NEW disruption of the same
// kind (a later storm, a delay on a different date) can alert again, while the same
// event re-retrieved over the following days stays suppressed.
export const EVENT_KEY_REARM_MS = 10 * 24 * 60 * 60 * 1000

// Airline/flight codes as they appear in search snippets ("EY 1", "EY239", "6E 203").
// Used to scope an event key to the specific flight the RESULT is about, so a delay on
// one leg does not suppress a delay on a different leg of the same trip watcher.
export function extractFlightCodes(text: string): string[] {
  const out = new Set<string>()
  const re = /\b([a-z]{2}|[a-z]\d|\d[a-z])\s?(\d{1,4})\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(String(text || '')))) out.add(`${m[1]}${m[2]}`.toLowerCase())
  return Array.from(out).sort()
}

// Dedup history entries are stored "value|ms". Only a trailing |<digits> is treated as
// a timestamp, so values that themselves contain "|" (e.g. a URL query) are preserved.
function parseStamped(entry: string): { value: string; ms: number } {
  const m = String(entry || '').match(/^(.*)\|(\d{6,})$/)
  return m ? { value: m[1], ms: Number(m[2]) } : { value: String(entry || ''), ms: NaN }
}

// Return the still-armed bare values (undated legacy entries stay armed for back-compat).
export function activeStamped(entries: string[] | undefined, now: Date): string[] {
  const cutoff = now.getTime() - EVENT_KEY_REARM_MS
  const set = new Set<string>()
  for (const entry of entries || []) {
    const { value, ms } = parseStamped(entry)
    if (!value) continue
    if (!Number.isFinite(ms) || ms >= cutoff) set.add(value)
  }
  return Array.from(set)
}

// Merge freshly-seen values into stamped history: keep the earliest timestamp per value,
// stamp legacy/new values with `now`, drop values past the re-arm window, and bound size.
// This gives seenUrls / seenSignatures the same time-expiry as event keys, so a recurring
// event reported at a stable URL can alert again after the window instead of forever.
export function mergeStamped(prior: string[] | undefined, values: string[], now: Date): string[] {
  const cutoff = now.getTime() - EVENT_KEY_REARM_MS
  const map = new Map<string, number>()
  for (const entry of prior || []) {
    const { value, ms } = parseStamped(entry)
    if (!value) continue
    const t = Number.isFinite(ms) ? ms : now.getTime() // legacy bare → stamp now (self-heals within a window)
    if (t >= cutoff) map.set(value, Math.min(map.get(value) ?? t, t))
  }
  for (const raw of values) {
    const value = String(raw || '')
    if (value && !map.has(value)) map.set(value, now.getTime())
  }
  return Array.from(map.entries()).map(([value, ms]) => `${value}|${ms}`).slice(-WEB_WATCH_MAX_HISTORY)
}

// seenEventKeys entries are stored "key|ms". Return the still-armed bare keys.
export function activeEventKeys(entries: string[] | undefined, now: Date): string[] {
  return activeStamped(entries, now)
}

// Record a freshly-alerted event key with a fresh timestamp, pruning expired entries.
export function recordEventKey(entries: string[] | undefined, key: string, now: Date): string[] {
  if (!key) return entries || []
  const cutoff = now.getTime() - EVENT_KEY_REARM_MS
  const kept = (entries || []).filter(entry => {
    const { value, ms } = parseStamped(entry)
    return value !== key && (!Number.isFinite(ms) || ms >= cutoff)
  })
  return [...kept, `${key}|${now.getTime()}`].slice(-WEB_WATCH_MAX_HISTORY)
}

export type WebWatchQualityResult = {
  eligible: boolean
  reason: 'eligible' | 'duplicate_url' | 'duplicate_topic' | 'duplicate_event' | 'low_relevance' | 'keyword_miss'
  canonicalUrl: string
  signature: string
  relevance: number
  matchedKeywords: string[]
  eventKey: string
}

// A disruption is the same EVENT regardless of which synonym the search snippet used
// ("delay" vs "delayed") or how the snippet was reworded between polls. Collapse
// synonyms to a canonical stem so the SAME disruption cannot re-alert as a new match
// (the production incident emitted "delay" then "delay, delayed" for one EY 1 delay).
const KEYWORD_STEMS: Array<[RegExp, string]> = [
  [/^delay(ed|s|ing)?$/, 'delay'],
  [/^cancel(led|ed|s|lation|lations|ling)?$/, 'cancel'],
  [/^divert(ed|s|ing|ed)?$|^diversion$/, 'divert'],
  [/^reschedul(e|ed|es|ing)$/, 'reschedule'],
  [/^storm(s|ing|y)?$|^thunderstorms?$/, 'storm'],
  [/^snow(storm|ing|s)?$|^blizzards?$/, 'snow'],
  [/^flood(s|ing|ed)?$/, 'flood'],
  [/^strike[sd]?$|^striking$/, 'strike'],
  [/^gate\s*change[sd]?$/, 'gate change'],
]
function stemKeyword(keyword: string): string {
  const k = String(keyword || '').toLowerCase().trim()
  for (const [re, stem] of KEYWORD_STEMS) if (re.test(k)) return stem
  return k
}
/**
 * Canonical identity of the disruption being alerted: the set of matched trigger
 * keywords collapsed to synonym stems, optionally scoped to a specific occurrence
 * (e.g. a flight number + date). Superset keyword sets ({delay} ⊂ {delay,delayed})
 * map to the SAME key so repeated retrieval of one event cannot duplicate.
 */
export function watcherEventKey(matchedKeywords: string[], occurrence = ''): string {
  const stems = Array.from(new Set((matchedKeywords || []).map(stemKeyword).filter(Boolean))).sort()
  if (!stems.length) return ''
  const base = `${String(occurrence || '').toLowerCase().trim()}::${stems.join(',')}`
  return createHash('sha256').update(base).digest('hex').slice(0, 24)
}

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','in','is','it','of','on','or','the','to','with',
  'watch','monitor','online','web','new','latest','update','updates','news','tell','notify','when','something',
  'personal','agent','agents','ai','business','availability','available','program','application','applications',
])

function words(value: string) {
  return Array.from(new Set(String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map(x => x.trim())
    .filter(x => x.length >= 2 && !STOP_WORDS.has(x))))
}

export function canonicalWatcherUrl(value: string) {
  try {
    const url = new URL(String(value || '').trim())
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|gclid$|fbclid$|ref$|ref_|source$|campaign$)/i.test(key)) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    const qs = url.searchParams.toString()
    return `${url.protocol}//${url.hostname}${url.pathname}${qs ? `?${qs}` : ''}`.toLowerCase()
  } catch {
    return String(value || '').trim().toLowerCase()
  }
}

export function watcherResultSignature(title: string, snippet = '') {
  const stable = words(`${title} ${snippet}`).slice(0, 14).sort().join('|')
  return createHash('sha256').update(stable || `${title} ${snippet}`.toLowerCase().trim()).digest('hex').slice(0, 24)
}

function intentTokens(query: string) {
  const all = words(query)
  const anchors = all.filter(token => token.length >= 6)
  return { all, anchors }
}

export function assessWebWatchResult(params: {
  query: string
  title: string
  snippet?: string
  url: string
  triggerKeywords?: string[]
  seenUrls?: string[]
  seenSignatures?: string[]
  seenEventKeys?: string[]
  occurrence?: string
}): WebWatchQualityResult {
  const canonicalUrl = canonicalWatcherUrl(params.url)
  const signature = watcherResultSignature(params.title, params.snippet || '')
  const seenUrls = new Set((params.seenUrls || []).map(canonicalWatcherUrl))
  const seenSignatures = new Set(params.seenSignatures || [])
  const seenEventKeys = new Set((params.seenEventKeys || []).filter(Boolean))

  if (seenUrls.has(canonicalUrl)) return { eligible:false, reason:'duplicate_url', canonicalUrl, signature, relevance:0, matchedKeywords:[], eventKey:'' }
  if (seenSignatures.has(signature)) return { eligible:false, reason:'duplicate_topic', canonicalUrl, signature, relevance:0, matchedKeywords:[], eventKey:'' }

  const resultTokens = new Set(words(`${params.title} ${params.snippet || ''}`))
  const { all: queryTokens, anchors } = intentTokens(params.query)
  const matched = queryTokens.filter(token => resultTokens.has(token))
  const relevance = queryTokens.length ? matched.length / queryTokens.length : 0
  const anchorHit = anchors.length === 0 || anchors.some(token => resultTokens.has(token))

  // Search providers frequently rotate generic listicles into the top results. Treat those as noise.
  // A useful update must cover most of the watch intent and, when present, retain a distinctive query anchor.
  if (!anchorHit || (queryTokens.length >= 3 ? relevance < 0.72 : relevance < 0.5)) {
    return { eligible:false, reason:'low_relevance', canonicalUrl, signature, relevance, matchedKeywords:[], eventKey:'' }
  }

  const triggerKeywords = Array.from(new Set((params.triggerKeywords || []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean)))
  const haystack = `${params.title} ${params.snippet || ''} ${params.url}`.toLowerCase()
  const matchedKeywords = triggerKeywords.filter(keyword => haystack.includes(keyword))
  if (triggerKeywords.length && matchedKeywords.length === 0) {
    return { eligible:false, reason:'keyword_miss', canonicalUrl, signature, relevance, matchedKeywords, eventKey:'' }
  }

  // Same disruption, re-retrieved with a reworded snippet or a superset of synonyms,
  // must not alert twice. This is the semantic backstop the URL/signature keys miss.
  const eventKey = watcherEventKey(matchedKeywords, params.occurrence)
  if (eventKey && seenEventKeys.has(eventKey)) {
    return { eligible:false, reason:'duplicate_event', canonicalUrl, signature, relevance, matchedKeywords, eventKey }
  }

  return { eligible:true, reason:'eligible', canonicalUrl, signature, relevance, matchedKeywords, eventKey }
}

export function webWatchAlertAllowed(params: {
  now: Date
  lastAlertAt?: string | null
  alertTimes?: string[]
}) {
  const nowMs = params.now.getTime()
  const lastMs = params.lastAlertAt ? new Date(params.lastAlertAt).getTime() : 0
  if (Number.isFinite(lastMs) && lastMs > 0 && nowMs - lastMs < WEB_WATCH_MIN_ALERT_INTERVAL_MS) {
    return { allowed:false, reason:'cooldown' as const, recentAlertTimes:pruneAlertTimes(params.alertTimes, params.now) }
  }
  const recentAlertTimes = pruneAlertTimes(params.alertTimes, params.now)
  if (recentAlertTimes.length >= WEB_WATCH_MAX_ALERTS_24H) {
    return { allowed:false, reason:'daily_cap' as const, recentAlertTimes }
  }
  return { allowed:true, reason:'ok' as const, recentAlertTimes }
}

export function pruneAlertTimes(alertTimes: string[] | undefined, now: Date) {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000
  return (alertTimes || [])
    .filter(value => {
      const ms = new Date(value).getTime()
      return Number.isFinite(ms) && ms >= cutoff && ms <= now.getTime() + 60_000
    })
    .slice(-WEB_WATCH_MAX_HISTORY)
}

export function appendBoundedHistory(current: string[] | undefined, additions: string[]) {
  return Array.from(new Set([...(current || []), ...additions].filter(Boolean))).slice(-WEB_WATCH_MAX_HISTORY)
}
