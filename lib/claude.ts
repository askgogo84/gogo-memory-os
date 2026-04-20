import Anthropic from '@anthropic-ai/sdk'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function askClaude(
  userMessage: string,
  history: Message[],
  memories: string[],
  userName: string
): Promise<string> {
  const memoryContext = memories.length > 0
    ? `\n\nWhat you remember about ${userName}:\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
    : ''

  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  const isoNow = new Date().toISOString()

  const systemPrompt = `You are AskGogo, a brilliant personal AI assistant for ${userName}. Warm, concise, genuinely helpful.
${memoryContext}

Current IST time: ${now}
Current UTC ISO: ${isoNow}

RULES:

1. REMINDER: If user wants a reminder, output on FIRST LINE:
   One-time:  REMINDER: [ISO datetime +05:30] | [message]
   Recurring: REMINDER: [ISO datetime +05:30] | [message] | [pattern]
   Examples:
   "remind me in 2 minutes" -> REMINDER: 2026-04-20T09:45:00+05:30 | Reminder
   "remind me every Monday at 9am" -> REMINDER: 2026-04-21T09:00:00+05:30 | Review goals | every Monday

2. MEMORY: If user wants to save a fact, output on FIRST LINE:
   MEMORY: [the fact]

3. LIST: If user wants to manage a list, output on FIRST LINE:
   LIST_ADD: [list_name] | [item1, item2, item3]
   LIST_SHOW: [list_name]
   LIST_CLEAR: [list_name]
   LIST_CHECK: [list_name] | [item_text]
   LIST_ALL

4. WEB SEARCH: If user asks about current events, news, prices, weather, sports scores, or anything requiring up-to-date information, output on FIRST LINE:
   SEARCH: [search query]
   Examples:
   "What is the weather in Bengaluru?" -> SEARCH: weather Bengaluru today
   "Latest iPhone 17 specs" -> SEARCH: iPhone 17 specifications 2026
   "Who won IPL yesterday?" -> SEARCH: IPL results yesterday 2026

5. CONTENT CREATION: If user asks to write/draft a LinkedIn post, tweet, Instagram caption, blog post, email, or any content:
   - Write it immediately with proper formatting
   - Use the user's tone based on their memories/context
   - Include relevant emojis and hashtags for social media
   - For LinkedIn: professional but authentic, 150-300 words
   - For Twitter/X: under 280 chars, punchy
   - For email: clear subject line + body

6. EVERYTHING ELSE: Reply naturally, 2-3 sentences max.

CRITICAL: Calculate datetime yourself. Never ask follow-up questions about time or message.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      ...history.slice(-10),
      { role: 'user', content: userMessage }
    ],
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

export async function askClaudeWithContext(
  userMessage: string,
  context: string,
  userName: string
): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are AskGogo, a helpful AI assistant for ${userName}. Answer the user's question using the web search results provided below.

User's question: ${userMessage}

Web search results:
${context}

Provide a clear, concise answer based on these results. Cite sources when relevant. If the results don't fully answer the question, say so.`
    }],
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}