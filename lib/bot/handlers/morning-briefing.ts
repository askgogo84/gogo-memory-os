import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchUnreadEmails, refreshGmailAccessToken } from '@/lib/google-gmail'
import { fetchWeatherForecast, formatCurrentWeather } from '@/lib/services/weather'

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

async function getUnreadEmails(telegramId: number) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('gmail_connected, gmail_access_token, gmail_refresh_token, gmail_email')
    .eq('telegram_id', telegramId)
    .single()

  if (!user?.gmail_connected) return []

  let accessToken = user.gmail_access_token || null
  let emails: any[] = []

  if (accessToken) {
    try {
      emails = await fetchUnreadEmails(accessToken, 3)
    } catch {
      emails = []
    }
  }

  if (!emails.length && user.gmail_refresh_token) {
    const refreshedToken = await refreshGmailAccessToken(user.gmail_refresh_token)

    if (refreshedToken) {
      await supabaseAdmin
        .from('users')
        .update({ gmail_access_token: refreshedToken })
        .eq('telegram_id', telegramId)

      try {
        emails = await fetchUnreadEmails(refreshedToken, 3)
      } catch {
        emails = []
      }
    }
  }

  return emails
}

export async function buildMorningBriefing(telegramId: number, userName?: string) {
  const reminders = await getTodaysReminders(telegramId)
  const emails = await getUnreadEmails(telegramId)

  let weatherText = 'Weather unavailable right now.'
  try {
    const forecast = await fetchWeatherForecast('Bangalore', 2)
    if (forecast) {
      weatherText = formatCurrentWeather(forecast)
        .replace(/^Current weather in /i, '')
        .replace(/:\s*\n/i, ': ')
        .replace(/\n/g, ' • ')
    }
  } catch {
    weatherText = 'Weather unavailable right now.'
  }

  const greetingName = userName?.trim() || 'there'

  let reply = `Good morning, ${greetingName}.\n\n`

  reply += `*Today's weather*\n${weatherText}\n\n`

  reply += `*Today's reminders*\n`
  if (reminders.length) {
    reply += reminders
      .slice(0, 5)
      .map((r: any, idx: number) => `${idx + 1}. ${r.message} — ${formatReminderTime(r.remind_at)}`)
      .join('\n')
  } else {
    reply += `No reminders lined up for today.`
  }

  reply += `\n\n*Top unread emails*\n`
  if (emails.length) {
    reply += emails
      .slice(0, 3)
      .map((e: any, idx: number) => `${idx + 1}. ${e.subject} — ${e.from}`)
      .join('\n')
  } else {
    reply += `No unread emails right now.`
  }

  return reply
}
