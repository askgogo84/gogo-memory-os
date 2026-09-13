import { parseReminderIntent } from './handlers/reminders'
import { detectIntent } from './detect-intent'

// Shared logic for completing a "what time?" clarification. Kept pure (no I/O) so the routing
// harness can import and assert the exact resolution/guard behaviour prod uses. process-message
// owns the storage (saveFollowupState) and side effects; this module only turns a stored pending
// context + the user's time answer into a parsed reminder, and decides whether a message is an
// answer at all.

export type PendingReminderCtx = { task?: string | null; dateText?: string | null; day?: string | null; recurrence?: string | null }
export type PendingCalendarCtx = { title?: string | null; target?: string | null }

function resolve(taskPhrase: string, answer: string) {
  const base = `Remind me to ${taskPhrase} `.replace(/\s+/g, ' ')
  const raw = (answer || '').trim()
  return parseReminderIntent(`${base}${raw}`.trim()) || parseReminderIntent(`${base}at ${raw}`.trim())
}

export function resolvePendingReminder(ctx: PendingReminderCtx, answer: string) {
  const task = (ctx.task || '').trim()
  const dateText = (ctx.dateText || '').trim()
  const dayClause = ctx.day ? `on the ${ctx.day}th of every month` : ''
  const scheduleContext = [task, dateText, dayClause].filter(Boolean).join(' ')
  const parsed = resolve(scheduleContext, answer)
  if (!parsed) return null

  // The pending state already contains the exact human task. Keep it as the title and
  // use dateText/dayClause only to resolve when it should fire.
  return task ? { ...parsed, message: task } : parsed
}

export function resolvePendingCalendar(ctx: PendingCalendarCtx, answer: string) {
  const hasDay =
    /\b(today|tomorrow|tmrw|tmr|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i.test(answer) ||
    /\bin\s+\d+\s+(?:day|days|hour|hours|min|mins|minute|minutes)\b/i.test(answer)
  let dayWord = ''
  if (!hasDay && ctx.target === 'tomorrow') dayWord = 'tomorrow'
  else if (!hasDay && ctx.target === 'day_after_tomorrow') dayWord = 'in 2 days'
  return resolve(`${(ctx.title || 'meeting').trim()} ${dayWord}`.trim(), answer)
}

const NEW_COMMAND_VERB =
  /^(?:remind|add|show|view|open|create|schedule|book|set\s+up|put|delete|cancel|remove|clear|list|check|uncheck|mark|connect|plan|log|track|save|remember|find|search|invite|refer|upgrade|subscribe|help|menu|dashboard)\b/i

export function looksLikeNewCommand(text: string): boolean {
  const l = (text || '').toLowerCase().trim()
  if (!l) return true
  if (NEW_COMMAND_VERB.test(l)) return true
  const di = detectIntent(text)
  if (di.confidence === 'high' && di.type !== 'set_reminder') return true
  return false
}