import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkFeatureLimit, logUsage } from '@/lib/limits'
import { saveFollowupState } from './followup-state'
import {
  createCalendarEvent,
  refreshAccessToken,
} from '@/lib/google-calendar'

type CalendarActionResult = {
  handled: boolean
  reply: string
}

type CalendarDateTarget = 'today' | 'tomorrow' | 'day_after_tomorrow'

type CalendarCreatePayload = {
  title: string
  startIso: string
  endIso: string
  displayTime: string
  created_at?: string
}

function istPartsNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
  }
}

function istDatePartsPlusDays(days: number) {
  const now = istPartsNow()
  const anchor = new Date(Date.UTC(now.year, now.month - 1, now.day, 12, 0, 0))
  anchor.setUTCDate(anchor.getUTCDate() + days)

  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  }
}

function istWallTimeToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
) {
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0))
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

function formatIstDisplayFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
) {
  const utcDate = istWallTimeToUtcDate(year, month, day, hour, minute)

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(utcDate)
}

function formatEventTime(event: any) {
  const start = event?.start?.dateTime || event?.start?.date

  if (!start) return 'All day'
  if (!event?.start?.dateTime) return 'All day'

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(start))
}

function targetFromText(text: string): CalendarDateTarget {
  const lower = text.toLowerCase()

  if (lower.includes('day after tomorrow')) return 'day_after_tomorrow'
  if (lower.includes('tomorrow')) return 'tomorrow'

  return 'today'
}

function targetLabel(target: CalendarDateTarget) {
  if (target === 'tomorrow') return 'tomorrow'
  if (target === 'day_after_tomorrow') return 'day after tomorrow'
  return 'today'
}

function targetParts(target: CalendarDateTarget) {
  if (target === 'tomorrow') return istDatePartsPlusDays(1)
  if (target === 'day_after_tomorrow') return istDatePartsPlusDays(2)
  return istDatePartsPlusDays(0)
}

function calendarRangeForTarget(target: CalendarDateTarget) {
  const parts = targetParts(target)
  const startUtc = istWallTimeToUtcDate(parts.year, parts.month, parts.day, 0, 0)
  const endUtc = istWallTimeToUtcDate(parts.year, parts.month, parts.day, 23, 59)

  return {
    timeMin: startUtc.toISOString(),
    timeMax: endUtc.toISOString(),
  }
}

function cleanTitle(text: string) {
  return (text || 'Meeting')
    .replace(/^(add|create|schedule|book|set up)\s+/i, '')
    .replace(/\b(on|in my)?\s*calendar\b/gi, '')
    .replace(/\btomorrow\b/gi, '')
    .replace(/\btoday\b/gi, '')
    .replace(/\bday after tomorrow\b/gi, '')
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?/gi, '')
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTime(text: string) {
  const lower = text.toLowerCase()

  const match =
    lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i) ||
    lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)

  if (!match) return null

  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const ampm = match[3]?.toLowerCase()

  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  if (!ampm && hour >= 1 && hour <= 7) hour += 12

  return { hour, minute }
}

function parseCalendarCreate(text: string) {
  const lower = text.toLowerCase()

  const isCreate =
    lower.includes('add meeting') ||
    lower.includes('schedule meeting') ||
    lower.includes('create meeting') ||
    lower.includes('book meeting') ||
    lower.includes('add call') ||
    lower.includes('schedule call') ||
    lower.includes('create call') ||
    lower.includes('book call') ||
    lower.includes('add event') ||
    lower.includes('schedule event') ||
    lower.includes('create event') ||
    lower.includes('add to calendar') ||
    lower.includes('calendar event')

  if (!isCreate) return null

  const time = parseTime(text)

  if (!time) {
    return {
      needsTime: true,
      title: cleanTitle(text),
    }
  }

  const target = targetFromText(text)
  const parts = targetParts(target)

  let title = cleanTitle(text)

  if (!title || title.length < 3) {
    title = lower.includes('call') ? 'Call' : 'Meeting'
  }

  title = title.charAt(0).toUpperCase() + title.slice(1)

  const endHourMinute = (() => {
    const endDate = istWallTimeToUtcDate(parts.year, parts.month, parts.day, time.hour, time.minute)
    endDate.setMinutes(endDate.getMinutes() + 30)

    const endParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(endDate)

    return {
      hour: Number(endParts.find((p) => p.type === 'hour')?.value || time.hour),
      minute: Number(endParts.find((p) => p.type === 'minute')?.value || time.minute),
    }
  })()

  return {
    needsTime: false,
    title,
    target,
    start: {
      ...parts,
      hour: time.hour,
      minute: time.minute,
    },
    end: {
      ...parts,
      hour: endHourMinute.hour,
      minute: endHourMinute.minute,
    },
  }
}

async function getCalendarTokens(telegramId: number) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('google_calendar_connected, google_refresh_token')
    .eq('telegram_id', telegramId)
    .single()

  if (!user?.google_calendar_connected || !user?.google_refresh_token) {
    return {
      connected: false,
      accessToken: null,
    }
  }

  const accessToken = await refreshAccessToken(user.google_refresh_token)

  if (!accessToken) {
    return {
      connected: false,
      accessToken: null,
    }
  }

  return {
    connected: true,
    accessToken,
  }
}

async function getEventsForTarget(accessToken: string, target: CalendarDateTarget) {
  const range = calendarRangeForTarget(target)

  const params = new URLSearchParams({
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
  })

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }
  )

  const data = await response.json()

  return data.items || []
}

function findConflictingEvents(events: any[], startIso: string, endIso: string) {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()

  return events.filter((event: any) => {
    const eventStart = event?.start?.dateTime
    const eventEnd = event?.end?.dateTime

    if (!eventStart || !eventEnd) return false

    const existingStart = new Date(eventStart).getTime()
    const existingEnd = new Date(eventEnd).getTime()

    return existingStart < end && existingEnd > start
  })
}

async function createEventFromPayload(
  telegramId: number,
  accessToken: string,
  payload: CalendarCreatePayload
) {
  const calendarLimit = await checkFeatureLimit(telegramId, 'calendar_event')

  if (!calendarLimit.allowed) {
    return calendarLimit.upgradeMessage || 'Calendar event limit reached.'
  }

  const created = await createCalendarEvent(
    accessToken,
    payload.title,
    payload.startIso,
    payload.endIso
  )

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
  })

  return (
    `✅ *Calendar event added*\n\n` +
    `${payload.title}\n` +
    `${payload.displayTime}\n\n` +
    `Duration: 30 mins`
  )
}

export function isCalendarAction(text: string) {
  const lower = (text || '').toLowerCase()

  return (
    lower.includes('calendar') ||
    lower.includes('meeting') ||
    lower.includes('schedule call') ||
    lower.includes('add call') ||
    lower.includes('book call') ||
    lower.includes('add event') ||
    lower.includes('schedule event') ||
    lower.includes('what is on my calendar') ||
    lower.includes("what's on my calendar")
  )
}

export async function createCalendarConflictEvent(
  telegramId: number,
  payload: CalendarCreatePayload
) {
  if (!payload?.title || !payload?.startIso || !payload?.endIso) {
    return null
  }

  if (payload.created_at) {
    const ageMs = Date.now() - new Date(payload.created_at).getTime()
    if (ageMs > 15 * 60 * 1000) return null
  }

  const tokens = await getCalendarTokens(telegramId)

  if (!tokens.connected || !tokens.accessToken) {
    return null
  }

  return await createEventFromPayload(telegramId, tokens.accessToken, payload)
}

export async function buildCalendarActionReply(
  telegramId: number,
  text: string
): Promise<CalendarActionResult> {
  const lower = (text || '').toLowerCase().trim()

  const wantsCalendarView =
    lower.includes('calendar today') ||
    lower.includes('calendar tomorrow') ||
    lower.includes('calendar for today') ||
    lower.includes('calendar for tomorrow') ||
    lower.includes('what is on my calendar') ||
    lower.includes("what's on my calendar") ||
    lower.includes('show my calendar')

  const createIntent = parseCalendarCreate(text)

  if (!wantsCalendarView && !createIntent) {
    return {
      handled: false,
      reply: '',
    }
  }

  const tokens = await getCalendarTokens(telegramId)

  if (!tokens.connected || !tokens.accessToken) {
    return {
      handled: true,
      reply:
        `📅 *Connect Google Calendar*\n\n` +
        `To manage meetings and show your daily schedule, connect Calendar once.\n\n` +
        `Type *connect calendar* to get the secure Google link.`,
    }
  }

  if (wantsCalendarView) {
    const target = targetFromText(text)
    const events = await getEventsForTarget(tokens.accessToken, target)

    if (!events.length) {
      return {
        handled: true,
        reply:
          `📅 *Your calendar ${targetLabel(target)}*\n\n` +
          `No calendar events lined up ${targetLabel(target)}.\n\n` +
          `Try:\n` +
          `• Add meeting tomorrow at 4 pm\n` +
          `• Plan my day`,
      }
    }

    return {
      handled: true,
      reply:
        `📅 *Your calendar ${targetLabel(target)}*\n\n` +
        events
          .slice(0, 7)
          .map((event: any) => {
            const title = event.summary || 'Untitled event'
            return `• ${formatEventTime(event)} — ${title}`
          })
          .join('\n') +
        `\n\nTry:\n• add meeting tomorrow at 4 pm\n• plan my day`,
    }
  }

  if (createIntent?.needsTime) {
    return {
      handled: true,
      reply:
        `📅 *Almost there*\n\n` +
        `What time should I add it?\n\n` +
        `Example:\n` +
        `Add meeting with Rahul tomorrow at 4 pm`,
    }
  }

  if (createIntent && !createIntent.needsTime && createIntent.start && createIntent.end) {
    const start = createIntent.start
    const end = createIntent.end

    const startIso = googleDateTimeWithIstOffset(
      start.year,
      start.month,
      start.day,
      start.hour,
      start.minute
    )

    const endIso = googleDateTimeWithIstOffset(
      end.year,
      end.month,
      end.day,
      end.hour,
      end.minute
    )

    const displayTime = formatIstDisplayFromParts(start.year, start.month, start.day, start.hour, start.minute)
    const eventsForDay = await getEventsForTarget(tokens.accessToken, createIntent.target)
    const conflicts = findConflictingEvents(eventsForDay, startIso, endIso)

    if (conflicts.length) {
      const conflict = conflicts[0]
      const payload = {
        title: createIntent.title,
        startIso,
        endIso,
        displayTime,
        created_at: new Date().toISOString(),
      }

      await saveFollowupState(telegramId, 'calendar_conflict', payload)

      return {
        handled: true,
        reply:
          `⚠️ *Calendar conflict found*\n\n` +
          `You already have:\n` +
          `• ${formatEventTime(conflict)} — ${conflict.summary || 'Calendar event'}\n\n` +
          `New event:\n` +
          `• ${displayTime} — ${createIntent.title}\n\n` +
          `Reply *yes* to add anyway, or send another time like *move to 4:30 pm*.`,
      }
    }

    const reply = await createEventFromPayload(telegramId, tokens.accessToken, {
      title: createIntent.title,
      startIso,
      endIso,
      displayTime,
    })

    return {
      handled: true,
      reply,
    }
  }

  return {
    handled: false,
    reply: '',
  }
}
