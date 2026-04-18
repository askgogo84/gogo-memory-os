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

  const systemPrompt = `You are AskGogo, a brilliant personal AI assistant for ${userName}. You are warm, concise, and genuinely helpful.

Your capabilities:
- Remember important facts the user tells you
- Set and manage reminders
- Answer questions intelligently
- Help with tasks, planning, and thinking
${memoryContext}

CRITICAL INSTRUCTIONS:
1. If the user wants to SAVE a memory, respond with exactly this format on the first line:
   MEMORY: [the fact to remember]
   Then continue with your normal reply.

2. If the user wants to SET a REMINDER, respond with exactly this format on the first line:
   REMINDER: [datetime in ISO format] | [reminder message]
   Example: REMINDER: 2026-04-19T17:00:00+05:30 | Call Bareen
   Then confirm naturally in your reply.

3. For everything else, just reply naturally and helpfully.

Keep replies concise. Max 3-4 sentences unless detail is needed.
Today's date and time in IST: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`

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