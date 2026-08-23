import { supabaseAdmin } from '@/lib/supabase-admin'

// ── Shared reminder series/occurrence primitives ──────────────────────────────
// ONE implementation of stop-series and skip-occurrence, used by BOTH surfaces
// (WhatsApp NL handlers + the dashboard write layer). Two implementations is how
// cancel semantics diverged in the first place (WhatsApp marked one row sent, the
// dashboard hard-deleted the only pending row — opposite bugs, same root cause).
//
// THE MODEL:
//   CANCEL / STOP  = end the whole series.
//   SKIP           = this occurrence only; the series keeps regenerating.

// Interval cadence, parsed from EITHER stored shape so the advance math and the
// humanizer can't disagree about what a pattern means:
//   compact  — every_2h / every_2d          (LLM path)
//   verbose  — every_2_hours / every_15_minutes / every_3_days   (the create parser)
// The create parser only ever writes the verbose form, so getNextOccurrence MUST read
// it — otherwise a verbose interval falls through to the default +1 day and silently
// recurs daily. Minutes are interval-only (no compact minute form). Returns null when
// the pattern is not an interval.
function parseIntervalPattern(pattern: string): { n: number; unit: 'minute' | 'hour' | 'day' } | null {
  const m = pattern.toLowerCase().match(/^every_(\d+)_?(h|hours?|d|days?|m|mins?|minutes?)\b/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  const u = m[2]
  const unit = u.startsWith('d') ? 'day' : u.startsWith('h') ? 'hour' : 'minute'
  return { n, unit }
}

// Next-occurrence math for a recurring pattern. MOVED VERBATIM from the reminders
// cron (app/api/cron/reminders/route.ts) so skip advances a series EXACTLY the way
// the cron advances it — one implementation, no drift. The cron now imports this.
// Do not change the body without changing the cron's expectations in lockstep.
export function getNextOccurrence(pattern: string, fromDate: Date): Date {
  const next = new Date(fromDate)
  const lower = pattern.toLowerCase()

  // Follow-up cadence: followup:<interval>:<message>  e.g. followup:2h:..., followup:1d:...
  const fu = lower.match(/^followup:(\d+)(h|d):/)
  if (fu) {
    const n = parseInt(fu[1], 10)
    if (fu[2] === 'h') next.setHours(next.getHours() + n)
    else next.setDate(next.getDate() + n)
    return next
  }

  const iv = parseIntervalPattern(lower)
  if (iv) {
    if (iv.unit === 'day') next.setDate(next.getDate() + iv.n)
    else if (iv.unit === 'hour') next.setHours(next.getHours() + iv.n)
    else next.setMinutes(next.getMinutes() + iv.n)
    return next
  }

  if (lower.includes('hourly_between')) {
    const m = lower.match(/hourly_between:(\d{2}):(\d{2})-(\d{2}):(\d{2})/)
    const IST = 5.5 * 60 * 60 * 1000
    const istNext = new Date(next.getTime() + IST + 60 * 60 * 1000)
    if (m) {
      const sH = +m[1], sM = +m[2], eH = +m[3], eM = +m[4]
      const h = istNext.getUTCHours(), mm = istNext.getUTCMinutes()
      const pastEnd = h > eH || (h === eH && mm > eM)
      const beforeStart = h < sH || (h === sH && mm < sM)
      if (pastEnd || beforeStart) { if (pastEnd) istNext.setUTCDate(istNext.getUTCDate() + 1); istNext.setUTCHours(sH, sM, 0, 0) }
    }
    return new Date(istNext.getTime() - IST)
  }
  if (lower.includes('every day') || lower.includes('daily')) next.setDate(next.getDate() + 1)
  else if (lower.includes('every week') || lower.includes('weekly')) next.setDate(next.getDate() + 7)
  else if (lower.includes('monday')) next.setDate(next.getDate() + ((1 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('tuesday')) next.setDate(next.getDate() + ((2 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('wednesday')) next.setDate(next.getDate() + ((3 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('thursday')) next.setDate(next.getDate() + ((4 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('friday')) next.setDate(next.getDate() + ((5 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('saturday')) next.setDate(next.getDate() + ((6 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('sunday')) next.setDate(next.getDate() + ((0 + 7 - next.getDay()) % 7 || 7))
  else next.setDate(next.getDate() + 1)

  return next
}

export function cleanReminderName(message: string): string {
  return (message || 'Reminder').replace(/^to\s+/i, '').trim()
}

// ONE humanizer for a recurring pattern, two renderings — so the dashboard chip, the
// WhatsApp stop/skip copy, and the cron never drift into separate vocabularies:
//   'sentence' (default) — lower-case, reads inside a line: "daily at 9:00 am",
//                          "every Monday", "every 2 hours". WhatsApp + create copy.
//   'label'              — Title-case chip: "Every day", "Every Monday", "Hourly".
//                          Matches the dashboard series chip EXACTLY as shipped.
// The two styles share the SAME detection; only the wording differs.
export function describeCadence(
  pattern: string | null | undefined,
  style: 'sentence' | 'label' = 'sentence',
): string {
  const label = style === 'label'
  const p = String(pattern || '').toLowerCase()
  if (!p) return label ? 'Repeats' : 'repeating'
  if (p.startsWith('followup:')) return label ? 'Follow-up' : 'follow-up'
  if (p.includes('hourly_between')) return label ? 'Hourly' : 'hourly'
  const iv = parseIntervalPattern(p)
  if (iv) {
    // The dashboard chip drops the count for n===1 ("Every day", "Every hour"); the
    // sentence form keeps it ("every 1 day") as it always has.
    if (label) return iv.n === 1 ? `Every ${iv.unit}` : `Every ${iv.n} ${iv.unit}s`
    return `every ${iv.n} ${iv.n === 1 ? iv.unit : iv.unit + 's'}`
  }
  if (p.includes('every day') || p.includes('daily')) return label ? 'Every day' : 'daily'
  if (p.includes('every week') || p.includes('weekly')) return label ? 'Every week' : 'weekly'
  if (p.includes('every month') || p.includes('monthly')) return label ? 'Every month' : 'monthly'
  for (const d of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    if (p.includes(d)) {
      const day = `${d[0].toUpperCase()}${d.slice(1)}`
      return label ? `Every ${day}` : `every ${day}`
    }
  }
  return label ? 'Repeats' : 'repeating'
}

// IST year of a date, used to decide whether to print the year (see below).
function istYear(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(d))
}

// Full date+time in IST, e.g. "Tue, 26 Aug, 9:00 am". The year is shown ONLY when it
// isn't the current year, so a far-future reminder ("Fri, 18 Jun 2027, 5:00 pm") can't
// masquerade as a stale/imminent one — same-year output is unchanged.
export function formatReminderWhen(iso: string): string {
  const target = new Date(iso)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short',
    ...(istYear(target) !== istYear(new Date()) ? { year: 'numeric' } : {}),
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(target)
}

// Time-of-day only in IST, e.g. "9:00 am" — for recurring confirmations where the
// date is meaningless ("your daily reminder at 9:00 am").
export function formatReminderTimeOfDay(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso))
}

type SeriesRow = {
  id: string
  message?: string
  remind_at?: string
  is_recurring?: boolean | null
  recurring_pattern?: string | null
}

export type StopSeriesResult = { ok: boolean; affected: number; wasRecurring: boolean }

// CANCEL / STOP = end the whole series. For a recurring reminder this neutralises
// EVERY pending occurrence (normally one, but dedupe gaps can leave more) AND clears
// is_recurring/recurring_pattern so the cron can never spawn another — the cron only
// advances a series when a sent=false row fires, so clearing the live rows ends it.
// Already-FIRED rows (sent=true) are the audit trail and are left untouched: they
// never re-fire (the cron selects sent=false) and never advance. For a one-off it
// marks the single row sent. Scoped by (telegram_id, message, recurring_pattern) to
// bound the blast radius to exactly this series.
export async function stopReminderSeries(telegramId: number, reminder: SeriesRow): Promise<StopSeriesResult> {
  const recurring = !!reminder.is_recurring && !!reminder.recurring_pattern
  if (recurring) {
    const { data, error } = await supabaseAdmin
      .from('reminders')
      .update({ sent: true, is_recurring: false, recurring_pattern: null })
      .eq('telegram_id', telegramId)
      .eq('message', reminder.message)
      .eq('recurring_pattern', reminder.recurring_pattern)
      .eq('sent', false)
      .select('id')
    if (error) {
      console.error('STOP_SERIES_FAILED:', reminder.id, error.message)
      return { ok: false, affected: 0, wasRecurring: true }
    }
    return { ok: true, affected: data?.length || 0, wasRecurring: true }
  }
  const { error } = await supabaseAdmin
    .from('reminders')
    .update({ sent: true })
    .eq('telegram_id', telegramId)
    .eq('id', reminder.id)
    .eq('sent', false)
  if (error) {
    console.error('STOP_ONEOFF_FAILED:', reminder.id, error.message)
    return { ok: false, affected: 0, wasRecurring: false }
  }
  return { ok: true, affected: 1, wasRecurring: false }
}

export type SkipResult = { ok: boolean; next: string | null; notRecurring?: boolean }

// SKIP = this occurrence only; the series keeps going. Advances the pending row's
// remind_at to the NEXT occurrence IN PLACE (sent stays false, is_recurring stays
// true) so the cron still fires it later and then advances normally. This is the
// safe way to skip — simply marking the row sent would stop the cron from ever
// advancing the series, because the cron only advances when a sent=false row fires.
export async function skipReminderOccurrence(telegramId: number, reminder: SeriesRow): Promise<SkipResult> {
  if (!reminder.is_recurring || !reminder.recurring_pattern || !reminder.remind_at) {
    return { ok: false, next: null, notRecurring: true }
  }
  const next = getNextOccurrence(reminder.recurring_pattern, new Date(reminder.remind_at))
  const { error } = await supabaseAdmin
    .from('reminders')
    .update({ remind_at: next.toISOString(), sent: false })
    .eq('telegram_id', telegramId)
    .eq('id', reminder.id)
  if (error) {
    console.error('SKIP_OCCURRENCE_FAILED:', reminder.id, error.message)
    return { ok: false, next: null }
  }
  return { ok: true, next: next.toISOString() }
}
