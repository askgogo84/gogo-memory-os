import type { ReminderRow } from './queries'

// ── The Today thread, computed ────────────────────────────────────────────────
// Pure functions only — no Supabase, no React. Given today's rows and "now", this
// produces the model the spine renders: past nodes, the single now-marker with a
// computed gap line, and upcoming nodes. Kept DB- and DOM-free so the marker and
// gap-line rules can be unit-tested without a database or a browser.

// Fallback display zone when the user has no stored timezone. India is the
// overwhelming default; the marker and every node share whatever zone the caller
// resolves, so the spine is one continuous scale (see buildThread's `tz`).
const DEFAULT_TZ = 'Asia/Kolkata'
// Below this, the next reminder is close enough that a "nothing for a while" line
// would be a lie — so we render no gap line at all.
const IMMINENT_MIN = 10

export type ThreadNode = {
  id: string
  label: string
  /** h:mm with a tight lowercase period, e.g. "9:00am". */
  timeLabel: string
  /**
   * "Every Sunday", "Every day", … for recurring rows; null otherwise. When
   * this node collapses a run of past occurrences, the count is folded in here,
   * e.g. "Hourly · 9 done today".
   */
  seriesMeta: string | null
  /** Fired, or its time has passed — rendered muted + struck. */
  past: boolean
  /** How many occurrences this node stands for. 1 for a normal node; >1 when a
   * run of past occurrences of one series is collapsed into this node. */
  count: number
}

export type ThreadModel = {
  before: ThreadNode[]
  /** Current time in IST, e.g. "1:58pm". */
  nowLabel: string
  /** The line under the marker, or null when the next reminder is imminent. */
  gapLine: string | null
  after: ThreadNode[]
}

const HOUR_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

// h:mm with a tight, lowercase period — "9:00am", "12:00pm", "4:16pm". On a real
// phone the bare 12-hour numbers (9, 10, 11, 12, 1, 2…) read as ambiguous, so the
// period label is mandatory. No space before it, and digits stay tabular in the
// component so the column still lines up.
function formatTime(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso))
  const hour = parts.find((p) => p.type === 'hour')?.value ?? ''
  const minute = parts.find((p) => p.type === 'minute')?.value ?? ''
  const period = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toLowerCase()
  return `${hour}:${minute}${period}`
}

// The reminder label as the user set it, minus a leading "to " ("remind me to
// call Amma" was stored as "to call Amma" on some paths).
function cleanLabel(message: string | null): string {
  const s = (message || '').replace(/^to\s+/i, '').trim()
  return s || 'Reminder'
}

// Humanize the stored recurring_pattern into one calm line. Vocabulary mirrors
// getNextOccurrence in the cron: daily/weekly, weekday names, every_Nh/Nd,
// hourly_between, followup:. Unknown shapes fall back to a neutral "Repeats".
function describeRecurrence(pattern: string | null): string | null {
  if (!pattern) return null
  const p = pattern.toLowerCase()
  if (p.startsWith('followup:')) return 'Follow-up'
  let m: RegExpMatchArray | null
  if ((m = p.match(/^every_(\d+)(h|d)\b/))) {
    const n = parseInt(m[1], 10)
    if (m[2] === 'h') return n === 1 ? 'Every hour' : `Every ${n} hours`
    return n === 1 ? 'Every day' : `Every ${n} days`
  }
  if (p.includes('hourly_between')) return 'Hourly'
  if (p.includes('daily') || p.includes('every day')) return 'Every day'
  if (p.includes('weekly') || p.includes('every week')) return 'Every week'
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  for (const d of days) {
    if (p.includes(d)) return `Every ${d[0].toUpperCase()}${d.slice(1)}`
  }
  return 'Repeats'
}

// The one line under the now-marker. Callers only reach this when the next
// reminder is NOT imminent, so it never rounds down to "0".
function gapLine(gapMin: number): string {
  if (gapMin < 60) {
    const mins = Math.max(5, Math.round(gapMin / 5) * 5)
    return `Nothing for the next ${mins} minutes.`
  }
  const hours = Math.round(gapMin / 60)
  if (hours === 1) return 'Nothing for the next hour.'
  const word = hours <= 12 ? HOUR_WORDS[hours] : String(hours)
  return `Nothing for the next ${word} hours.`
}

function toNode(row: ReminderRow, past: boolean, tz: string): ThreadNode {
  return {
    id: String(row.id),
    label: cleanLabel(row.message),
    timeLabel: formatTime(row.remind_at, tz),
    seriesMeta: row.is_recurring ? describeRecurrence(row.recurring_pattern) : null,
    past,
    count: 1,
  }
}

// The identity of the recurring series a row belongs to, or null if the row can
// never collapse. There is no series_id column on reminders (each occurrence is
// its own row — see the cron's next-occurrence insert), so we fall back to
// (message + recurring_pattern): same wording AND same cadence is our best proxy
// for "same series". Non-recurring rows return null so they always stand alone —
// two one-off reminders that happen to share wording are NOT a series. A NUL
// joins the two fields so a space in one can't bleed into the other.
function seriesKey(row: ReminderRow): string | null {
  if (!row.is_recurring) return null
  return `${row.message ?? ''}\u0000${row.recurring_pattern ?? ''}`
}

// Collapse each run of CONSECUTIVE past occurrences of one series into a single
// node — otherwise a day of "Drink water / Hourly" buries the one upcoming
// reminder and shoves the now-marker off the first screen. The run must be
// adjacent in time: any other reminder in between breaks it, so the spine still
// tells the truth about ordering. A run of one stays a normal node (no "· 1
// done"). The collapsed node is timed at the MOST RECENT occurrence (rows are
// sorted ascending, so that's the last in the run) and folds the count into its
// meta line: "Hourly · 9 done today".
function collapsePast(rows: ReminderRow[], tz: string): ThreadNode[] {
  const out: ThreadNode[] = []
  let i = 0
  while (i < rows.length) {
    const key = seriesKey(rows[i])
    if (key === null) {
      out.push(toNode(rows[i], true, tz))
      i++
      continue
    }
    let j = i + 1
    while (j < rows.length && seriesKey(rows[j]) === key) j++
    const count = j - i
    if (count === 1) {
      out.push(toNode(rows[i], true, tz))
    } else {
      const node = toNode(rows[j - 1], true, tz) // most recent occurrence
      node.count = count
      node.seriesMeta = node.seriesMeta
        ? `${node.seriesMeta} · ${count} done today`
        : `${count} done today`
      out.push(node)
    }
    i = j
  }
  return out
}

/**
 * Split today's rows around the now-marker. `rows` must already be sorted by
 * remind_at ascending (the query does this). A row is "past" if it has fired
 * (sent) or its time has slipped by; everything else is upcoming.
 *
 * `tz` is the user's CURRENT timezone and is applied to every node time AND the
 * now-marker — one zone for the whole spine, so positions and labels agree. A
 * row's own stored `remind_at` timezone records where it was set, not where the
 * user is now, so it never drives a spine time.
 */
export function buildThread(rows: ReminderRow[], now: Date, tz: string = DEFAULT_TZ): ThreadModel {
  const nowMs = now.getTime()
  // Past rows are collected raw, not yet turned into nodes: collapsePast needs
  // is_recurring / message / recurring_pattern to fold consecutive occurrences of
  // one series. Upcoming rows never collapse — the whole point of the thread is
  // what's still coming — so each becomes its own node immediately.
  const beforeRows: ReminderRow[] = []
  const after: ThreadNode[] = []
  let nextUpcomingMs: number | null = null

  for (const row of rows) {
    const t = new Date(row.remind_at).getTime()
    const past = row.sent === true || t <= nowMs
    if (past) {
      beforeRows.push(row)
    } else {
      after.push(toNode(row, false, tz))
      if (nextUpcomingMs === null) nextUpcomingMs = t
    }
  }

  const before = collapsePast(beforeRows, tz)

  let line: string | null
  if (nextUpcomingMs === null) {
    line = 'Nothing else today.'
  } else {
    const gapMin = (nextUpcomingMs - nowMs) / 60000
    line = gapMin < IMMINENT_MIN ? null : gapLine(gapMin)
  }

  return {
    before,
    nowLabel: formatTime(now.toISOString(), tz),
    gapLine: line,
    after,
  }
}
