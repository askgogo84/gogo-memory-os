export type WebSearchResult = {
  title: string
  snippet: string
  url: string
}

function cleanText(input: string) {
  return (input || '').replace(/\s+/g, ' ').trim()
}

async function searchWithTavily(query: string): Promise<WebSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    console.error('TAVILY_API_KEY missing')
    return []
  }

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
      include_answer: false
    }),
    cache: 'no-store',
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

export async function searchWeb(query: string): Promise<string> {
  try {
    const results = await searchWithTavily(query)

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
