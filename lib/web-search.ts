export type WebSearchResult = {
  title: string
  snippet: string
  url: string
  publishedDate?: string
}

import { searchReferenceFx } from './services/reference-fx'

function cleanText(input: string) {
  return (input || '').replace(/\s+/g, ' ').trim()
}

export type WebSearchOptions = { includeDomains?: string[]; timeoutMs?: number; startDate?: string; endDate?: string; filterByPublishedDate?: boolean }

async function searchWithTavily(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    console.error('TAVILY_API_KEY missing')
    return []
  }

  const includeDomains = (opts.includeDomains || []).map(d => String(d || '').trim().toLowerCase()).filter(Boolean)
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      topic: 'general',
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
      ...(includeDomains.length ? { include_domains: includeDomains } : {}),
      ...(opts.startDate ? {start_date: opts.startDate} : {}),
      ...(opts.endDate ? {end_date: opts.endDate} : {}),
      ...(opts.filterByPublishedDate ? {include_published_date: true, filter_by_published_date: true} : {}),
    }),
    cache: 'no-store',
    ...(opts.timeoutMs ? {signal: AbortSignal.timeout(Math.max(1000, Math.min(opts.timeoutMs, 30_000)))} : {}),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('Tavily search failed:', res.status, text)
    throw new Error(`tavily_failed:${res.status}`)
  }

  const data = await res.json()
  const results = data?.results || []

  return results.map((r: any) => ({
    title: cleanText(r.title || ''),
    snippet: cleanText(r.content || r.snippet || ''),
    url: r.url || '',
    ...(r.published_date ? {publishedDate: String(r.published_date)} : {}),
  }))
}

export async function searchWithAnthropic(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []
  const includeDomains = (opts.includeDomains || []).map(d => String(d || '').trim().toLowerCase()).filter(Boolean)
  const body: any = {
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2, user_location: { type: 'approximate', country: 'IN', timezone: 'Asia/Kolkata' }, ...(includeDomains.length ? { allowed_domains: includeDomains } : {}) }],
      messages: [{ role: 'user', content: `Search the web for: ${query}\nReply with the key current facts you found (numbers, dates, names), each sentence backed by a source.` }],
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(Math.max(5000, Math.min(opts.timeoutMs || 30_000, 45_000))),
  })
  if (!res.ok) throw new Error(`anthropic_search_failed:${res.status}:${(await res.text()).slice(0, 200)}`)
  let data = await res.json()
  // A long server-side search can stop with pause_turn; the API requires sending the assistant turn back to continue.
  if (data?.stop_reason === 'pause_turn') {
    const again = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ ...body, messages: [...body.messages, { role: 'assistant', content: data.content }] }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
    if (again.ok) data = await again.json()
  }
  const results = anthropicSearchResults(data)
  // 18 Oct retest: the fallback returned nothing with no log. Record why, without query text or content.
  const toolErrors = (Array.isArray(data?.content) ? data.content : [])
    .filter((b: any) => b?.type === 'web_search_tool_result' && b?.content && !Array.isArray(b.content))
    .map((b: any) => String(b.content?.error_code || b.content?.type || 'unknown'))
  console.log('WEB_SEARCH_FALLBACK:', JSON.stringify({ stop: data?.stop_reason || null, results: results.length, toolErrors, blocks: (data?.content || []).map((b: any) => b?.type).slice(0, 12) }))
  return results
}

/** Turns a Messages API response with web_search results into ranked results with cited snippets. */
export function anthropicSearchResults(data: any): WebSearchResult[] {
  const byUrl = new Map<string, WebSearchResult>()
  const blocks: any[] = Array.isArray(data?.content) ? data.content : []
  for (const block of blocks) {
    if (block?.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue
    for (const r of block.content) {
      if (r?.type !== 'web_search_result' || !r.url || byUrl.has(r.url)) continue
      byUrl.set(r.url, { title: cleanText(r.title || ''), snippet: '', url: String(r.url), ...(r.page_age ? { publishedDate: String(r.page_age) } : {}) })
    }
  }
  let answer = ''
  for (const block of blocks) {
    if (block?.type !== 'text') continue
    answer += String(block.text || '')
    for (const c of Array.isArray(block.citations) ? block.citations : []) {
      if (!c?.url) continue
      const row = byUrl.get(c.url) || { title: cleanText(c.title || ''), snippet: '', url: String(c.url) }
      const cited = cleanText(`${cleanText(block.text || '')} ${c.cited_text ? `(${cleanText(c.cited_text)})` : ''}`)
      if (!row.snippet.includes(cited)) row.snippet = cleanText(`${row.snippet} ${cited}`).slice(0, 900)
      byUrl.set(c.url, row)
    }
  }
  // Only cited results count: uncited model text (or a tool error inside a 200) is not live web evidence.
  return [...byUrl.values()].filter(r => r.snippet && r.url).slice(0, 6)
}

// 19 Oct: Tavily returned 432 (plan quota) on every call for hours; each call still paid a failed
// round-trip before the fallback. After a quota/auth refusal, skip that provider on this instance for
// a while and go to the next one. Other errors (timeouts, 5xx) are retried normally.
const QUOTA_BACKOFF_MS = 30 * 60_000
const blockedUntil: Record<string, number> = {}
export function providerQuotaBlocked(provider: 'tavily' | 'serper', now = Date.now()) { return now < (blockedUntil[provider] || 0) }
export function tavilyQuotaBlocked(now = Date.now()) { return providerQuotaBlocked('tavily', now) }
export function noteProviderFailure(provider: 'tavily' | 'serper', err: unknown, now = Date.now()) {
  if (new RegExp(`${provider}_failed:(?:401|402|403|429|432)\\b`).test(String((err as any)?.message || err))) {
    if (!providerQuotaBlocked(provider, now)) console.error(`SEARCH_QUOTA_BACKOFF: skipping ${provider} for 30 min on this instance`)
    blockedUntil[provider] = now + QUOTA_BACKOFF_MS
  }
}
export function noteTavilyFailure(err: unknown, now = Date.now()) { noteProviderFailure('tavily', err, now) }

// Serper returns relative dates ("3 hours ago") or calendar dates ("Oct 19, 2026"). Only pass on
// dates we can turn into a real timestamp, so freshness checks never read a guess.
export function serperDate(raw: unknown, now = Date.now()): string | undefined {
  const text = cleanText(String(raw || ''))
  if (!text) return undefined
  const rel = text.match(/^(\d+)\s+(minute|hour|day|week)s?\s+ago$/i)
  if (rel) {
    const unit = {minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000}[rel[2].toLowerCase() as 'minute'] as number
    return new Date(now - Number(rel[1]) * unit).toISOString()
  }
  // A bare calendar day is pinned to midday UTC so the server's timezone cannot shift it a day.
  const parsed = Date.parse(/^[A-Za-z]{3,9}\.? \d{1,2}, \d{4}$/.test(text) ? `${text} 12:00:00 UTC` : text)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

function serperDay(iso: string) { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}` : '' }

async function searchWithSerper(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) throw new Error('serper_missing_key')
  const includeDomains = (opts.includeDomains || []).map(d => String(d || '').trim().toLowerCase()).filter(Boolean)
  const q = includeDomains.length ? `${query} (${includeDomains.map(d => `site:${d}`).join(' OR ')})` : query
  const min = opts.startDate ? serperDay(opts.startDate) : '', max = opts.endDate ? serperDay(opts.endDate) : ''
  const tbs = min || max ? `cdr:1${min ? `,cd_min:${min}` : ''}${max ? `,cd_max:${max}` : ''}` : undefined
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {'X-API-KEY': apiKey, 'Content-Type': 'application/json'},
    body: JSON.stringify({q, gl: 'in', hl: 'en', num: 8, ...(tbs ? {tbs} : {})}),
    cache: 'no-store',
    signal: AbortSignal.timeout(Math.max(1000, Math.min(opts.timeoutMs || 12_000, 30_000))),
  })
  if (!res.ok) {
    console.error('Serper search failed:', res.status, (await res.text()).slice(0, 300))
    throw new Error(`serper_failed:${res.status}`)
  }
  const data = await res.json()
  const out: WebSearchResult[] = []
  const box = data?.answerBox
  if (box?.link && (box.answer || box.snippet)) out.push({title: cleanText(box.title || ''), snippet: cleanText([box.answer, box.snippet].filter(Boolean).join(' — ')), url: String(box.link), ...(serperDate(box.date) ? {publishedDate: serperDate(box.date)} : {})})
  for (const r of data?.organic || []) {
    if (!r?.link || out.some(o => o.url === r.link)) continue
    const publishedDate = serperDate(r.date)
    out.push({title: cleanText(r.title || ''), snippet: cleanText(r.snippet || ''), url: String(r.link), ...(publishedDate ? {publishedDate} : {})})
  }
  const results = includeDomains.length ? out.filter(r => { try { const h = new URL(r.url).hostname.toLowerCase(); return includeDomains.some(d => h === d || h.endsWith('.' + d)) } catch { return false } }) : out
  const dated = opts.filterByPublishedDate && (opts.startDate || opts.endDate)
    ? results.filter(r => r.publishedDate && (!opts.startDate || r.publishedDate >= new Date(opts.startDate).toISOString()) && (!opts.endDate || r.publishedDate.slice(0, 10) <= opts.endDate.slice(0, 10)))
    : results
  return dated.slice(0, 5)
}

export function searchProviderOrder(env: Record<string, string | undefined> = process.env): Array<'serper' | 'tavily'> {
  const raw = String(env.SEARCH_PROVIDER_ORDER || '').toLowerCase().split(',').map(v => v.trim()).filter((v): v is 'serper' | 'tavily' => v === 'serper' || v === 'tavily')
  const order = raw.length ? raw : ['serper', 'tavily'] as Array<'serper' | 'tavily'>
  return [...new Set([...order, 'serper', 'tavily'] as Array<'serper' | 'tavily'>)]
}

export async function searchWebResults(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const cleanQuery = cleanText(query).slice(0, 500)
  if (!cleanQuery) return []
  if(!Object.keys(opts).length){
    const reference=await searchReferenceFx(query)
    if(reference!==null)return reference
  }
  // Order: Serper (Google results, India) → Tavily → Anthropic web search (20 Oct: Tavily is over its
  // plan limit and its failing call cost ~3.5s on every fresh server before Serper ran).
  // SEARCH_PROVIDER_ORDER=tavily,serper restores the old order. A provider that reported quota/auth
  // exhaustion is skipped for 30 minutes; an empty answer moves on to the next one.
  for (const provider of searchProviderOrder()) {
    const key = provider === 'tavily' ? process.env.TAVILY_API_KEY : process.env.SERPER_API_KEY
    if (!key || providerQuotaBlocked(provider)) continue
    const started = Date.now()
    try {
      const results = provider === 'tavily' ? await searchWithTavily(cleanQuery, opts) : await searchWithSerper(cleanQuery, opts)
      console.log('SEARCH:', JSON.stringify({ provider, ms: Date.now() - started, results: results.length }))
      if (results.length) return results
    } catch (err: any) {
      noteProviderFailure(provider, err)
      console.error(provider === 'tavily' ? 'searchWebResults failed:' : 'SERPER_SEARCH_FAILED:', err?.message || err, `(${Date.now() - started}ms)`)
    }
  }
  // 18 Oct live: Tavily hit its plan limit (432) and every web answer — petrol, gold, news — came back
  // empty. Anthropic's web search is the last resort so live questions still get sources.
  return await searchWithAnthropic(cleanQuery, opts).catch((fallbackErr: any) => {
    console.error('WEB_SEARCH_FALLBACK_FAILED:', fallbackErr?.message || fallbackErr)
    return []
  })
}

// Price/shopping queries must return Indian ₹ answers from Indian retailers, not USD from
// camelcamelcamel US. For shopping intents only, scope the query to India + INR and bias the
// results to Indian retailer domains. Non-shopping queries (news, scores, weather) are untouched.
const SHOPPING_RE = /\b(price|cost|cheapest|deal|deals|discount|how much|in stock|availability|buy)\b/i
export function indiaShoppingSearch(query: string): { query: string; includeDomains: string[] } {
  if (!SHOPPING_RE.test(query)) return { query, includeDomains: [] }
  // 18 Oct live: "petrol price in Bangalore today" was searched on Amazon/Flipkart only and returned iPhones.
  // Fuel, metal, share, currency, fare and other market prices are not retailer products.
  if (/\b(?:petrol|diesel|cng|lpg|fuel|gold|silver|platinum|stock|shares?|sensex|nifty|crypto|bitcoin|dollar|usd|euro|rupee rate|exchange rate|onion|tomato|vegetable|mandi|electricity|ticket|fare|flight|train|bus|rent|property|land|toll|fees?)\b/i.test(query)) return { query, includeDomains: [] }
  const q = /\b(india|inr|₹|rupee|rupees)\b/i.test(query) ? query : `${query} price in India in INR`
  return { query: q, includeDomains: ['amazon.in', 'flipkart.com', 'croma.com', 'reliancedigital.in'] }
}

export function isRecentNewsQuery(query: string) {
  return /\b(?:latest|news|headlines?|updates?|what(?:'s| is) happening)\b/i.test(query) && !/\b(?:price|rate|cost|score|weather|flight|pnr)\b/i.test(query)
}

export async function searchWeb(query: string): Promise<string> {
  try {
    const loc = indiaShoppingSearch(query)
    // 19 Oct live: "Latest news on Tata Motors" led with a year-old demerger story. News asks are
    // limited to the last 7 days at the provider; price and fact lookups are not date-restricted.
    const recent = isRecentNewsQuery(query) ? {startDate: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)} : {}
    const opts = {...(loc.includeDomains.length ? { includeDomains: loc.includeDomains } : {}), ...recent}
    let results = await searchWebResults(loc.query, opts)
    if (!results.length && 'startDate' in recent) results = await searchWebResults(loc.query, loc.includeDomains.length ? { includeDomains: loc.includeDomains } : {})

    if (!results.length) {
      return ''
    }

    return results
      .map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}\nSource: ${r.url}`)
      .join('\n\n')
  } catch (err: any) {
    console.error('searchWeb failed:', err)
    return ''
  }
}
