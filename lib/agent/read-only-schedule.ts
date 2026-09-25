import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import { executeReadOnlyCalendarStep } from './calendar-read'
import { normalizeTimezone } from '@/lib/timezone'

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

/** Return the next LOCAL calendar date, not "now + N hours". */
export function nextLocalDateKey(now: Date, timeZone: string) {
  const today = localDateKey(now, timeZone)
  const [year, month, day] = today.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

function localClock(value: string, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'All day'
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
  if (/^(?:please\s+)?(?:remind|create|add|move|cancel|delete|book)\b/.test(text)) return null
  const readVerb = /\b(check|tell me|show(?: me)?|plan my day|what is my day|what (?:meetings?|events?|appointments?) do i have|what do i have|what(?:'s| is) on|what needs my attention|review|summari[sz]e|brief me)\b/.test(text)
  const scheduleContext = /\b(tomorrow|calendar|schedule|meetings?|appointments?|events?|day)\b/.test(text)
  const tomorrow = /\btomorrow\b/.test(text)
  if ((explicitNoMutation || readVerb) && scheduleContext && tomorrow) {
    const request = text.replace(/(?:do not|don't|dont|without)\s+(?:change|changing|modify|modifying|create|creating|add|adding|edit|editing|move|moving|cancel|cancelling|canceling).*$/, '')
    const combined = /\b(?:reminders?|agenda|plan my day|what is my day|what do i have tomorrow|what(?:'s| is) on tomorrow|my day|my schedule)\b/.test(request)
    const calendarOnly = /\b(?:calendar|meetings?|appointments?|events?)\b/.test(request) && !combined
    return { horizon: 'tomorrow' as const, scope: calendarOnly ? 'calendar' as const : 'agenda' as const }
  }
  return null
}

export async function readTomorrowSchedule(params: { actor: AgentActor; scope?: 'calendar' | 'agenda' }) {
  const telegramId = Number(params.actor.legacyTelegramId)
  const { data: user, error: userError } = await supabaseAdmin.from('users')
    .select('timezone')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (userError) throw new Error(`read_only_schedule_user_failed:${userError.message}`)

  const requestedTimeZone = normalizeTimezone(user?.timezone)
  const now = new Date()
  const tomorrowKey = nextLocalDateKey(now, requestedTimeZone)

  // Use the exact same canonical Google Calendar reader as autonomous mission steps.
  // This prevents Agent/Talk-to-Gogo read-only summaries from drifting from the
  // calendar reality used by the planner, verifier and availability engine.
  let calendarConnected = true
  let timeZone = requestedTimeZone
  let calendarEvents: Array<{ id?: string; title: string; start: string; end?: string }> = []
  try {
    const calendar = await executeReadOnlyCalendarStep({
      actor: params.actor,
      instruction: 'Show my calendar tomorrow',
      missionText: 'Read tomorrow schedule without changing anything.',
    })
    const output: any = calendar.output || {}
    timeZone = safe(output.timezone || requestedTimeZone, 100)
    calendarEvents = (Array.isArray(output.events) ? output.events : []).map((event: any) => ({
      id: safe(event?.id || '', 160) || undefined,
      title: safe(event?.summary || event?.title || 'Untitled event', 180),
      start: safe(event?.start || '', 120),
      end: safe(event?.end || '', 120) || undefined,
    })).filter((event: any) => event.start)
  } catch (error: any) {
    console.error('READ_ONLY_SCHEDULE_CALENDAR_FAILED:', safe(error?.message || error, 160))
    calendarConnected = false
  }

  const localTomorrowKey = nextLocalDateKey(now, timeZone)
  // Calendar-only requests never read reminders, Attention or background monitors.
  if (params.scope === 'calendar') {
    const lines = ['Calendar tomorrow:']
    if (!calendarConnected) lines.push('I could not read your connected calendar just now.')
    else if (!calendarEvents.length) lines.push('No calendar events found.')
    else for (const event of calendarEvents) lines.push(`• ${localClock(event.start, timeZone)} — ${event.title}`)
    return { text: lines.join('\n'), calendarEvents, reminders: [], timeZone, tomorrowKey: localTomorrowKey, calendarReadVerified: calendarConnected }
  }
  const tomorrowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000)
  const tomorrowEnd = new Date(now.getTime() + 60 * 60 * 60 * 1000)
  const { data: reminderRows, error: reminderError } = await supabaseAdmin.from('reminders')
    .select('id,message,remind_at,sent')
    .eq('telegram_id', telegramId)
    .gte('remind_at', tomorrowStart.toISOString())
    .lt('remind_at', tomorrowEnd.toISOString())
    .order('remind_at', { ascending: true })
  if (reminderError) throw new Error(`read_only_schedule_reminders_failed:${reminderError.message}`)
  const reminders = (reminderRows || []).filter((row: any) => {
    const due = new Date(row.remind_at)
    return !row.sent && Number.isFinite(due.getTime()) && localDateKey(due, timeZone) === localTomorrowKey
  })

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

  return { text: lines.join('\n'), calendarEvents, reminders, timeZone, tomorrowKey: localTomorrowKey || tomorrowKey, calendarReadVerified: calendarConnected }
}

