export type WebSearchResult = {
  title: string
  snippet: string
  url: string
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function searchWithBrave(query: string): Promise<WebSearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) return []

  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
    {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
      cache: 'no-store',
    }
  )

  if (!res.ok) {
    throw new Error(`Brave search failed: ${res.status}`)
  }

  const data = await res.json()
  const results = data?.web?.results || []

  return results.map((r: any) => ({
    title: r.title || 'Untitled',
    snippet: r.description || '',
    url: r.url || '',
  }))
}

async function searchWithDuckDuckGo(query: string): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`DuckDuckGo search failed: ${res.status}`)
  }

  const html = await res.text()

  const matches = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)]

  const results: WebSearchResult[] = []

  for (let i = 0; i < Math.min(matches.length, 5); i++) {
    const href = matches[i][1] || ''
    const title = stripHtml(matches[i][2] || '')
    const snippet = stripHtml(snippets[i]?.[1] || '')
    results.push({
      title,
      snippet,
      url: href,
    })
  }

  return results
}

export async function searchWeb(query: string): Promise<string> {
  try {
    let results = await searchWithBrave(query)

    if (!results.length) {
      results = await searchWithDuckDuckGo(query)
    }

    if (!results.length) {
      return `No fresh web results found for: ${query}`
    }

    return results
      .map((r, i) => {
        return `${i + 1}. ${r.title}\n${r.snippet}\nSource: ${r.url}`
      })
      .join('\n\n')
  } catch (err: any) {
    console.error('searchWeb failed:', err)
    return `Web search failed for query: ${query}`
  }
}
