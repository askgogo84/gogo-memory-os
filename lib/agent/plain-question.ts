// A plain information question ("Best coworking space in Indiranagar", "Who directed Jailer 2?") needs
// no task, watch, booking, account or personal-context handler. On those, the dashboard was running
// the WhatsApp agent's ~45 matchers and the general planner (20 Oct timing: 5.9s + 1–2.4s) only for
// both to decline before the normal answer path ran. This gate is deliberately strict: anything that
// mentions the user, a task, an action or one of their services is NOT plain and keeps the full chain.
// Skipping only removes duplicated work; the message still goes through processIncomingMessage.

const QUESTION_START = /^(?:what(?:'s|s| is| are| was| were)?|which|who(?:'s| is)?|when|where|why|how(?: much| many| to| do| does| is| are)?|is|are|does|do|did|can|could|should|will|would|best|top|latest|cheapest|nearest|tell me about|explain|define|meaning of|difference between)\b/i

const NOT_PLAIN = new RegExp([
  // the user, their data and their accounts
  String.raw`\b(?:my|me|mine|i|i'm|im|i've|i'd|we|our|us)\b`,
  // tasks, follow-ups and Gogo's own work
  String.raw`\b(?:left to do|to-?dos?|remind|reminders?|alert|alerts|notify|watch(?:es|ing)?|track(?:ing)?|monitor|task|tasks|working on|status|update on|progress|approv\w*|confirm|cancel|stop|pause|resume|retry|again)\b`,
  // actions in the world
  String.raw`\b(?:book|booking|bookings|reserve|reservation|order|orders|buy|purchase|pay|payment|send|e-?mails?|mails?|mailbox|unread|messages?|whatsapp|call|text|schedule|reschedule|move|add|create|set|save|remember|forget|delete|remove|change|edit|connect|sign ?in|log ?in|login|password|otp|code)\b`,
  // answered by deterministic handlers (clock, date, weather, unit/currency maths), never a web snippet
  String.raw`\b(?:time|date|today's date|day is it|weather|temperature|rain|forecast|convert)\b`,
  // things that live in their accounts or need their context
  String.raw`\b(?:calendar|meeting|meetings|appointment|appointments|event|events|ticket|tickets|qr|flight|flights|train|trains|pnr|bus|hotel|gmail|inbox|drive|docs?|document|documents|file|files|list|lists|plan|plans|goal|goals|budget|expense|expenses|spent|spend|bill|bills|subscription|card|cards|account|accounts|price watch)\b`,
].join('|'), 'i')

export function isPlainInfoQuestion(text: string): boolean {
  const t = String(text || '').trim()
  if (!t || t.length > 200 || /\n/.test(t)) return false
  if (!QUESTION_START.test(t) && !/\?\s*$/.test(t)) return false
  if (NOT_PLAIN.test(t)) return false
  // one sentence only: a second sentence is often an instruction ("…? Add it to my calendar")
  if (/[.!?]\s+\S/.test(t.replace(/\?\s*$/, ''))) return false
  return true
}

// 20 Oct live: "Any important emails today?" (Gmail connected) went to web search: "emails" without "my" slipped
// past the gate above. A question about the person's own data (mail, inbox, their calendar, reminders, bookings,
// expenses) is answered from their accounts or saved records, never from a web search.
const PERSONAL_DATA = new RegExp([
  String.raw`\b(?:e-?mails?|mails?|mailbox|inbox|gmail|unread)\b`,
  String.raw`\b(?:my|our)\s+(?:\w+\s+){0,2}?(?:calendar|schedule|meetings?|appointments?|events?|reminders?|bookings?|reservations?|tickets?|orders?|expenses?|spend(?:ing)?|bills?|subscriptions?|documents?|files?|notes?|lists?|tasks?)\b`,
].join('|'), 'i')
// "How do I write a good cover email?" or "what is an email header" is general knowledge, not the inbox.
const GENERAL_EMAIL_KNOWLEDGE = /\b(?:how\s+(?:to|do\s+(?:i|you))\s+(?:write|send|format|set\s*up|create)|what\s+is\s+(?:an?\s+)?e-?mail|e-?mail\s+(?:etiquette|marketing|template|header|format|address\s+format|protocol|server))\b/i

/** True for a question about the person's own data; such a turn never goes to web search. */
export function isPersonalDataQuestion(text: string): boolean {
  const t = String(text || '').trim()
  if (!t || t.length > 300) return false
  if (GENERAL_EMAIL_KNOWLEDGE.test(t)) return false
  return PERSONAL_DATA.test(t)
}

const PERSONAL_ACTION = /\b(?:send|draft|write|compose|reply|respond|forward|add|create|book|reserve|schedule|reschedule|move|delete|remove|remind|set|save|cancel|pay|order|buy|archive|label|mark|unsubscribe|then)\b/i

/**
 * A read-only question about the person's own data ("Any important emails today?", "what's on my calendar?").
 * It needs no multi-step plan: the dashboard sends it straight to the read path instead of the general planner.
 */
export function isPersonalDataReadQuestion(text: string): boolean {
  const t = String(text || '').trim()
  if (!isPersonalDataQuestion(t) || /\n/.test(t)) return false
  if (!QUESTION_START.test(t) && !/^(?:any(?:thing)?|got)\b/i.test(t) && !/\?\s*$/.test(t)) return false
  return !PERSONAL_ACTION.test(t)
}
