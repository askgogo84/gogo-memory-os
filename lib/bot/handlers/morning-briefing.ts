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

function cleanReminderText(text: string) {
  return (text || 'Reminder').replace(/^to\s+/i, '').trim()
}

function firstName(name?: string) {
  const clean = (name || '').trim()
  if (!clean) return 'there'
  return clean.split(' ')[0]
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

  if (!user?.gmail_connected) {
    return {
      connected: false,
      email: null,
      emails: [],
    }
  }

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

  return {
    connected: true,
    email: user.gmail_email || null,
    emails,
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
  const emailState = await getUnreadEmails(telegramId)

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

  reply += `⏰ *Reminders*\n`
  if (reminders.length) {
    reply += reminders
      .slice(0, 5)
      .map((r: any) => `• ${cleanReminderText(r.message)} — ${formatReminderTime(r.remind_at)}`)
      .join('\n')
  } else {
    reply += `No reminders lined up for today.`
  }

  reply += `\n\n📬 *Unread emails*\n`
  if (!emailState.connected) {
    reply += `Gmail is not connected yet.\nType *connect Gmail* to enable email summaries.`
  } else if (emailState.emails.length) {
    reply += emailState.emails
      .slice(0, 3)
      .map((e: any, idx: number) => {
        const subject = e.subject || 'No subject'
        const from = e.from || 'Unknown sender'
        return `${idx + 1}. ${subject}\nFrom: ${from}`
      })
      .join('\n\n')
  } else {
    reply += `No unread emails right now.`
  }

  reply += `\n\n*Next actions*\n• show my unread emails\n• set a reminder\n• next RCB match`

  return reply
}
