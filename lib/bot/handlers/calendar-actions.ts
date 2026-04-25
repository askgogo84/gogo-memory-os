import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  createCalendarEvent,
  getTodayEvents,
  refreshAccessToken,
} from '@/lib/google-calendar'

type CalendarActionResult = {
  handled: boolean
  reply: string
}

function istNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatIstDateTime(date: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
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

function toGoogleIsoFromIst(date: Date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')

  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`
}

function cleanTitle(text: string) {
  return (text || 'Meeting')
    .replace(/^(add|create|schedule|book|set up)\s+/i, '')
    .replace(/\b(on|in my)?\s*calendar\b/gi, '')
    .replace(/\btomorrow\b/gi, '')
    .replace(/\btoday\b/gi, '')
    .replace(/\b(day after tomorrow)\b/gi, '')
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

  // If user says "4" without am/pm, assume PM for calendar meetings.
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
    lower.includes('add event') ||
    lower.includes('schedule event') ||
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

  const now = istNow()
  let date = startOfDay(now)

  if (lower.includes('day after tomorrow')) {
    date = startOfDay(addDays(now, 2))
  } else if (lower.includes('tomorrow')) {
    date = startOfDay(addDays(now, 1))
  } else {
    date = startOfDay(now)
  }

  date.setHours(time.hour, time.minute, 0, 0)

  const end = new Date(date)
  end.setMinutes(end.getMinutes() + 30)

  let title = cleanTitle(text)

  if (!title || title.length < 3) {
    title = lower.includes('call') ? 'Call' : 'Meeting'
  }

  title = title.charAt(0).toUpperCase() + title.slice(1)

  return {
    needsTime: false,
    title,
    start: date,
    end,
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

export function isCalendarAction(text: string) {
  const lower = (text || '').toLowerCase()

  return (
    lower.includes('calendar') ||
    lower.includes('meeting') ||
    lower.includes('schedule call') ||
    lower.includes('add call') ||
    lower.includes('book call') ||
    lower.includes('what is on my calendar') ||
    lower.includes("what's on my calendar")
  )
}

export async function buildCalendarActionReply(
  telegramId: number,
  text: string
): Promise<CalendarActionResult> {
  const lower = (text || '').toLowerCase().trim()

  const wantsCalendarToday =
    lower.includes('calendar today') ||
    lower.includes('calendar for today') ||
    lower.includes('what is on my calendar') ||
    lower.includes("what's on my calendar") ||
    lower.includes('show my calendar')

  const createIntent = parseCalendarCreate(text)

  if (!wantsCalendarToday && !createIntent) {
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

  if (wantsCalendarToday) {
    const events = await getTodayEvents(tokens.accessToken)

    if (!events.length) {
      return {
        handled: true,
        reply:
          `📅 *Your calendar today*\n\n` +
          `No calendar events lined up today.\n\n` +
          `Try:\n` +
          `• Add meeting tomorrow at 4 pm\n` +
          `• Plan my day`,
      }
    }

    return {
      handled: true,
      reply:
        `📅 *Your calendar today*\n\n` +
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
    const created = await createCalendarEvent(
      tokens.accessToken,
      createIntent.title,
      toGoogleIsoFromIst(createIntent.start),
      toGoogleIsoFromIst(createIntent.end)
    )

    if (created?.error) {
      return {
        handled: true,
        reply:
          `📅 *Calendar error*\n\n` +
          `I couldn’t add this event right now.\n\n` +
          `Please try again, or reconnect calendar.`,
      }
    }

    return {
      handled: true,
      reply:
        `✅ *Calendar event added*\n\n` +
        `${createIntent.title}\n` +
        `${formatIstDateTime(createIntent.start)}\n\n` +
        `Duration: 30 mins`,
    }
  }

  return {
    handled: false,
    reply: '',
  }
}
