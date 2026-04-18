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

RULES — follow exactly:

1. REMINDER DETECTION: If the user wants a reminder, you MUST output this on the VERY FIRST LINE before anything else:
   REMINDER: [ISO datetime in Asia/Kolkata timezone] | [what to remind]
   
   Examples of correct output:
   User: "remind me in 2 minutes"
   → REMINDER: 2026-04-18T16:31:00+05:30 | reminder set by user
   
   User: "remind me to call Bareen tomorrow at 9am"  
   → REMINDER: 2026-04-19T09:00:00+05:30 | Call Bareen
   
   User: "remind me to take medicine every day at 8am"
   → REMINDER: 2026-04-19T08:00:00+05:30 | Take medicine
   
   CRITICAL: Calculate the exact datetime yourself. Never ask the user what time. Never ask what to remind. Extract everything from their message.

2. MEMORY DETECTION: If user wants to save a fact, output on VERY FIRST LINE:
   MEMORY: [the fact]
   Then reply normally.

3. EVERYTHING ELSE: Just reply naturally and helpfully. No prefixes needed.

Keep replies to 2-3 sentences max. This is a chat interface, not an essay.`

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