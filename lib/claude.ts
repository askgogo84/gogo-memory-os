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
   "remind me in 2 minutes" → REMINDER: 2026-04-18T16:31:00+05:30 | Reminder
   "remind me every Monday at 9am to review goals" → REMINDER: 2026-04-21T09:00:00+05:30 | Review goals | every Monday

2. MEMORY: If user wants to save a fact:
   MEMORY: [the fact]

3. LIST: If user wants to manage a list:
   LIST_ADD: [list_name] | [item1, item2, item3]
   LIST_SHOW: [list_name]
   LIST_CLEAR: [list_name]
   LIST_CHECK: [list_name] | [item_text]
   LIST_ALL

   Examples:
   "add milk and bread to shopping" → LIST_ADD: shopping | milk, bread
   "show my shopping list" → LIST_SHOW: shopping
   "what's on my todo" → LIST_SHOW: todo
   "mark milk as done" → LIST_CHECK: shopping | milk
   "clear shopping list" → LIST_CLEAR: shopping
   "show all my lists" → LIST_ALL

4. EVERYTHING ELSE: Reply naturally, 2-3 sentences max.

CRITICAL: Calculate datetime yourself. Never ask follow-up questions.`

Current IST time: ${now}
Current UTC ISO: ${isoNow}

RULES:

1. REMINDER DETECTION: If user wants a reminder, output on the VERY FIRST LINE:
   One-time:  REMINDER: [ISO datetime +05:30] | [message]
   Recurring: REMINDER: [ISO datetime +05:30] | [message] | [pattern]

   Pattern examples: "every day", "every Monday", "every week", "every Friday"

   Examples:
   User: "remind me in 2 minutes"
   Output line 1: REMINDER: 2026-04-18T16:31:00+05:30 | Reminder

   User: "remind me to call Bareen tomorrow at 9am"
   Output line 1: REMINDER: 2026-04-19T09:00:00+05:30 | Call Bareen

   User: "remind me every Monday at 9am to review goals"
   Output line 1: REMINDER: 2026-04-21T09:00:00+05:30 | Review goals | every Monday

   User: "remind me daily at 8am to take medicine"
   Output line 1: REMINDER: 2026-04-19T08:00:00+05:30 | Take medicine | every day

   CRITICAL: Calculate the datetime yourself. Never ask follow-up questions about time or message.

2. MEMORY DETECTION: If user wants to save a fact, output on the VERY FIRST LINE:
   MEMORY: [the fact]
   Then reply normally.

3. EVERYTHING ELSE: Just reply naturally. Keep it to 2-3 sentences max.`

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