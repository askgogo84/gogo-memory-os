import { createHash } from 'node:crypto'

export const WEB_WATCH_MIN_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000
export const WEB_WATCH_MAX_ALERTS_24H = 2
export const WEB_WATCH_MAX_HISTORY = 40

export type WebWatchQualityResult = {
  eligible: boolean
  reason: 'eligible' | 'duplicate_url' | 'duplicate_topic' | 'low_relevance' | 'keyword_miss'
  canonicalUrl: string
  signature: string
  relevance: number
  matchedKeywords: string[]
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
}): WebWatchQualityResult {
  const canonicalUrl = canonicalWatcherUrl(params.url)
  const signature = watcherResultSignature(params.title, params.snippet || '')
  const seenUrls = new Set((params.seenUrls || []).map(canonicalWatcherUrl))
  const seenSignatures = new Set(params.seenSignatures || [])

  if (seenUrls.has(canonicalUrl)) return { eligible:false, reason:'duplicate_url', canonicalUrl, signature, relevance:0, matchedKeywords:[] }
  if (seenSignatures.has(signature)) return { eligible:false, reason:'duplicate_topic', canonicalUrl, signature, relevance:0, matchedKeywords:[] }

  const resultTokens = new Set(words(`${params.title} ${params.snippet || ''}`))
  const { all: queryTokens, anchors } = intentTokens(params.query)
  const matched = queryTokens.filter(token => resultTokens.has(token))
  const relevance = queryTokens.length ? matched.length / queryTokens.length : 0
  const anchorHit = anchors.length === 0 || anchors.some(token => resultTokens.has(token))

  // Search providers frequently rotate generic listicles into the top results. Treat those as noise.
  // A useful update must cover most of the watch intent and, when present, retain a distinctive query anchor.
  if (!anchorHit || (queryTokens.length >= 3 ? relevance < 0.72 : relevance < 0.5)) {
    return { eligible:false, reason:'low_relevance', canonicalUrl, signature, relevance, matchedKeywords:[] }
  }

  const triggerKeywords = Array.from(new Set((params.triggerKeywords || []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean)))
  const haystack = `${params.title} ${params.snippet || ''} ${params.url}`.toLowerCase()
  const matchedKeywords = triggerKeywords.filter(keyword => haystack.includes(keyword))
  if (triggerKeywords.length && matchedKeywords.length === 0) {
    return { eligible:false, reason:'keyword_miss', canonicalUrl, signature, relevance, matchedKeywords }
  }

  return { eligible:true, reason:'eligible', canonicalUrl, signature, relevance, matchedKeywords }
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
