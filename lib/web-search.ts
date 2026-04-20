export async function webSearch(query: string): Promise<string> {
  try {
    // Use Brave Search API (free tier: 2000 queries/month)
    const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY

    if (BRAVE_API_KEY) {
      const encoded = encodeURIComponent(query)
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=5`,
        {
          headers: { 'X-Subscription-Token': BRAVE_API_KEY },
        }
      )
      const data = await response.json()

      if (data.web?.results && data.web.results.length > 0) {
        const results = data.web.results
          .slice(0, 5)
          .map((r: any) => `Title: ${r.title}\nSnippet: ${r.description}\nURL: ${r.url}`)
          .join('\n\n')
        return results
      }
    }

    // Fallback: Use DuckDuckGo HTML search (no API key needed)
    const encoded = encodeURIComponent(query)
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encoded}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    )
    const html = await response.text()

    // Extract result snippets from HTML
    const snippets: string[] = []
    const resultRegex = /<a rel="nofollow" class="result__a" href="[^"]*">([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    let match
    let count = 0
    while ((match = resultRegex.exec(html)) !== null && count < 5) {
      const title = match[1].replace(/<[^>]+>/g, '').trim()
      const snippet = match[2].replace(/<[^>]+>/g, '').trim()
      if (title && snippet) {
        snippets.push(`Title: ${title}\nSnippet: ${snippet}`)
        count++
      }
    }

    if (snippets.length > 0) {
      return snippets.join('\n\n')
    }

    // Last fallback: DuckDuckGo instant answer API
    const ddgResponse = await fetch(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`
    )
    const ddgData = await ddgResponse.json()

    let results = ''
    if (ddgData.AbstractText) {
      results += `${ddgData.AbstractText}\nSource: ${ddgData.AbstractSource}\n\n`
    }
    if (ddgData.RelatedTopics && ddgData.RelatedTopics.length > 0) {
      const topics = ddgData.RelatedTopics
        .filter((t: any) => t.Text)
        .slice(0, 5)
        .map((t: any) => t.Text)
        .join('\n')
      if (topics) results += `Related:\n${topics}\n`
    }

    if (results.trim().length < 30) {
      return `No real-time results found for "${query}". Please answer based on your general knowledge.`
    }

    return results
  } catch (err) {
    console.error('Web search failed:', err)
    return `Search could not complete for "${query}". Please answer based on your general knowledge.`
  }
}