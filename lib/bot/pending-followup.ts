import { parseReminderIntent } from './handlers/reminders'
import { detectIntent } from './detect-intent'

// Shared logic for completing a "what time?" clarification. Kept pure (no I/O) so the routing
// harness can import and assert the exact resolution/guard behaviour prod uses. process-message
// owns the storage (saveFollowupState) and side effects; this module only turns a stored pending
// context + the user's time answer into a parsed reminder, and decides whether a message is an
// answer at all.

export type PendingReminderCtx = { task?: string | null; day?: string | null; recurrence?: string | null }
export type PendingCalendarCtx = { title?: string | null; target?: string | null }

// Compose the pending answer into a phrase the existing reminder parser understands, then hand
// it to parseReminderIntent. Two attempts: the phrase as-is (handles "8pm today", "in 2 hours",
// "every Monday 10 am"), then with an explicit "at" inserted so a bare clock time ("8 pm",
// "10:30") still resolves — parseSimpleAtTime needs the "at"/"for" cue.
function resolve(taskPhrase: string, answer: string) {
  const base = `Remind me to ${taskPhrase} `.replace(/\s+/g, ' ')
  const raw = (answer || '').trim()
  return parseReminderIntent(`${base}${raw}`.trim()) || parseReminderIntent(`${base}at ${raw}`.trim())
}

export function resolvePendingReminder(ctx: PendingReminderCtx, answer: string) {
  // Preserve any day-of-month context captured when the reminder was first stated
  // ("15th of every month") so the completed reminder lands on the right date.
  const dayClause = ctx.day ? `on the ${ctx.day}th of every month ` : ''
  return resolve(`${(ctx.task || '').trim()} ${dayClause}`.trim(), answer)
}

export function resolvePendingCalendar(ctx: PendingCalendarCtx, answer: string) {
  // If the original "add … to my calendar" named a day (tomorrow / day after) but no time,
  // carry that day into the composed phrase — unless the answer already carries its own day
  // or relative marker, in which case the answer wins.
  const hasDay =
    /\b(today|tomorrow|tmrw|tmr|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i.test(answer) ||
    /\bin\s+\d+\s+(?:day|days|hour|hours|min|mins|minute|minutes)\b/i.test(answer)
  let dayWord = ''
  if (!hasDay && ctx.target === 'tomorrow') dayWord = 'tomorrow'
  else if (!hasDay && ctx.target === 'day_after_tomorrow') dayWord = 'in 2 days'
  return resolve(`${(ctx.title || 'meeting').trim()} ${dayWord}`.trim(), answer)
}

// A fresh command that starts with an explicit action verb must never be swallowed as an
// answer to a prior clarifying question.
const NEW_COMMAND_VERB =
  /^(?:remind|add|show|view|open|create|schedule|book|set\s+up|put|delete|cancel|remove|clear|list|check|uncheck|mark|connect|plan|log|track|save|remember|find|search|invite|refer|upgrade|subscribe|help|menu|dashboard)\b/i

// True when the incoming message is a new command in its own right, so it should route
// normally rather than complete a pending clarification. Reminder-shaped answers ("in 2 hours",
// "every Monday 10 am", a bare "8 pm") are deliberately allowed through — they ARE valid time
// answers. Only a HIGH-confidence non-reminder intent (or a leading action verb) is treated as
// a new command; "8pm today" classifies as web_search MEDIUM (the 'today' hint) and so is not
// blocked here.
export function looksLikeNewCommand(text: string): boolean {
  const l = (text || '').toLowerCase().trim()
  if (!l) return true
  if (NEW_COMMAND_VERB.test(l)) return true
  const di = detectIntent(text)
  if (di.confidence === 'high' && di.type !== 'set_reminder') return true
  return false
}
