// The tap suggestions in the dashboard chat (empty state cards and the row above the box) and the greeting.
// Pure data and two small functions so the component and the tests agree.
// "send" suggestions are complete questions and are sent at once. The others need details from the person
// (a route, a product, what to remember), so they fill the box and leave the cursor at the end.

export type ChatSuggestion = {
  id: 'plan-day' | 'today' | 'flight' | 'price' | 'reminder' | 'document'
  title: string
  hint: string
  prompt: string
  send: boolean
}

export const CHAT_SUGGESTIONS: ChatSuggestion[] = [
  { id: 'plan-day', title: 'Plan my day', hint: 'Calendar, reminders and what needs you', prompt: 'Plan my day', send: true },
  { id: 'today', title: 'What do I have today?', hint: 'Events and reminders', prompt: 'What do I have today?', send: true },
  { id: 'flight', title: 'Find a flight', hint: 'Live prices, cabin and time of day', prompt: 'Find flights from ', send: false },
  { id: 'price', title: 'Watch a price', hint: 'Alert me when it drops', prompt: 'Alert me when ', send: false },
  { id: 'reminder', title: 'Set a reminder', hint: 'Once or repeating', prompt: 'Remind me to ', send: false },
  { id: 'document', title: 'Find a saved document', hint: 'From your Library', prompt: 'Find a saved document', send: true },
]

export function greetingFor(hour: number): string {
  if (!Number.isFinite(hour)) return 'Hello'
  const h = ((Math.floor(hour) % 24) + 24) % 24
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'
}

/** First name for the greeting, from whatever the account has stored. Empty when there is nothing usable. */
export function firstNameOf(name: unknown): string {
  const first = String(name ?? '').trim().split(/\s+/)[0] || ''
  // A phone number or email in the name field is not a name.
  if (!first || /[@\d]/.test(first)) return ''
  return first.slice(0, 24)
}
