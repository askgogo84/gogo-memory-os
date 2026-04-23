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
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(d)
}

export async function setBriefingTime(telegramId: number, input: string) {
  const time = parseTimePart(input)
  if (!time) {
    return `I couldn't understand the briefing time. Try something like "set my briefing to 8 am".`
  }

  const hh = String(time.hour).padStart(2, '0')
  const mm = String(time.minute).padStart(2, '0')
  const timeValue = `${hh}:${mm}`

  const { error } = await supabaseAdmin
    .from('users')
    .update({
      briefing_enabled: true,
      briefing_time: timeValue,
    })
    .eq('telegram_id', telegramId)

  if (error) {
    return `I couldn't update your morning briefing time right now.`
  }

  return `Done — your daily morning briefing is set for ${formatTime(time.hour, time.minute)}.`
}
