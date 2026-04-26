import { supabaseAdmin } from '@/lib/supabase-admin'

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

function isDoneCommand(input: string) {
  const lower = input.toLowerCase().trim()

  return (
    lower === 'done' ||
    lower === 'mark done' ||
    lower === 'completed' ||
    lower === 'complete' ||
    lower === 'finished' ||
    lower === 'mark as done'
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

function extractCancelQuery(input: string) {
  return input
    .replace(/^(cancel|delete|remove|clear|stop)\s+/i, '')
    .replace(/^reminder\s+/i, '')
    .replace(/\breminder\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function reminderMatches(reminder: any, query: string) {
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
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { data } = await supabaseAdmin
    .from('reminders')
    .select('id, message, remind_at, sent, created_at')
    .eq('telegram_id', telegramId)
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(1)

  return data?.[0] || null
}

export async function getActiveReminders(telegramId: number, limit = 10) {
  const { data } = await supabaseAdmin
    .from('reminders')
    .select('id, message, remind_at, sent, created_at')
    .eq('telegram_id', telegramId)
    .eq('sent', false)
    .order('remind_at', { ascending: true })
    .limit(limit)

  return data || []
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
    `\n\nYou can say:\n` +
    `• cancel 1\n` +
    `• cancel water reminder\n` +
    `• done\n` +
    `• snooze 10 mins`
  )
}

export async function cancelReminder(telegramId: number, input: string) {
  const reminders = await getActiveReminders(telegramId, 20)

  if (!reminders.length) {
    return `No active reminders to cancel.`
  }

  const lower = normalizeNumberWords(input.toLowerCase().trim())
  const numberMatch = lower.match(/(?:cancel|delete|remove|clear|stop)\s+(\d+)\b/i)

  let reminder: any | null = null

  if (numberMatch) {
    const index = parseInt(numberMatch[1], 10) - 1
    reminder = reminders[index] || null
  }

  if (!reminder) {
    const query = extractCancelQuery(lower)
    reminder = reminders.find((item: any) => reminderMatches(item, query)) || null
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

  const { error } = await supabaseAdmin
    .from('reminders')
    .update({ sent: true })
    .eq('id', reminder.id)

  if (error) {
    return `I couldn’t cancel that reminder right now.`
  }

  return `🗑️ *Reminder cancelled*\n\n${cleanReminderName(reminder.message)}\n${formatWhen(reminder.remind_at)}`
}

export async function markLatestReminderDone(telegramId: number) {
  const reminder = await getLatestActionableReminder(telegramId)

  if (!reminder) {
    return `No recent reminder found.`
  }

  const { error } = await supabaseAdmin
    .from('reminders')
    .update({ sent: true })
    .eq('id', reminder.id)

  if (error) {
    return `I couldn't mark that reminder done right now.`
  }

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

  if (isDoneCommand(lower)) {
    return await markLatestReminderDone(telegramId)
  }

  let reminder = await getLatestPendingReminder(telegramId)

  if (!reminder && isSnoozeOrMoveCommand(lower)) {
    reminder = await getLatestActionableReminder(telegramId)
  }

  if (!reminder) {
    return `No recent reminder found.\n\nCreate one first, then say:\n• show my reminders\n• cancel 1\n• snooze 10 mins\n• move it to 8 pm\n• done`
  }

  let nextTime = new Date(reminder.remind_at)

  const snoozeMatch = lower.match(/snooze\s+(?:for\s+)?(\d+)\s*(minute|minutes|min|mins|hour|hours)/i)

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
    return `I couldn't understand how to update that reminder.\n\nTry:\n• show my reminders\n• cancel 1\n• cancel water reminder\n• snooze 10 mins\n• snooze for 5 minutes\n• move it to 8 pm\n• done`
  }

  const { error } = await supabaseAdmin
    .from('reminders')
    .update({
      remind_at: nextTime.toISOString(),
      sent: false,
    })
    .eq('id', reminder.id)

  if (error) {
    return `I couldn't update that reminder right now.`
  }

  return `✅ *Reminder updated*\n\n${cleanReminderName(reminder.message)}\nNew time: ${formatWhen(nextTime.toISOString())}`
}
