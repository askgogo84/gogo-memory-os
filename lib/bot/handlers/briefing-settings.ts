import { supabaseAdmin } from '@/lib/supabase-admin'

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

function formatTime(hour: number, minute: number) {
  const anchor = new Date(Date.UTC(2026, 0, 1, hour - 5, minute - 30, 0))
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(anchor)
}

function formatTimeValue(timeValue?: string | null) {
  const [hh, mm] = (timeValue || '08:00').split(':')
  return formatTime(Number(hh || 8), Number(mm || 0))
}

export function isBriefingSettingsCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()

  return (
    /set (my )?(daily |morning )?briefing (to|at)/i.test(lower) ||
    /briefing at \d/i.test(lower) ||
    /send (my )?(daily |morning )?briefing at/i.test(lower) ||
    lower === 'briefing status' ||
    lower === 'daily briefing status' ||
    lower === 'morning briefing status' ||
    lower === 'turn off daily briefing' ||
    lower === 'turn off morning briefing' ||
    lower === 'stop daily briefing' ||
    lower === 'stop morning briefing' ||
    lower === 'disable daily briefing' ||
    lower === 'disable morning briefing'
  )
}

export async function getBriefingStatus(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('users')
    .select('briefing_enabled, briefing_time')
    .eq('telegram_id', telegramId)
    .single()

  const enabled = Boolean(data?.briefing_enabled)
  const time = data?.briefing_time || '08:00'

  return (
    `☀️ *Daily briefing status*\n\n` +
    `Status: *${enabled ? 'On' : 'Off'}*\n` +
    `Time: *${formatTimeValue(time)}*\n\n` +
    `You can say:\n` +
    `• set briefing at 8 am\n` +
    `• set briefing at 9:30 am\n` +
    `• turn off daily briefing`
  )
}

export async function disableBriefing(telegramId: number) {
  const { error } = await supabaseAdmin
    .from('users')
    .update({ briefing_enabled: false })
    .eq('telegram_id', telegramId)

  if (error) return `I couldn't turn off your daily briefing right now.`

  return `☀️ *Daily briefing turned off*\n\nYou can turn it back on anytime by saying:\n*set briefing at 8 am*`
}

export async function setBriefingTime(telegramId: number, input: string) {
  const lower = (input || '').toLowerCase().trim()

  if (
    lower === 'briefing status' ||
    lower === 'daily briefing status' ||
    lower === 'morning briefing status'
  ) {
    return await getBriefingStatus(telegramId)
  }

  if (
    lower === 'turn off daily briefing' ||
    lower === 'turn off morning briefing' ||
    lower === 'stop daily briefing' ||
    lower === 'stop morning briefing' ||
    lower === 'disable daily briefing' ||
    lower === 'disable morning briefing'
  ) {
    return await disableBriefing(telegramId)
  }

  const time = parseTimePart(input)
  if (!time) {
    return `I couldn't understand the briefing time. Try something like *set briefing at 8 am*.`
  }

  const hh = String(time.hour).padStart(2, '0')
  const mm = String(time.minute).padStart(2, '0')
  const timeValue = `${hh}:${mm}`

  const { error } = await supabaseAdmin
    .from('users')
    .update({ briefing_enabled: true, briefing_time: timeValue })
    .eq('telegram_id', telegramId)

  if (error) return `I couldn't update your morning briefing time right now.`

  return (
    `☀️ *Daily briefing set*\n\n` +
    `I’ll message you every morning at *${formatTime(time.hour, time.minute)}*.\n\n` +
    `It will include weather, calendar, reminders, notes and suggested focus.\n\n` +
    `Type *briefing status* anytime to check it.`
  )
}
