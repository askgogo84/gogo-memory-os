import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  stopReminderSeries,
  skipReminderOccurrence,
  describeCadence,
  formatReminderTimeOfDay,
  formatReminderWhen,
} from '@/lib/services/reminder-series'

function istNowParts() {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00'

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

function istWallTimeToUtcDate(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0))
}

function addIstDays(parts: { year: number; month: number; day: number }, daysToAdd: number) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysToAdd, 0, 0, 0))

  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

function normalizeNumberWords(input: string) {
  const words: Record<string, string> = {
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
    ten: '10',
    fifteen: '15',
    twenty: '20',
    thirty: '30',
    forty: '40',
    fifty: '50',
    sixty: '60',
  }

  let out = input
  for (const [word, value] of Object.entries(words)) {
    out = out.replace(new RegExp(`\\b${word}\\b`, 'gi'), value)
  }
  return out
}

function parseTimePart(input: string): { hour: number; minute: number } | null {
  const match = input.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!match) return null

  let hour = parseInt(match[1], 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const ampm = match[3]?.toLowerCase()

  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0

  if (hour > 23 || minute > 59) return null

  return { hour, minute }
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

function cleanReminderName(message: string) {
  return (message || 'Reminder')
    .replace(/^to\s+/i, '')
    .trim()
}

function semanticReminderKey(reminder: any) {
  const text = cleanReminderName(reminder.message).toLowerCase()
  const time = formatWhen(reminder.remind_at)

  if (text.includes('top priority')) return `day-plan-priority|${time}`
  if (text.includes('calendar') && text.includes('follow')) return `day-plan-followups|${time}`
  if (text.includes('plan tomorrow') || text.includes('review the day') || text.includes('close pending')) {
    return `day-plan-evening-review|${time}`
  }

  return `${text}|${time}`
}

function dedupeReminders(reminders: any[]) {
  const seen = new Set<string>()
  const output: any[] = []

  for (const reminder of reminders) {
    const key = semanticReminderKey(reminder)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(reminder)
  }

  return output
}

function isDoneCommand(input: string) {
  const lower = input.toLowerCase().trim()

  return (
    lower === 'done' ||
    lower === 'mark done' ||
    lower === 'completed' ||
    lower === 'complete' ||
    lower === 'finished' ||
    lower === 'mark as done' ||
    /^done\s+\d+\b/i.test(lower) ||
    /^complete\s+\d+\b/i.test(lower) ||
    /^mark\s+\d+\s+done\b/i.test(lower)
  )
}

function isShowReminderCommand(input: string) {
  const lower = input.toLowerCase().trim()

  return (
    lower === 'show reminders' ||
    lower === 'show my reminders' ||
    lower === 'my reminders' ||
    lower === 'pending reminders' ||
    lower === 'active reminders' ||
    lower === 'list reminders' ||
    lower === 'what are my reminders' ||
    lower === 'what reminders do i have' ||
    lower.includes('show pending reminders')
  )
}

function isCancelReminderCommand(input: string) {
  const lower = input.toLowerCase().trim()

  return (
    /^cancel\b/i.test(lower) ||
    /^delete\b/i.test(lower) ||
    /^remove\b/i.test(lower) ||
    /^clear reminder\b/i.test(lower) ||
    /^stop reminder\b/i.test(lower)
  )
}

function isSnoozeOrMoveCommand(input: string) {
  const lower = input.toLowerCase().trim()

  return (
    /^snooze\b/i.test(lower) ||
    /^move it\b/i.test(lower) ||
    /^move reminder\b/i.test(lower) ||
    /^reschedule\b/i.test(lower) ||
    /^change it to\b/i.test(lower) ||
    lower === 'tomorrow instead'
  )
}

function extractReminderIndex(input: string) {
  const lower = normalizeNumberWords(input.toLowerCase().trim())
  const match = lower.match(/\b(\d+)\b/)
  if (!match) return null

  const index = parseInt(match[1], 10) - 1
  if (Number.isNaN(index) || index < 0) return null
  return index
}

// Stopwords stripped from a cancel query BEFORE matching. Recurrence adverbs
// ("daily", "every day") and determiners/pronouns ("the", "my") are not part of a
// reminder's stored name, yet reminderMatches requires every ≥3-char token to appear
// in that name — so an un-stripped "daily" or "the" makes a real match fail. Multi-word
// phrases must precede their single-word fragments so "every day" is consumed whole.
const CANCEL_STOPWORDS = [
  'every day', 'every week', 'every month', 'each day',
  'everyday', 'daily', 'weekly', 'monthly', 'yearly', 'hourly', 'repeating', 'recurring',
  'the', 'a', 'an', 'my', 'your', 'our', 'this', 'that', 'for', 'about', 'please',
]

// Returns the cleaned match query, or null when nothing meaningful survives stripping.
// Null is deliberate: an empty query must fall through to the numbered-list fallback
// rather than match every reminder — an over-eager cancel is worse than a miss.
export function extractCancelQuery(input: string): string | null {
  let out = input
    .replace(/^(cancel|delete|remove|clear|stop)\s+/i, '')
    .replace(/\breminder\b/gi, ' ')
  for (const w of CANCEL_STOPWORDS) {
    out = out.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ')
  }
  out = out.replace(/\s+/g, ' ').trim()
  return out.length ? out : null
}

export function reminderMatches(reminder: any, query: string) {
  const q = query.toLowerCase().trim()
  if (!q) return false

  const name = cleanReminderName(reminder.message).toLowerCase()

  if (name.includes(q)) return true

  const tokens = q.split(/\s+/).filter((token) => token.length >= 3)
  return tokens.length > 0 && tokens.every((token) => name.includes(token))
}

export async function getLatestPendingReminder(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('reminders')
    .select('id, message, remind_at, sent, created_at')
    .eq('telegram_id', telegramId)
    .eq('sent', false)
    .order('created_at', { ascending: false })
    .limit(1)

  return data?.[0] || null
}

export async function getLatestActionableReminder(telegramId: number) {
  const now = Date.now()
  const firedCut = new Date(now - 6 * 60 * 60 * 1000).toISOString()
  const createdCut = new Date(now - 60 * 60 * 1000).toISOString()
  const cols = 'id, message, remind_at, sent, sent_at, created_at, recurring_pattern'

  // The reminder that most recently NUDGED the user.
  const { data: fired } = await supabaseAdmin
    .from('reminders').select(cols)
    .eq('telegram_id', telegramId).not('sent_at', 'is', null).gte('sent_at', firedCut)
    .order('sent_at', { ascending: false }).limit(1)

  // The reminder the user most recently SET.
  const { data: created } = await supabaseAdmin
    .from('reminders').select(cols)
    .eq('telegram_id', telegramId).gte('created_at', createdCut)
    .order('created_at', { ascending: false }).limit(1)

  const f = fired?.[0], cr = created?.[0]
  if (f && cr) return new Date(f.sent_at).getTime() >= new Date(cr.created_at).getTime() ? f : cr
  return f || cr || null
}

// When a follow-up is marked done, cancel its pending next nudge so the chain stops.
// Exported so the dashboard's deleteReminderById can stop the chain too — a deleted
// follow-up must not keep nagging from its already-queued next occurrence.
export async function cancelFollowupChain(telegramId: number, pattern: string | null | undefined) {
  if (!pattern || !String(pattern).startsWith('followup:')) return
  await supabaseAdmin.from('reminders').update({ sent: true })
    .eq('telegram_id', telegramId).eq('recurring_pattern', pattern).eq('sent', false)
}

export async function getActiveReminders(telegramId: number, limit = 10) {
  // Active = still coming. A recurring series is always kept (its pending occurrence
  // is current or future). A one-off is kept only if its time hasn't long passed —
  // a reminder dated months ago that never fired is stale (the cron would have sent
  // or abandoned it), so it must not keep showing in "my reminders". 24h grace covers
  // cron lag / a just-missed fire. Filter + slice in JS to avoid PostgREST .or()
  // value-quoting fragility on the ISO timestamp.
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000
  const { data } = await supabaseAdmin
    .from('reminders')
    .select('id, message, remind_at, sent, sent_at, created_at, recurring_pattern, is_recurring')
    .eq('telegram_id', telegramId)
    .eq('sent', false)
    .order('remind_at', { ascending: true })
    .limit(100)

  const active = (data || []).filter(
    (r: any) => r.is_recurring === true || new Date(r.remind_at).getTime() >= cutoffMs,
  )
  return dedupeReminders(active).slice(0, limit)
}

export async function showActiveReminders(telegramId: number) {
  const reminders = await getActiveReminders(telegramId, 10)

  if (!reminders.length) {
    return (
      `⏰ *Your reminders*\n\n` +
      `No active reminders right now.\n\n` +
      `Try:\n` +
      `• Remind me in 10 mins to drink water\n` +
      `• Remind me tomorrow at 9 am to call Rahul`
    )
  }

  return (
    `⏰ *Your active reminders*\n\n` +
    reminders
      .map((reminder: any, idx: number) => {
        return `${idx + 1}. ${cleanReminderName(reminder.message)} — ${formatWhen(reminder.remind_at)}`
      })
      .join('\n') +
    `\n\nReply with:\n` +
    `• cancel 1\n` +
    `• done 2\n` +
    `• snooze 3 for 10 mins\n` +
    `• cancel water reminder`
  )
}

async function updateReminderSent(reminder: any, sent: boolean) {
  const { error } = await supabaseAdmin
    .from('reminders')
    .update({ sent })
    .eq('id', reminder.id)

  if (error) console.error('REMINDER_SENT_UPDATE_FAILED:', reminder.id, error.message)
  return !error
}

export async function cancelReminder(telegramId: number, input: string) {
  const reminders = await getActiveReminders(telegramId, 20)

  if (!reminders.length) {
    return `No active reminders to cancel.`
  }

  const lower = normalizeNumberWords(input.toLowerCase().trim())
  let reminder: any | null = null

  const index = extractReminderIndex(lower)
  if (index !== null) {
    reminder = reminders[index] || null
  }

  if (!reminder) {
    const query = extractCancelQuery(lower)
    if (query) reminder = reminders.find((item: any) => reminderMatches(item, query)) || null
  }

  if (!reminder) {
    return (
      `I couldn’t find that reminder.\n\n` +
      `Your active reminders:\n` +
      reminders
        .slice(0, 5)
        .map((item: any, idx: number) => `${idx + 1}. ${cleanReminderName(item.message)} — ${formatWhen(item.remind_at)}`)
        .join('\n') +
      `\n\nTry: *cancel 1* or *cancel water reminder*.`
    )
  }

  // CANCEL = end the whole series (recurring) or remove the one-off. Shared with the
  // dashboard's Stop action so both surfaces behave identically.
  const res = await stopReminderSeries(telegramId, reminder)

  if (!res.ok) {
    return `I couldn’t cancel that reminder right now.`
  }

  const name = cleanReminderName(reminder.message)
  if (res.wasRecurring) {
    const cadence = describeCadence(reminder.recurring_pattern)
    return (
      `🛑 *Stopped* your ${cadence} *${name}* reminder at ${formatReminderTimeOfDay(reminder.remind_at)}.\n\n` +
      `It won’t repeat anymore. Say *skip* next time if you only want to miss one.`
    )
  }
  return `🗑️ *Cancelled* *${name}*\n${formatReminderWhen(reminder.remind_at)}`
}

function isSkipReminderCommand(input: string) {
  const lower = input.toLowerCase().trim()
  return /^skip\b/i.test(lower) || lower === 'not today'
}

// Skip-query stripping mirrors extractCancelQuery but also drops the skip verbs and
// day words ("skip today drink water" → "drink water"). Null → fall through to the
// single-recurring default / numbered-list ask rather than matching everything.
export function extractSkipQuery(input: string): string | null {
  let out = input
    .replace(/^skip\s+/i, '')
    .replace(/^not\s+today\b/i, '')
    .replace(/\b(today|tomorrow|tonight)\b/gi, ' ')
    .replace(/\breminder\b/gi, ' ')
  for (const w of CANCEL_STOPWORDS) {
    out = out.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ')
  }
  out = out.replace(/\s+/g, ' ').trim()
  return out.length ? out : null
}

export async function skipReminder(telegramId: number, input: string) {
  const reminders = await getActiveReminders(telegramId, 20)

  if (!reminders.length) {
    return `No active reminders to skip.`
  }

  const lower = normalizeNumberWords(input.toLowerCase().trim())
  let reminder: any | null = null

  const index = extractReminderIndex(lower)
  if (index !== null) {
    reminder = reminders[index] || null
  }

  if (!reminder) {
    const query = extractSkipQuery(lower)
    if (query) reminder = reminders.find((item: any) => reminderMatches(item, query)) || null
  }

  // "skip" / "skip today" / "not today" with nothing else: if there's exactly one
  // repeating reminder, that's unambiguous — skip it.
  if (!reminder) {
    const recurringOnes = reminders.filter((item: any) => item.is_recurring === true)
    if (recurringOnes.length === 1) reminder = recurringOnes[0]
  }

  if (!reminder) {
    return (
      `Which reminder should I skip?\n\n` +
      reminders
        .slice(0, 5)
        .map((item: any, idx: number) => `${idx + 1}. ${cleanReminderName(item.message)} — ${formatWhen(item.remind_at)}`)
        .join('\n') +
      `\n\nTry: *skip 1* or *skip water reminder*.`
    )
  }

  const res = await skipReminderOccurrence(telegramId, reminder)

  if (res.notRecurring) {
    return `*${cleanReminderName(reminder.message)}* is a one-off reminder, not a repeating one.\n\nSay *cancel* to remove it, or *snooze* to push it.`
  }
  if (!res.ok || !res.next) {
    return `I couldn’t skip that reminder right now.`
  }

  const cadence = describeCadence(reminder.recurring_pattern)
  return (
    `⏭️ *Skipped* *${cleanReminderName(reminder.message)}* this time.\n` +
    `Your ${cadence} reminder is back ${formatReminderWhen(res.next)}.`
  )
}

export async function markLatestReminderDone(telegramId: number, input?: string) {
  const lower = normalizeNumberWords((input || '').toLowerCase().trim())
  const reminders = await getActiveReminders(telegramId, 20)
  const index = extractReminderIndex(lower)

  let reminder = index !== null ? reminders[index] : null

  if (!reminder) {
    reminder = await getLatestActionableReminder(telegramId)
  }

  if (!reminder) {
    return `No recent reminder found.`
  }

  const ok = await updateReminderSent(reminder, true)

  if (!ok) {
    return `I couldn't mark that reminder done right now.`
  }

  await cancelFollowupChain(telegramId, reminder.recurring_pattern)

  return `✅ *Marked done*\n\n${cleanReminderName(reminder.message)}`
}

export async function editLatestReminder(telegramId: number, input: string) {
  const lower = normalizeNumberWords(input.toLowerCase().trim())

  if (isShowReminderCommand(lower)) {
    return await showActiveReminders(telegramId)
  }

  if (isCancelReminderCommand(lower)) {
    return await cancelReminder(telegramId, lower)
  }

  if (isSkipReminderCommand(lower)) {
    return await skipReminder(telegramId, lower)
  }

  if (isDoneCommand(lower)) {
    return await markLatestReminderDone(telegramId, lower)
  }

  let reminder: any | null = null
  const reminderIndex = extractReminderIndex(lower)

  if (reminderIndex !== null && (isSnoozeOrMoveCommand(lower) || /^snooze\s+\d+\s+for\b/i.test(lower))) {
    const reminders = await getActiveReminders(telegramId, 20)
    reminder = reminders[reminderIndex] || null
  }

  if (!reminder) {
    reminder = await getLatestPendingReminder(telegramId)
  }

  if (!reminder && isSnoozeOrMoveCommand(lower)) {
    reminder = await getLatestActionableReminder(telegramId)
  }

  if (!reminder) {
    return `No recent reminder found.\n\nCreate one first, then say:\n• show my reminders\n• cancel 1\n• done 2\n• snooze 3 for 10 mins\n• move it to 8 pm`
  }

  let nextTime = new Date(reminder.remind_at)

  const indexedSnoozeMatch = lower.match(/snooze\s+\d+\s+(?:for\s+)?(\d+)\s*(minute|minutes|min|mins|hour|hours)/i)
  const regularSnoozeMatch = lower.match(/snooze\s+(?:for\s+)?(\d+)\s*(minute|minutes|min|mins|hour|hours)/i)
  const snoozeMatch = indexedSnoozeMatch || regularSnoozeMatch

  if (snoozeMatch) {
    const value = parseInt(snoozeMatch[1], 10)
    const unit = snoozeMatch[2].toLowerCase()

    if (unit.startsWith('hour')) {
      nextTime = new Date(Date.now() + value * 60 * 60 * 1000)
    } else {
      nextTime = new Date(Date.now() + value * 60 * 1000)
    }
  } else if (lower === 'tomorrow instead') {
    nextTime = new Date(Date.now() + 24 * 60 * 60 * 1000)
  } else if (
    /^move it to\b/i.test(lower) ||
    /^change it to\b/i.test(lower) ||
    /^reschedule\b/i.test(lower) ||
    /^move reminder to\b/i.test(lower)
  ) {
    const time = parseTimePart(lower)

    if (!time) {
      return `I couldn't understand the new time.\n\nTry: “move it to 8 pm”.`
    }

    const nowIst = istNowParts()

    let targetDate = {
      year: nowIst.year,
      month: nowIst.month,
      day: nowIst.day,
    }

    const currentMinutes = nowIst.hour * 60 + nowIst.minute
    const targetMinutes = time.hour * 60 + time.minute

    if (targetMinutes <= currentMinutes) {
      targetDate = addIstDays(nowIst, 1)
    }

    nextTime = istWallTimeToUtcDate(
      targetDate.year,
      targetDate.month,
      targetDate.day,
      time.hour,
      time.minute
    )
  } else {
    return `I couldn't understand how to update that reminder.\n\nTry:\n• show my reminders\n• cancel 1\n• cancel water reminder\n• done 2\n• snooze 3 for 10 mins\n• move it to 8 pm`
  }

  const { error } = await supabaseAdmin
    .from('reminders')
    .update({
      remind_at: nextTime.toISOString(),
      sent: false,
    })
    .eq('id', reminder.id)

  if (error) {
    console.error('REMINDER_RESCHEDULE_UPDATE_FAILED:', reminder.id, error.message)
    return `I couldn't update that reminder right now.`
  }

  return `✅ *Reminder updated*\n\n${cleanReminderName(reminder.message)}\nNew time: ${formatWhen(nextTime.toISOString())}`
}
