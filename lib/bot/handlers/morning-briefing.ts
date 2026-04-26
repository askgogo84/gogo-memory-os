import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchWeatherForecast, formatCurrentWeather } from '@/lib/services/weather'
import { getTodayEvents, refreshAccessToken } from '@/lib/google-calendar'

function todayDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

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

function uniqueReminders(reminders: any[]) {
  const seen = new Set<string>()
  const output: any[] = []

  for (const reminder of reminders) {
    const key = `${cleanReminderText(reminder.message).toLowerCase()}|${formatReminderTime(reminder.remind_at)}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(reminder)
  }

  return output
}

async function getTodaysReminders(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('reminders')
    .select('id, message, remind_at, sent')
    .eq('telegram_id', telegramId)
    .eq('sent', false)
    .order('remind_at', { ascending: true })
    .limit(30)

  const today = todayDateKey()

  const reminders = (data || []).filter((r: any) => {
    const d = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(r.remind_at))

    return d === today
  })

  return uniqueReminders(reminders)
}

async function getCalendarState(telegramId: number) {
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

export async function buildMorningBriefing(telegramId: number, userName?: string) {
  const reminders = await getTodaysReminders(telegramId)
  const calendarState = await getCalendarState(telegramId)

  let weatherText = 'Weather unavailable right now.'
  try {
    const forecast = await fetchWeatherForecast('Bangalore', 2)
    if (forecast) {
      weatherText = cleanWeather(formatCurrentWeather(forecast))
    }
  } catch {
    weatherText = 'Weather unavailable right now.'
  }

  const name = firstName(userName)

  let reply = `☀️ *Today for ${name}*\n\n`

  reply += `🌤️ *Weather*\n${weatherText}\n\n`

  reply += `📅 *Calendar*\n`
  if (!calendarState.connected) {
    reply += `Calendar is not connected yet.\nType *connect calendar* to enable your daily schedule.`
  } else if (calendarState.events.length) {
    reply += calendarState.events
      .slice(0, 5)
      .map((event: any) => {
        const title = event.summary || 'Untitled event'
        return `• ${formatEventTime(event)} — ${title}`
      })
      .join('\n')
  } else {
    reply += `No calendar events lined up today.`
  }

  reply += `\n\n⏰ *Reminders*\n`
  if (reminders.length) {
    reply += reminders
      .slice(0, 7)
      .map((r: any) => `• ${cleanReminderText(r.message)} — ${formatReminderTime(r.remind_at)}`)
      .join('\n')
  } else {
    reply += `No reminders lined up for today.`
  }

  const nextActions = calendarState.connected
    ? ['add meeting tomorrow at 4 pm', 'show my reminders', 'plan my day']
    : ['connect calendar', 'set a reminder', 'next RCB match']

  reply += `\n\n*Next actions*\n${nextActions.map((x) => `• ${x}`).join('\n')}`

  return reply
}
