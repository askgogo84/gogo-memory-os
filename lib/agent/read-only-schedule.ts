import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshAccessToken } from '@/lib/services/google-calendar'
import type { AgentActor } from './actor'

function safe(value: unknown, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function localClock(value: string, timeZone: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'All day'
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

export function detectReadOnlyScheduleRequest(raw: string) {
  const text = safe(raw, 2000).toLowerCase().replace(/[’]/g, "'")
  if (!text) return null
  const explicitNoMutation = /\b(do not|don't|dont|without)\s+(?:change|changing|modify|modifying|create|creating|add|adding|edit|editing|move|moving|schedule|scheduling|cancel|cancelling|canceling)\b/.test(text) || /\bread[- ]only\b/.test(text)
  const readVerb = /\b(check|tell me|show me|what do i have|what(?:'s| is) on|what needs my attention|review|summari[sz]e|brief me)\b/.test(text)
  const scheduleContext = /\b(tomorrow|calendar|schedule|meetings?|appointments?|events?|day)\b/.test(text)
  const tomorrow = /\btomorrow\b/.test(text)
  if ((explicitNoMutation || readVerb) && scheduleContext && tomorrow) return { horizon: 'tomorrow' as const }
  return null
}

export async function readTomorrowSchedule(params: { actor: AgentActor }) {
  const telegramId = Number(params.actor.legacyTelegramId)
  const { data: user, error: userError } = await supabaseAdmin.from('users')
    .select('timezone,google_calendar_connected,google_refresh_token')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (userError) throw new Error(`read_only_schedule_user_failed:${userError.message}`)
  const timeZone = safe(user?.timezone || 'Asia/Kolkata', 100)
  const now = new Date()
  const tomorrowKey = localDateKey(new Date(now.getTime() + 36 * 60 * 60 * 1000), timeZone)
  const broadStart = new Date(now.getTime() - 2 * 60 * 60 * 1000)
  const broadEnd = new Date(now.getTime() + 60 * 60 * 60 * 1000)

  const { data: reminderRows, error: reminderError } = await supabaseAdmin.from('reminders')
    .select('id,message,remind_at,sent')
    .eq('telegram_id', telegramId)
    .gte('remind_at', broadStart.toISOString())
    .lt('remind_at', broadEnd.toISOString())
    .order('remind_at', { ascending: true })
  if (reminderError) throw new Error(`read_only_schedule_reminders_failed:${reminderError.message}`)
  const reminders = (reminderRows || []).filter((row: any) => !row.sent && localDateKey(new Date(row.remind_at), timeZone) === tomorrowKey)

  let calendarConnected = Boolean(user?.google_calendar_connected && user?.google_refresh_token)
  let calendarEvents: Array<{ title: string; start: string }> = []
  if (calendarConnected) {
    try {
      const token = await refreshAccessToken(String(user.google_refresh_token))
      if (!token) throw new Error('calendar_reconnect_required')
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
      url.searchParams.set('singleEvents', 'true')
      url.searchParams.set('orderBy', 'startTime')
      url.searchParams.set('timeMin', broadStart.toISOString())
      url.searchParams.set('timeMax', broadEnd.toISOString())
      url.searchParams.set('maxResults', '50')
      const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      if (!response.ok) throw new Error(`calendar_read_failed:${response.status}`)
      const body: any = await response.json().catch(() => ({}))
      calendarEvents = (Array.isArray(body?.items) ? body.items : [])
        .map((event: any) => ({
          title: safe(event?.summary || 'Untitled event', 180),
          start: safe(event?.start?.dateTime || event?.start?.date || '', 120),
        }))
        .filter((event: any) => event.start && localDateKey(new Date(event.start.length === 10 ? `${event.start}T12:00:00Z` : event.start), timeZone) === tomorrowKey)
    } catch (error: any) {
      console.error('READ_ONLY_SCHEDULE_CALENDAR_FAILED:', safe(error?.message || error, 160))
      calendarConnected = false
    }
  }

  const lines: string[] = ['Tomorrow:']
  if (calendarConnected) {
    if (calendarEvents.length) {
      lines.push(`Calendar: ${calendarEvents.length} event${calendarEvents.length === 1 ? '' : 's'}.`)
      for (const event of calendarEvents.slice(0, 6)) lines.push(`• ${localClock(event.start, timeZone)} — ${event.title}`)
    } else lines.push('Calendar: clear.')
  } else lines.push('Calendar: I could not read your connected calendar just now.')

  if (reminders.length) {
    lines.push(`Reminders: ${reminders.length}.`)
    for (const reminder of reminders.slice(0, 6)) lines.push(`• ${localClock(reminder.remind_at, timeZone)} — ${safe(reminder.message || 'Reminder', 180)}`)
  } else lines.push('Reminders: none pending.')

  const attention: string[] = []
  for (const event of calendarEvents.slice(0, 3)) attention.push(`${localClock(event.start, timeZone)} ${event.title}`)
  for (const reminder of reminders.slice(0, 3)) attention.push(`${localClock(reminder.remind_at, timeZone)} ${safe(reminder.message || 'Reminder', 120)}`)
  if (attention.length) lines.push(`Needs your attention: ${attention.join('; ')}.`)
  else lines.push('Nothing currently needs your attention tomorrow.')
  lines.push('I did not change, create, move or delete anything.')

  return { text: lines.join('\n'), calendarEvents, reminders, timeZone, tomorrowKey }
}
