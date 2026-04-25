import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchWeatherForecast, formatCurrentWeather } from '@/lib/services/weather'
import { getTodayEvents, refreshAccessToken } from '@/lib/google-calendar'

function formatReminderTime(iso: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
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

function cleanReminderText(text: string) {
  return (text || 'Reminder').replace(/^to\s+/i, '').trim()
}

function firstName(name?: string) {
  const clean = (name || '').trim()
  if (!clean) return 'there'
  return clean.split(' ')[0]
}

function todayDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

async function getTodaysReminders(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('reminders')
    .select('id, message, remind_at, sent')
    .eq('telegram_id', telegramId)
    .eq('sent', false)
    .order('remind_at', { ascending: true })
    .limit(20)

  const today = todayDateKey()

  return (data || []).filter((r: any) => {
    const d = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(r.remind_at))

    return d === today
  })
}

async function getCalendarEvents(telegramId: number) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('google_calendar_connected, google_refresh_token')
    .eq('telegram_id', telegramId)
    .single()

  if (!user?.google_calendar_connected || !user?.google_refresh_token) {
    return {
      connected: false,
      events: [],
    }
  }

  const accessToken = await refreshAccessToken(user.google_refresh_token)

  if (!accessToken) {
    return {
      connected: false,
      events: [],
    }
  }

  try {
    const events = await getTodayEvents(accessToken)

    return {
      connected: true,
      events,
    }
  } catch {
    return {
      connected: true,
      events: [],
    }
  }
}

function cleanWeather(raw: string) {
  let text = raw
    .replace(/\*/g, '')
    .replace(/^Current weather in /i, '')
    .replace(/:\s*\n/i, ': ')
    .replace(/\n/g, ' • ')
    .replace(/\s+/g, ' ')
    .trim()

  text = text.replace(/^Bangalore:\s*/i, 'Bangalore: ')

  if (!text.toLowerCase().startsWith('bangalore')) {
    text = `Bangalore: ${text}`
  }

  return text
}

function buildSuggestedFlow(events: any[], reminders: any[]) {
  const hasEvents = events.length > 0
  const hasReminders = reminders.length > 0

  const flow: string[] = []

  flow.push('• Morning — clear your top priority before distractions')

  if (hasEvents) {
    const firstEvent = events[0]
    flow.push(`• Midday — stay ready for ${firstEvent.summary || 'your calendar event'} at ${formatEventTime(firstEvent)}`)
  } else {
    flow.push('• Afternoon — use this as your deep work / follow-up block')
  }

  if (hasReminders) {
    flow.push('• Evening — finish pending reminders and close loops')
  } else {
    flow.push('• Evening — review the day and plan tomorrow')
  }

  return flow.join('\n')
}

export function isPlanMyDayIntent(text: string) {
  const lower = (text || '').toLowerCase().trim()

  return (
    lower === 'plan my day' ||
    lower === 'plan today' ||
    lower === 'help me plan my day' ||
    lower === 'help me plan today' ||
    lower === 'plan my schedule' ||
    lower === 'day plan' ||
    lower === 'make my day plan'
  )
}

export async function buildPlanMyDayReply(telegramId: number, userName?: string) {
  const name = firstName(userName)
  const reminders = await getTodaysReminders(telegramId)
  const calendarState = await getCalendarEvents(telegramId)

  let weatherText = 'Weather unavailable right now.'

  try {
    const forecast = await fetchWeatherForecast('Bangalore', 2)
    if (forecast) {
      weatherText = cleanWeather(formatCurrentWeather(forecast))
    }
  } catch {
    weatherText = 'Weather unavailable right now.'
  }

  let reply = `🧠 *Plan for ${name}*\n\n`

  reply += `🌤️ *Weather*\n${weatherText}\n\n`

  reply += `📅 *Calendar*\n`
  if (!calendarState.connected) {
    reply += `Calendar is not connected yet.\nType *connect calendar* to make this smarter.\n\n`
  } else if (calendarState.events.length) {
    reply += calendarState.events
      .slice(0, 5)
      .map((event: any) => `• ${formatEventTime(event)} — ${event.summary || 'Untitled event'}`)
      .join('\n')
    reply += '\n\n'
  } else {
    reply += `No calendar events lined up today.\n\n`
  }

  reply += `⏰ *Reminders*\n`
  if (reminders.length) {
    reply += reminders
      .slice(0, 5)
      .map((r: any) => `• ${cleanReminderText(r.message)} — ${formatReminderTime(r.remind_at)}`)
      .join('\n')
    reply += '\n\n'
  } else {
    reply += `No reminders lined up for today.\n\n`
  }

  reply += `✨ *Suggested flow*\n`
  reply += buildSuggestedFlow(calendarState.events, reminders)

  reply += `\n\nWant me to add this plan as reminders?\nReply *yes* to create a simple day plan.`

  return reply
}
