export async function webSearch(query: string): Promise<string> {
  try {
    const encoded = encodeURIComponent(query)
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`
    )
    const data = await response.json()

    let results = ''

    if (data.AbstractText) {
      results += `${data.AbstractText}\nSource: ${data.AbstractSource}\n\n`
    }

    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      const topics = data.RelatedTopics
        .filter((t: any) => t.Text)
        .slice(0, 5)
        .map((t: any) => t.Text)
        .join('\n')
      if (topics) results += `Related info:\n${topics}\n`
    }

    if (results.trim().length < 50) {
      results = `Search query: "${query}"\n\nI searched for this but could not find specific real-time results. I can answer based on my knowledge, or you can try rephrasing the query.`
    }

    return results
  } catch (err) {
    console.error('Web search failed:', err)
    return `Search failed for: "${query}". Please try again.`
  }
}