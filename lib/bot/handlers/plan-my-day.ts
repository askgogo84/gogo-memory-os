import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkFeatureLimit, logUsage } from '@/lib/limits'
import { fetchWeatherForecast, formatCurrentWeather } from '@/lib/services/weather'
import { getTodayEvents, refreshAccessToken } from '@/lib/google-calendar'
import { saveFollowupState } from './followup-state'

type DayPlanItem = {
  timeLabel: string
  hour: number
  minute: number
  message: string
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

function todayDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function istTodayParts() {
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

function istWallTimeToUtcIso(hour: number, minute: number) {
  const parts = istTodayParts()
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 5, minute - 30, 0))
  return utc.toISOString()
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

function defaultDayPlanItems(events: any[], reminders: any[]): DayPlanItem[] {
  const hasEvents = events.length > 0
  const hasReminders = reminders.length > 0

  return [
    {
      timeLabel: '3:30 PM',
      hour: 15,
      minute: 30,
      message: 'Clear your top priority before distractions',
    },
    {
      timeLabel: '6:30 PM',
      hour: 18,
      minute: 30,
      message: hasEvents
        ? 'Review calendar and prepare for follow-ups'
        : 'Deep work / follow-up block',
    },
    {
      timeLabel: '8:30 PM',
      hour: 20,
      minute: 30,
      message: hasReminders
        ? 'Close pending reminders and plan tomorrow'
        : 'Review the day and plan tomorrow',
    },
  ]
}

function buildSuggestedFlow(items: DayPlanItem[]) {
  return items.map((item) => `• ${item.timeLabel} — ${item.message}`).join('\n')
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
  const planItems = defaultDayPlanItems(calendarState.events, reminders)

  let weatherText = 'Weather unavailable right now.'

  try {
    const forecast = await fetchWeatherForecast('Bangalore', 2)
    if (forecast) {
      weatherText = cleanWeather(formatCurrentWeather(forecast))
    }
  } catch {
    weatherText = 'Weather unavailable right now.'
  }

  await saveFollowupState(telegramId, 'day_plan', {
    items: planItems,
    created_at: new Date().toISOString(),
  })

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
  reply += buildSuggestedFlow(planItems)

  reply += `\n\nWant me to add this plan as reminders?\nReply *yes* to create this day plan.`

  return reply
}

export async function createDayPlanReminders(params: {
  telegramId: number
  chatId: number
  whatsappTo?: string | null
  items: DayPlanItem[]
}) {
  for (const item of params.items) {
    const limit = await checkFeatureLimit(params.telegramId, 'reminder_create')

    if (!limit.allowed) {
      return limit.upgradeMessage || 'Reminder limit reached.'
    }

    const payload: any = {
      telegram_id: params.telegramId,
      chat_id: params.chatId,
      message: item.message,
      remind_at: istWallTimeToUtcIso(item.hour, item.minute),
      sent: false,
    }

    if (params.whatsappTo) {
      payload.whatsapp_to = params.whatsappTo
    }

    const { error } = await supabaseAdmin.from('reminders').insert(payload)

    if (error) {
      console.error('DAY_PLAN_REMINDER_INSERT_FAILED:', error, payload)
      return `I couldn't add the full day plan right now. Please try again.`
    }

    await logUsage(params.telegramId, 'reminder_create', {
      message: item.message,
      source: 'day_plan',
    })
  }

  return (
    `✅ *Day plan added*\n\n` +
    params.items.map((item) => `${item.timeLabel} — ${item.message}`).join('\n') +
    `\n\nI’ll remind you through the day.`
  )
}
