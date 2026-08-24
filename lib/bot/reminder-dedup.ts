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
