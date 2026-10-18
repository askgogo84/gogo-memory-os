export type WebSearchResult = {
  title: string
  snippet: string
  url: string
  publishedDate?: string
}

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

export async function searchWebResults(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const cleanQuery = cleanText(query).slice(0, 500)
  if (!cleanQuery) return []
  try {
    return await searchWithTavily(cleanQuery, opts)
  } catch (err: any) {
    console.error('searchWebResults failed:', err?.message || err)
    // 18 Oct live: Tavily hit its plan limit (432) and every web answer — petrol, gold, news — came back
    // empty. Fall back to Anthropic's web search so live questions still get sources.
    return await searchWithAnthropic(cleanQuery, opts).catch((fallbackErr: any) => {
      console.error('WEB_SEARCH_FALLBACK_FAILED:', fallbackErr?.message || fallbackErr)
      return []
    })
  }
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

export async function searchWeb(query: string): Promise<string> {
  try {
    const loc = indiaShoppingSearch(query)
    const results = await searchWebResults(loc.query, loc.includeDomains.length ? { includeDomains: loc.includeDomains } : {})

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
