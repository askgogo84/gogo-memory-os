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

export async function editLatestReminder(telegramId: number, input: string) {
  const reminder = await getLatestPendingReminder(telegramId)
  if (!reminder) {
    return `I couldn't find any pending reminder to update.`
  }

  const lower = input.toLowerCase()
  let nextTime = new Date(reminder.remind_at)

  const snoozeMatch = lower.match(/snooze\s+(\d+)\s*(minute|minutes|min|mins|hour|hours)/i)
  if (snoozeMatch) {
    const value = parseInt(snoozeMatch[1], 10)
    const unit = snoozeMatch[2].toLowerCase()
    if (unit.startsWith('hour')) nextTime = new Date(nextTime.getTime() + value * 60 * 60 * 1000)
    else nextTime = new Date(nextTime.getTime() + value * 60 * 1000)
  } else if (lower === 'tomorrow instead') {
    nextTime = new Date(nextTime.getTime() + 24 * 60 * 60 * 1000)
  } else if (/^move it to\b/i.test(lower) || /^change it to\b/i.test(lower) || /^reschedule\b/i.test(lower)) {
    const time = parseTimePart(lower)
    if (!time) {
      return `I couldn't understand the new time. Try something like "move it to 6 pm".`
    }

    const nowIst = istNowParts()
    let targetDate = { year: nowIst.year, month: nowIst.month, day: nowIst.day }
    const currentMinutes = nowIst.hour * 60 + nowIst.minute
    const targetMinutes = time.hour * 60 + time.minute

    if (targetMinutes <= currentMinutes) {
      targetDate = addIstDays(nowIst, 1)
    }

    nextTime = istWallTimeToUtcDate(targetDate.year, targetDate.month, targetDate.day, time.hour, time.minute)
  } else {
    return `I couldn't understand how to update that reminder. Try "snooze 10 mins" or "move it to 6 pm".`
  }

  const { error } = await supabaseAdmin
    .from('reminders')
    .update({ remind_at: nextTime.toISOString() })
    .eq('id', reminder.id)

  if (error) {
    return `I couldn't update that reminder right now.`
  }

  return `Done — I’ve updated your reminder to ${formatWhen(nextTime.toISOString())}.`
}
