// Recurring-reminder dedup key. Two "daily" reminders at DIFFERENT times of day
// (9am vs 6pm) are distinct series, not duplicates — so the dedup axis is
// (recurring_pattern + time-of-day), never recurring_pattern alone. Kept pure and
// dependency-free so scripts/verify-reminder-dedup.mts exercises the shipped logic.
//
// Time-of-day is compared in UTC: every reminder row's remind_at is computed by the
// same writer against the same zone, so their UTC wall-times line up iff their local
// times do. That makes a naive HH:MM(UTC) comparison sufficient — no tz conversion.

export function reminderTimeOfDayUTC(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

// Given the same-pattern candidate rows already fetched for this user, return the one
// that is a TRUE duplicate of an incoming reminder — i.e. same time-of-day. Returns
// null when none match (→ the caller inserts a new row instead of overwriting).
// Falls back to the first row only when no remindAt is supplied, preserving the prior
// pattern-only behaviour for any caller that can't provide a time.
export function pickRecurringDuplicate<T extends { remind_at?: string | null }>(
  rows: T[],
  remindAt?: string
): T | null {
  if (!rows.length) return null
  if (!remindAt) return rows[0] || null
  const tod = reminderTimeOfDayUTC(remindAt)
  return rows.find((r) => r.remind_at && reminderTimeOfDayUTC(r.remind_at) === tod) || null
}

// 20 Oct live: "What are my reminders?" listed "Retrieve saved preferences about activities, dining,
// entertainment, travel patterns, and any …" — an internal agent plan step (a read instruction the
// planner hands to the same brain) that was saved as a user reminder. A user's reminder names
// something THEY will do; a plan step tells the assistant to look up the user's own saved data.
// Both shapes must hold (an agent read verb at the start AND a saved-data object), so a real
// "retrieve my laundry" or "review the week" reminder is never hidden. Pure.
const PLAN_STEP_VERB = /^\s*(?:to\s+)?(?:retrieve|fetch|gather|compile|query|look\s+up|search|scan|analy[sz]e|extract|summari[sz]e|identify|collect|pull)\b/i
const PLAN_STEP_OBJECT = /\b(?:saved|stored|existing)\s+(?:preferences?|memor(?:y|ies)|context|data|notes|facts|details|information|records?|history)\b|\b(?:user(?:'s)?|owner(?:'s)?)\s+(?:preferences?|memor(?:y|ies)|context|data|profile|history)\b|\b(?:preferences|patterns)\s+(?:about|for|on|regarding|related to)\b|\btravel patterns\b/i
export function isInternalPlanStepReminder(message: unknown): boolean {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  return PLAN_STEP_VERB.test(text) && PLAN_STEP_OBJECT.test(text)
}

/**
 * Whether a REMINDER: line the chat model wrote may be saved. Never for a plan-step-shaped message,
 * and never on an internal planner step (a read instruction such as "Retrieve saved preferences
 * about …") unless that step itself asks for a reminder. A user's own turn is unchanged. Pure.
 */
export function mayExecuteChatReminderDirective(input: { internalStep?: boolean; text: string; message: unknown }): boolean {
  if (isInternalPlanStepReminder(input.message)) return false
  if (input.internalStep && !/\bremind(?:er|ers)?\b|\bremind\s+me\b/i.test(String(input.text || ''))) return false
  return true
}
