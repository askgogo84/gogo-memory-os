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
  String.raw`\b(?:remind|reminders?|alert|alerts|notify|watch(?:es|ing)?|track(?:ing)?|monitor|task|tasks|working on|status|update on|progress|approv\w*|confirm|cancel|stop|pause|resume|retry|again)\b`,
  // actions in the world
  String.raw`\b(?:book|booking|bookings|reserve|reservation|order|orders|buy|purchase|pay|payment|send|email|mail|message|whatsapp|call|text|schedule|reschedule|move|add|create|set|save|remember|forget|delete|remove|change|edit|connect|sign ?in|log ?in|login|password|otp|code)\b`,
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
