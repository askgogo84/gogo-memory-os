import { getTodayCalendar, getTodayReminders, type ReminderRow } from '@/lib/dashboard/queries'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type DashboardDayIntent = 'summary' | 'next'

export function detectDashboardDayIntent(rawText: string): DashboardDayIntent | null {
  const text = String(rawText || '').trim().toLowerCase().replace(/[’]/g, "'")
  if (!text) return null

  if (/\b(what(?:'s| is) next|what do i have next|next thing|what should i do next)\b/.test(text)) return 'next'

  if (
    /\b(what do i have today|what(?:'s| is) on today|what do i need to do today|what am i doing today|show me my day|brief my day|plan my day|my day today|today's plan|todays plan)\b/.test(text)
  ) return 'summary'

  return null
}

function clock(iso: string, tz: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat('en-US', { hour:'numeric', minute:'2-digit', hour12:true }).format(new Date(iso))
  }
}

function cleanLabel(value: string | null | undefined) {
  return String(value || 'Reminder').replace(/\s+/g, ' ').trim()
}

function upcomingReminders(rows: ReminderRow[], now = new Date()) {
  const nowMs = now.getTime()
  return rows.filter(row => row.sent !== true && new Date(row.remind_at).getTime() > nowMs)
}

export function formatDashboardDayReply(params: {
  intent: DashboardDayIntent
  tz: string
  remindersOk: boolean
  reminders: ReminderRow[]
  calendarOk: boolean
  calendarConnected: boolean
  calendarEvents: Array<{ id: string; title: string; time: string | null }>
  now?: Date
}) {
  const now = params.now || new Date()
  const upcoming = upcomingReminders(params.reminders, now)

  if (params.intent === 'next') {
    const nextReminder = upcoming[0]
    const nextCalendar = params.calendarOk && params.calendarConnected ? params.calendarEvents[0] : null

    if (nextReminder) {
      const lines = [`Next up: ${clock(nextReminder.remind_at, params.tz)} — ${cleanLabel(nextReminder.message)}.`]
      if (nextCalendar) lines.push(`Calendar: ${nextCalendar.time || 'Today'} — ${nextCalendar.title}.`)
      return lines.join('\n')
    }
    if (nextCalendar) return `Next on your calendar: ${nextCalendar.time || 'Today'} — ${nextCalendar.title}.`
    if (!params.remindersOk || !params.calendarOk) return `I couldn't read your full day right now. Try again in a moment.`
    return `Nothing else is waiting today. Your day is clear.`
  }

  const lines: string[] = [`Here’s your day:`]

  if (!params.remindersOk) {
    lines.push(`• Reminders: I couldn't load them right now.`)
  } else if (upcoming.length === 0) {
    lines.push(`• Reminders: nothing pending.`)
  } else {
    lines.push(`• Reminders: ${upcoming.length} left.`)
    for (const row of upcoming.slice(0, 5)) {
      lines.push(`  ${clock(row.remind_at, params.tz)} — ${cleanLabel(row.message)}`)
    }
    if (upcoming.length > 5) lines.push(`  +${upcoming.length - 5} more`)
  }

  if (!params.calendarOk) {
    lines.push(`• Calendar: I couldn't load it right now.`)
  } else if (!params.calendarConnected) {
    lines.push(`• Calendar: not connected.`)
  } else if (params.calendarEvents.length === 0) {
    lines.push(`• Calendar: clear today.`)
  } else {
    lines.push(`• Calendar: ${params.calendarEvents.length} event${params.calendarEvents.length === 1 ? '' : 's'}.`)
    for (const event of params.calendarEvents.slice(0, 4)) {
      lines.push(`  ${event.time || 'All day'} — ${event.title}`)
    }
    if (params.calendarEvents.length > 4) lines.push(`  +${params.calendarEvents.length - 4} more`)
  }

  if (upcoming.length === 0 && params.calendarOk && params.calendarConnected && params.calendarEvents.length === 0) {
    lines.push(`You have a quiet day.`)
  }

  return lines.join('\n')
}

export async function getDashboardDayReply(telegramId: string, intent: DashboardDayIntent) {
  const tgNum = parseInt(telegramId, 10)
  let tz = 'Asia/Kolkata'
  if (Number.isFinite(tgNum)) {
    const { data } = await supabaseAdmin.from('users').select('timezone').eq('telegram_id', tgNum).maybeSingle()
    if (data?.timezone) tz = String(data.timezone)
  }

  const [reminders, calendar] = await Promise.all([
    getTodayReminders(telegramId),
    getTodayCalendar(telegramId),
  ])

  return formatDashboardDayReply({
    intent,
    tz,
    remindersOk: reminders.ok,
    reminders: reminders.ok ? reminders.reminders : [],
    calendarOk: calendar.ok,
    calendarConnected: calendar.ok ? calendar.connected : false,
    calendarEvents: calendar.ok && calendar.connected ? calendar.events : [],
  })
}
