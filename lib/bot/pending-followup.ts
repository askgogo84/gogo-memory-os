import { parseReminderIntent } from './handlers/reminders'
import { detectIntent } from './detect-intent'

// Shared logic for completing a "what time?" clarification. Kept pure (no I/O) so the routing
// harness can import and assert the exact resolution/guard behaviour prod uses. process-message
// owns the storage (saveFollowupState) and side effects; this module only turns a stored pending
// context + the user's time answer into a parsed reminder, and decides whether a message is an
// answer at all.

export type PendingReminderCtx = { task?: string | null; dateText?: string | null; day?: string | null; recurrence?: string | null }
export type PendingCalendarCtx = { title?: string | null; target?: string | null; timeText?: string | null }

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

const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_NAME_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
// The reminder fallback's date parser only understands named months, and its time parser would
// read the leading "20" of an ISO date as 20:00. Convert ISO / numeric (day-first) dates in the
// answer to "D Month YYYY" first so a calendar date reply is parsed as a date, not a time.
function normalizeAnswerDate(answer: string): string {
  return String(answer || '')
    .replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m, y, mo, d) => { const mi = Number(mo); return mi >= 1 && mi <= 12 ? `${Number(d)} ${MONTH_LABELS[mi - 1]} ${y}` : m })
    .replace(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/g, (m, d, mo, y) => { let Y = Number(y); if (Y < 100) Y += 2000; const mi = Number(mo), dd = Number(d); return mi >= 1 && mi <= 12 && dd >= 1 && dd <= 31 ? `${dd} ${MONTH_LABELS[mi - 1]} ${Y}` : m })
}
function answerCarriesDate(answer: string): boolean {
  return /\b(today|tonight|tomorrow|tmrw|tmr|day after tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i.test(answer)
    || /\bin\s+\d+\s+(?:day|days)\b/i.test(answer)
    || /\b\d{4}-\d{1,2}-\d{1,2}\b/.test(answer)
    || /\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/.test(answer)
    || new RegExp(`\\b\\d{1,2}\\s+(?:${MONTH_NAME_RE})\\b`, 'i').test(answer)
    || new RegExp(`\\b(?:${MONTH_NAME_RE})\\s+\\d{1,2}\\b`, 'i').test(answer)
    || /\b\d{1,2}(?:st|nd|rd|th)\b/i.test(answer)   // bare/ordinal day "the 28th" (reminder parser resolves it)
}

export function resolvePendingCalendar(ctx: PendingCalendarCtx, answerRaw: string) {
  const answer = normalizeAnswerDate(answerRaw)
  // A needsDate follow-up (timeText stored, no target) MUST receive a date before resolving —
  // a time-only correction ("actually 6 pm") must not create an event for today/tomorrow. In that
  // case return null; the caller keeps waiting for the date.
  const isNeedsDate = !!ctx.timeText && !ctx.target
  if (isNeedsDate && !answerCarriesDate(answerRaw) && !answerCarriesDate(answer)) return null
  const hasDay =
    /\b(today|tomorrow|tmrw|tmr|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i.test(answer) ||
    /\bin\s+\d+\s+(?:day|days|hour|hours|min|mins|minute|minutes)\b/i.test(answer)
  let dayWord = ''
  if (!hasDay && ctx.target === 'tomorrow') dayWord = 'tomorrow'
  else if (!hasDay && ctx.target === 'day_after_tomorrow') dayWord = 'in 2 days'
  // A needsDate follow-up preserved the TIME (timeText) and expects the answer to carry the DATE;
  // fold the time back in so date + time resolve together — BUT only when the answer doesn't supply
  // its own time. A corrected time ("tomorrow at 6 pm") must override the stored 5 pm.
  // Any time the answer supplies its own time — am/pm, 24-hour "18:00", "at 6", noon/midnight —
  // that time wins; only fall back to the stored timeText when the answer carries no time at all.
  const answerHasTime = /\b\d{1,2}[:.]\d{2}\b/.test(answer)   // 18:00 or dotted 18.00 (parseTimePart accepts both)
    || /\b\d{1,2}\s*(?:am|pm)\b/i.test(answer)
    || /\bat\s+\d{1,2}\b/i.test(answer)
    || /\b(?:noon|midnight|midday)\b/i.test(answer)
  const timePart = (!answerHasTime && ctx.timeText) ? ` ${ctx.timeText}` : ''
  return resolve(`${(ctx.title || 'meeting').trim()} ${dayWord}${timePart}`.trim(), answer)
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