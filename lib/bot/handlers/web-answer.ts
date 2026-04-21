function cleanLine(text: string) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

export function buildDirectWebAnswer(userQuestion: string, searchContext: string): string {
  const context = cleanLine(searchContext)

  if (!context) {
    return `I couldn't fetch a live answer right now for: ${userQuestion}`
  }

  const chunks = searchContext
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 3)

  if (!chunks.length) {
    return `I couldn't fetch a live answer right now for: ${userQuestion}`
  }

  const lines = chunks.map((chunk, i) => `*${i + 1}.* ${cleanLine(chunk)}`)
  return `Here's what I found for *${userQuestion}*:\n\n${lines.join('\n\n')}`
}
