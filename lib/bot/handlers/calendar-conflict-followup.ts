import { checkFeatureLimit, logUsage } from '@/lib/limits'
import { createCalendarEvent, refreshAccessToken } from '@/lib/google-calendar'
import { supabaseAdmin } from '@/lib/supabase-admin'

type CalendarCreatePayload = {
  title: string
  startIso: string
  endIso: string
  displayTime?: string
  created_at?: string
}

function parseTimePart(input: string): { hour: number; minute: number } | null {
  const match = input.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!match) return null

  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const ampm = match[3]?.toLowerCase()

  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0

  if (!ampm && hour >= 1 && hour <= 7) hour += 12
  if (hour > 23 || minute > 59) return null

  return { hour, minute }
}

function getIstDatePartsFromIso(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
  }
}

function googleDateTimeWithIstOffset(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
) {
  const yyyy = String(year)
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  const hh = String(hour).padStart(2, '0')
  const min = String(minute).padStart(2, '0')

  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`
}

function addMinutesToIstParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  minutesToAdd: number
) {
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0))
  utc.setMinutes(utc.getMinutes() + minutesToAdd)

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(utc)

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  }
}

function formatDisplay(iso: string) {
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

async function getAccessToken(telegramId: number) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('google_calendar_connected, google_refresh_token')
    .eq('telegram_id', telegramId)
    .single()

  if (!user?.google_calendar_connected || !user?.google_refresh_token) return null
  return await refreshAccessToken(user.google_refresh_token)
}

async function addCalendarEventFromPayload(telegramId: number, payload: CalendarCreatePayload) {
  if (!payload?.title || !payload?.startIso || !payload?.endIso) return null

  if (payload.created_at) {
    const ageMs = Date.now() - new Date(payload.created_at).getTime()
    if (ageMs > 15 * 60 * 1000) return null
  }

  const accessToken = await getAccessToken(telegramId)
  if (!accessToken) return null

  const calendarLimit = await checkFeatureLimit(telegramId, 'calendar_event')
  if (!calendarLimit.allowed) return calendarLimit.upgradeMessage || 'Calendar event limit reached.'

  const created = await createCalendarEvent(accessToken, payload.title, payload.startIso, payload.endIso)

  if (created?.error) {
    return (
      `📅 *Calendar error*\n\n` +
      `I couldn’t add this event right now.\n\n` +
      `Please try again, or reconnect calendar.`
    )
  }

  await logUsage(telegramId, 'calendar_event', {
    title: payload.title,
    startIso: payload.startIso,
    endIso: payload.endIso,
    source: 'calendar_conflict_followup',
  })

  return (
    `✅ *Calendar event added*\n\n` +
    `${payload.title}\n` +
    `${payload.displayTime || formatDisplay(payload.startIso)}\n\n` +
    `Duration: 30 mins`
  )
}

export function isCalendarConflictMoveCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return /^move\s+(it\s+)?to\s+/i.test(lower) || /^reschedule\s+(it\s+)?to\s+/i.test(lower)
}

export async function moveCalendarConflictEvent(
  telegramId: number,
  payload: CalendarCreatePayload,
  text: string
) {
  const time = parseTimePart(text)
  if (!time || !payload?.startIso) {
    return `I couldn't understand the new time.\n\nTry: *move to 4:30 pm*.`
  }

  const date = getIstDatePartsFromIso(payload.startIso)
  const end = addMinutesToIstParts(date.year, date.month, date.day, time.hour, time.minute, 30)

  const movedPayload: CalendarCreatePayload = {
    ...payload,
    startIso: googleDateTimeWithIstOffset(date.year, date.month, date.day, time.hour, time.minute),
    endIso: googleDateTimeWithIstOffset(end.year, end.month, end.day, end.hour, end.minute),
    displayTime: formatDisplay(
      googleDateTimeWithIstOffset(date.year, date.month, date.day, time.hour, time.minute)
    ),
    created_at: new Date().toISOString(),
  }

  return await addCalendarEventFromPayload(telegramId, movedPayload)
}
