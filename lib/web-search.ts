export type WebSearchResult = {
  title: string
  snippet: string
  url: string
}

function cleanText(input: string) {
  return (input || '').replace(/\s+/g, ' ').trim()
}

export type WebSearchOptions = { includeDomains?: string[]; timeoutMs?: number }

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
    }),
    cache: 'no-store',
    ...(opts.timeoutMs ? {signal: AbortSignal.timeout(Math.max(1000, Math.min(opts.timeoutMs, 30_000)))} : {}),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('Tavily search failed:', res.status, text)
    return []
  }

  const data = await res.json()
  const results = data?.results || []

  return results.map((r: any) => ({
    title: cleanText(r.title || ''),
    snippet: cleanText(r.content || r.snippet || ''),
    url: r.url || '',
  }))
}

export async function searchWebResults(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const cleanQuery = cleanText(query).slice(0, 500)
  if (!cleanQuery) return []
  try {
    return await searchWithTavily(cleanQuery, opts)
  } catch (err: any) {
    console.error('searchWebResults failed:', err)
    return []
  }
}

// Price/shopping queries must return Indian ₹ answers from Indian retailers, not USD from
// camelcamelcamel US. For shopping intents only, scope the query to India + INR and bias the
// results to Indian retailer domains. Non-shopping queries (news, scores, weather) are untouched.
const SHOPPING_RE = /\b(price|cost|cheapest|deal|deals|discount|how much|in stock|availability|buy)\b/i
export function indiaShoppingSearch(query: string): { query: string; includeDomains: string[] } {
  if (!SHOPPING_RE.test(query)) return { query, includeDomains: [] }
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
