// Verifies recurring-reminder dedup keys on (pattern + time-of-day), not pattern
// alone. Regression: "drink water every day at 9am" then "…at 6pm" both normalise to
// pattern 'daily'; with a pattern-only key the 6pm create matched the 9am row as a
// "duplicate" and overwrote it in place, leaving ONE row instead of two.
// Run: npx tsx scripts/verify-reminder-dedup.mts
//
// Imports the REAL shipped pickRecurringDuplicate so test and prod can't drift, and
// models createReminder's own dedup branch: a hit overwrites remind_at in place, a
// miss inserts a new row.
import { pickRecurringDuplicate, reminderTimeOfDayUTC } from '../lib/bot/reminder-dedup'

type Row = { id: number; recurring_pattern: string; remind_at: string }

// 9am and 6pm IST expressed as the UTC instants the writer stores (IST = UTC+5:30).
const NINE_AM_IST = '2026-08-25T03:30:00.000Z' // 09:00 IST
const SIX_PM_IST = '2026-08-25T12:30:00.000Z' // 18:00 IST

// Model of createReminder's recurring branch against an in-memory store.
function simulateCreate(store: Row[], pattern: string, remindAt: string) {
  const candidates = store.filter((r) => r.recurring_pattern === pattern)
  const dup = pickRecurringDuplicate(candidates, remindAt)
  if (dup) {
    dup.remind_at = remindAt // existing behaviour: overwrite the matched row in place
  } else {
    store.push({ id: store.length + 1, recurring_pattern: pattern, remind_at: remindAt })
  }
}

let fails = 0
function check(label: string, cond: boolean) {
  if (!cond) fails++
  console.log(`  ${cond ? '✓' : '✗'}  ${label}`)
}

console.log('\nRecurring reminder dedup — pattern + time-of-day\n')

// Case 1: two daily reminders at different times → TWO distinct rows, times preserved.
{
  const store: Row[] = []
  simulateCreate(store, 'daily', NINE_AM_IST)
  simulateCreate(store, 'daily', SIX_PM_IST)
  check('daily-9am then daily-6pm → TWO rows', store.length === 2)
  const times = store.map((r) => reminderTimeOfDayUTC(r.remind_at)).sort()
  check('rows keep their own times (03:30 & 12:30 UTC)', times[0] === '03:30' && times[1] === '12:30')
}

// Case 2: the same daily reminder created twice → still ONE row (real duplicate).
{
  const store: Row[] = []
  simulateCreate(store, 'daily', NINE_AM_IST)
  simulateCreate(store, 'daily', NINE_AM_IST)
  check('daily-9am twice → ONE row (dedup still works)', store.length === 1)
}

console.log(`\n${fails === 0 ? '✅ all cases passed' : `❌ ${fails} case(s) failed`}\n`)
process.exit(fails === 0 ? 0 : 1)
