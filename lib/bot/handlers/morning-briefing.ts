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

function semanticReminderKey(reminder: any) {
  const text = cleanReminderText(reminder.message).toLowerCase()
  const time = formatReminderTime(reminder.remind_at)

  if (text.includes('top priority')) return `day-plan-priority|${time}`
  if (text.includes('calendar') && text.includes('follow')) return `day-plan-followups|${time}`
  if (text.includes('plan tomorrow') || text.includes('review the day') || text.includes('close pending')) {
    return `day-plan-evening-review|${time}`
  }

  return `${text}|${time}`
}

function uniqueReminders(reminders: any[]) {
  const seen = new Set<string>()
  const output: any[] = []

  for (const reminder of reminders) {
    const key = semanticReminderKey(reminder)
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

// Flights departing today (IST). Reads the structured travel_tickets store; returns
// [] on any error (e.g. table not migrated yet) so the brief stays resilient.
async function getTodaysDepartures(telegramId: number) {
  try {
    const key = todayDateKey() // YYYY-MM-DD in IST
    const startMs = new Date(`${key}T00:00:00+05:30`).getTime()
    const startUtc = new Date(startMs).toISOString()
    const endUtc = new Date(startMs + 24 * 60 * 60 * 1000).toISOString()

    const { data } = await supabaseAdmin
      .from('travel_tickets')
      .select('from_city, to_city, depart_local, airline, flight_no, seat, pnr')
      .eq('telegram_id', telegramId)
      .eq('type', 'flight')
      .gte('depart_at', startUtc)
      .lt('depart_at', endUtc)
      .order('depart_at', { ascending: true })

    return data || []
  } catch {
    return []
  }
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
      error: false,
    }
  }

  const accessToken = await refreshAccessToken(user.google_refresh_token)

  if (!accessToken) {
    return {
      connected: false,
      events: [],
      error: false,
    }
  }

  try {
    const events = await getTodayEvents(accessToken)

    return {
      connected: true,
      events,
      error: false,
    }
  } catch (err) {
    // Fetch failed (bad/expired token, wrong account, Google error). Flag it so the
    // briefing says "couldn't reach Calendar" instead of the empty-day copy.
    console.error('CALENDAR_STATE_FETCH_FAILED:', err)
    return {
      connected: true,
      events: [],
      error: true,
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

  // #20 content flags: users.briefing_content (csv). 'default' = show everything.
  const { data: bc } = await supabaseAdmin
    .from('users')
    .select('briefing_content')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  const flags = String((bc as any)?.briefing_content || 'default').toLowerCase()
  const show = (k: string) => flags === 'default' || flags.includes(k)

  const blocks: string[] = [`☀️ *Today for ${name}*`]

  if (show('weather')) blocks.push(`🌤️ *Weather*\n${weatherText}`)

  // ✈️ Today's flight — above Calendar. 'travel' is included by the 'default' flag.
  if (show('travel')) {
    const flights = await getTodaysDepartures(telegramId)
    if (flights.length) {
      const lines = flights.map((f: any) => {
        const carrier = [f.airline, f.flight_no].filter(Boolean).join(' ')
        const seat = f.seat ? ` · Seat ${f.seat}` : ''
        const pnr = f.pnr ? ` · PNR ${f.pnr}` : ''
        return `• ${f.from_city} → ${f.to_city} · ${f.depart_local || ''}${carrier ? ` · ${carrier}` : ''}${seat}${pnr}`
      })
      blocks.push(`✈️ *Today's flight*\n${lines.join('\n')}`)
    }
  }

  if (show('calendar') || show('meeting')) {
    let cal = `📅 *Calendar*\n`
    if (!calendarState.connected) {
      cal += `Calendar is not connected yet.\nType *connect calendar* to enable your daily schedule.`
    } else if (calendarState.error) {
      cal += `⚠️ Couldn't reach Google Calendar just now — this is a temporary hiccup, not necessarily an empty day. If it keeps happening, reconnect with *connect calendar*.`
    } else if (calendarState.events.length) {
      cal += calendarState.events
        .slice(0, 5)
        .map((event: any) => `• ${formatEventTime(event)} — ${event.summary || 'Untitled event'}`)
        .join('\n')
    } else {
      cal += `No calendar events lined up today.`
    }
    blocks.push(cal)
  }

  if (show('reminder') || show('task')) {
    let rem = `⏰ *Reminders*\n`
    if (reminders.length) {
      rem += reminders
        .slice(0, 7)
        .map((r: any) => `• ${cleanReminderText(r.message)} — ${formatReminderTime(r.remind_at)}`)
        .join('\n')
    } else {
      rem += `No reminders lined up for today.`
    }
    blocks.push(rem)
  }


  return blocks.join('\n\n')
}
