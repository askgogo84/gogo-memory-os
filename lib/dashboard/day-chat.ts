import { getTodayCalendar, getTodayReminders, type ReminderRow } from '@/lib/dashboard/queries'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type DashboardDayIntent = 'summary' | 'next' | 'plan'

export function detectDashboardDayIntent(rawText: string): DashboardDayIntent | null {
  const text = String(rawText || '').trim().toLowerCase().replace(/[’]/g, "'")
  if (!text) return null

  if (/\b(what(?:'s| is) next|what do i have next|next thing|what should i do next)\b/.test(text)) return 'next'

  // "Plan my day" asks for an ordered plan, not the same list "what do I have today" gets.
  if (/\b(plan my day|plan (?:out )?today|today's plan|todays plan|plan for today|organi[sz]e my day)\b/.test(text)) return 'plan'

  if (
    /\b(what do i have today|what(?:'s| is) on today|what do i need to do today|what am i doing today|show me my day|brief my day|my day today)\b/.test(text)
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
  calendarEvents: Array<{ id: string; title: string; time: string | null; startAt?: string | null }>
  /** Pending approvals waiting on the person; null when unknown. */
  approvalsWaiting?: number | null
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

  if (params.intent === 'plan') return formatDayPlan(params, now, upcoming)

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


type PlanItem = { at: number; label: string; kind: 'meeting' | 'reminder' }
const MEETING_MINUTES = 30
const DAY_END_HOUR = 22

/** Minutes past midnight of a moment in the person's zone. */
function minutesIn(ms: number, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms))
    const h = Number(parts.find(p => p.type === 'hour')?.value || 0) % 24, m = Number(parts.find(p => p.type === 'minute')?.value || 0)
    return h * 60 + m
  } catch { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes() }
}

/**
 * One ordered plan for the rest of today: meetings and reminders on a single timeline, what is waiting on the
 * person, and the longest open stretch before 10 pm. Only facts from their own data; no invented advice.
 */
function formatDayPlan(params: Parameters<typeof formatDashboardDayReply>[0], now: Date, upcoming: ReminderRow[]) {
  const nowMs = now.getTime()
  const items: PlanItem[] = []
  const allDay: string[] = []
  if (params.calendarOk && params.calendarConnected) {
    for (const e of params.calendarEvents) {
      const at = e.startAt ? new Date(e.startAt).getTime() : NaN
      if (!Number.isFinite(at)) { if (!e.time) allDay.push(e.title); continue }
      if (at + MEETING_MINUTES * 60_000 > nowMs) items.push({ at, label: e.title, kind: 'meeting' })
    }
  }
  for (const r of upcoming) items.push({ at: new Date(r.remind_at).getTime(), label: cleanLabel(r.message), kind: 'reminder' })
  items.sort((a, b) => a.at - b.at)

  const lines: string[] = [`Your plan for the rest of today:`]
  if (allDay.length) lines.push(`All day — ${allDay.join(', ')}`)
  if (!items.length) lines.push(`Nothing scheduled from now on.`)
  for (const item of items.slice(0, 8)) {
    lines.push(`${clock(new Date(item.at).toISOString(), params.tz)} — ${item.label}${item.kind === 'meeting' ? ' (meeting)' : ''}`)
  }
  if (items.length > 8) lines.push(`+${items.length - 8} more`)

  if (typeof params.approvalsWaiting === 'number' && params.approvalsWaiting > 0) {
    lines.push('', `Needs you: ${params.approvalsWaiting} decision${params.approvalsWaiting === 1 ? '' : 's'} waiting. Open Needs you to clear them.`)
  }

  // Longest open stretch between now and 10 pm, counting a meeting as 30 minutes and a reminder as a moment.
  const nowMinutes = minutesIn(nowMs, params.tz)
  const endOfDay = nowMs + (DAY_END_HOUR * 60 - nowMinutes) * 60_000
  // Only during waking hours: at 1 am "free until 10 pm" is not a useful fact.
  if (endOfDay > nowMs && nowMinutes >= 6 * 60) {
    let cursor = nowMs, best = { from: 0, to: 0 }
    for (const item of items.filter(i => i.at < endOfDay)) {
      if (item.at - cursor > best.to - best.from) best = { from: cursor, to: item.at }
      cursor = Math.max(cursor, item.at + (item.kind === 'meeting' ? MEETING_MINUTES * 60_000 : 0))
    }
    if (endOfDay - cursor > best.to - best.from) best = { from: cursor, to: endOfDay }
    if (best.to - best.from >= 60 * 60_000) {
      lines.push('', `Longest free stretch: ${clock(new Date(best.from).toISOString(), params.tz)} – ${clock(new Date(best.to).toISOString(), params.tz)}.`)
    }
  }
  if (!params.remindersOk || !params.calendarOk) lines.push('', `Part of your day could not be loaded, so this plan may be missing items.`)
  return lines.join('\n')
}

export async function getDashboardDayReply(telegramId: string, intent: DashboardDayIntent) {
  const tgNum = parseInt(telegramId, 10)
  let tz = 'Asia/Kolkata'
  if (Number.isFinite(tgNum)) {
    const { data } = await supabaseAdmin.from('users').select('timezone').eq('telegram_id', tgNum).maybeSingle()
    if (data?.timezone) tz = String(data.timezone)
  }

  const [reminders, calendar, approvals] = await Promise.all([
    getTodayReminders(telegramId),
    getTodayCalendar(telegramId),
    intent === 'plan'
      ? Promise.resolve(supabaseAdmin.from('agent_approvals').select('id', { count: 'exact', head: true }).eq('telegram_id', telegramId).eq('status', 'pending'))
          .then((r: any) => (r?.error ? null : (r?.count ?? null))).catch(() => null)
      : Promise.resolve(null),
  ])

  return formatDashboardDayReply({
    intent,
    tz,
    remindersOk: reminders.ok,
    reminders: reminders.ok ? reminders.reminders : [],
    calendarOk: calendar.ok,
    calendarConnected: calendar.ok ? calendar.connected : false,
    calendarEvents: calendar.ok && calendar.connected ? calendar.events : [],
    approvalsWaiting: approvals,
  })
}
