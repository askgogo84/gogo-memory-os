import { getTodayCalendar, getTodayReminders, type ReminderRow, type CalendarEvent } from '@/lib/dashboard/queries'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {calendarInterval, collapseCalendarEntries, dailyOccurrenceOn, longSpanNote} from '@/lib/calendar-intervals'
import {isValidTimezone, parseLocalDateTime} from '@/lib/timezone'

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
    .sort((a, b) => Date.parse(a.remind_at) - Date.parse(b.remind_at))
}

export function formatDashboardDayReply(params: {
  intent: DashboardDayIntent
  tz: string
  remindersOk: boolean
  reminders: ReminderRow[]
  calendarOk: boolean
  calendarConnected: boolean
  calendarIncomplete?: boolean
  calendarEvents: DayEvent[]
  /** Pending approvals waiting on the person; null when unknown. */
  approvalsWaiting?: number | null
  now?: Date
}) {
  const now = params.now || new Date()
  const upcoming = upcomingReminders(params.reminders, now)
  params = {...params, calendarEvents: collapseDayEvents(params.calendarEvents, params.tz, now.getTime())}

  if (params.intent === 'next') {
    const nextReminder = upcoming[0]
    const candidates = params.calendarOk && params.calendarConnected ? params.calendarEvents.map(event => ({event, span: eventInterval(event, params.tz)}))
      .filter(({span}) => !span || span.end > now.getTime()) : []
    const uncertain = candidates.some(({span}) => !span)
    const incomplete = !params.calendarOk || !params.calendarConnected || params.calendarIncomplete
    const caution = incomplete ? ' Calendar is incomplete; an earlier event may be missing.' : uncertain ? ' Some calendar times are unverified; the next item cannot be established.' : ''
    const known = candidates.filter(candidate => candidate.span).sort((a, b) => a.span!.start - b.span!.start)
    const nextCalendar = known[0]
    if (nextCalendar && (!nextReminder || Math.max(nextCalendar.span!.start, now.getTime()) <= Date.parse(nextReminder.remind_at))) {
      const {event, span} = nextCalendar
      const ongoing = span!.start <= now.getTime()
      const label = ongoing ? 'On your calendar now' : incomplete || uncertain || !params.remindersOk ? 'Next known calendar item' : 'Next on your calendar'
      return `${label}: ${event.allDay ? 'All day' : event.time || clock(new Date(span!.start).toISOString(), params.tz)} — ${event.title}${ongoing ? ` (ongoing until ${clock(new Date(span!.end).toISOString(), params.tz)})` : ''}.${caution}${!params.remindersOk ? ' Reminders could not be loaded.' : ''}`
    }
    if (nextReminder) return `${incomplete || uncertain ? 'Next known reminder' : 'Next up'}: ${clock(nextReminder.remind_at, params.tz)} — ${cleanLabel(nextReminder.message)}.${caution}`
    if (uncertain) return `Calendar timing is unverified: ${candidates.filter(({span}) => !span).map(({event}) => event.title).slice(0, 4).join(', ')}. I can't establish what's next.${caution}`
    if (!params.remindersOk || incomplete) return `I couldn't read your full day right now. Try again in a moment.`
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
    lines.push(params.calendarIncomplete ? `• Calendar: incomplete; no events returned from the accounts I could read.` : `• Calendar: clear today.`)
  } else {
    lines.push(`• Calendar: ${params.calendarEvents.length} event${params.calendarEvents.length === 1 ? '' : 's'}.`)
    for (const event of params.calendarEvents.slice(0, 4)) {
      lines.push(`  ${event.time || 'All day'} — ${event.title}${event.note ? ` · ${event.note}` : ''}`)
    }
    if (params.calendarEvents.length > 4) lines.push(`  +${params.calendarEvents.length - 4} more`)
  }

  if (params.calendarIncomplete && params.calendarEvents.length) lines.push('Calendar is incomplete; other events may be missing.')
  if (upcoming.length === 0 && params.calendarOk && !params.calendarIncomplete && params.calendarConnected && params.calendarEvents.length === 0) {
    lines.push(`You have a quiet day.`)
  }

  return lines.join('\n')
}


type PlanItem = { at: number; label: string; kind: 'meeting' | 'reminder'; note?: string }

/** Minutes past midnight of a moment in the person's zone. */
function minutesIn(ms: number, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms))
    const h = Number(parts.find(p => p.type === 'hour')?.value || 0) % 24, m = Number(parts.find(p => p.type === 'minute')?.value || 0)
    return h * 60 + m
  } catch { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes() }
}


/** YYYY-MM-DD of a moment in the person's zone. */
function dayKeyIn(ms: number, tz: string) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)) }
  catch { return new Date(ms).toISOString().slice(0, 10) }
}

/** Today's instant for a clock time like "11:30am" or "4:00 PM" in the person's zone; NaN when unreadable. */
export function todayAtClock(clockText: string, nowMs: number, tz: string): number {
  if (!isValidTimezone(tz)) return NaN
  const m = String(clockText || '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!m) return NaN
  if (Number(m[2] || 0) > 59 || Number(m[1]) > (m[3] ? 12 : 23) || (m[3] && Number(m[1]) < 1)) return NaN
  let h = Number(m[1]) % 12 + (m[3] === 'pm' ? 12 : 0)
  if (!m[3]) h = Number(m[1])
  try { return parseLocalDateTime({date: dayKeyIn(nowMs, tz), time: `${String(h).padStart(2, '0')}:${String(Number(m[2] || 0)).padStart(2, '0')}`, timezone: tz}).dueAtUtc.getTime() }
  catch { return NaN }
}

type DayEvent = CalendarEvent & { note?: string }

/**
 * 20 Oct live: "Plan my day" at 10:43 PM listed "Daily Connect-Standup Call (meeting) · ongoing until 11:45 AM"
 * five times — copies of a broken invite whose entries each span ~3 weeks. Shared collapse (lib/calendar-intervals):
 * one entry at today's daily slot (11:30–11:45, so over by evening) with the invite note; exact duplicates once.
 */
function collapseDayEvents(events: CalendarEvent[], tz: string, nowMs: number): DayEvent[] {
  const today = dayKeyIn(nowMs, tz)
  return collapseCalendarEntries(events, e => ({title: e.title, start: e.startAt, end: e.endAt,
    dupKey: `${e.title}|${e.startAt || ''}|${e.endAt || ''}|${e.time || ''}|${e.allDay ? 1 : 0}|${e.timingKnown === false ? 0 : 1}`}), tz).map(g => {
    if (!g.daily) return g.first
    const occurrence = dailyOccurrenceOn(g.daily, today, tz)
    const note = longSpanNote(g.count)
    if (!occurrence) return {...g.first, note}
    const startAt = new Date(occurrence.start).toISOString()
    return {...g.first, startAt, endAt: new Date(occurrence.end).toISOString(), time: clock(startAt, tz), note}
  })
}

function eventInterval(event: CalendarEvent, tz: string) {
  return event.timingKnown === false ? null : calendarInterval({start: {dateTime: event.startAt || undefined}, end: {dateTime: event.endAt || undefined}}, tz)
}

/**
 * One ordered plan for the rest of today: meetings and reminders on a single timeline, what is waiting on the
 * person, and the longest open stretch before 10 pm. Only facts from their own data; no invented advice.
 */
function formatDayPlan(params: Parameters<typeof formatDashboardDayReply>[0], now: Date, upcoming: ReminderRow[]) {
  const nowMs = now.getTime()
  const items: PlanItem[] = []
  const allDay: string[] = []
  const busy: Array<{start: number; end: number}> = []
  let timingUnknown = false
  if (params.calendarOk && params.calendarConnected) {
    for (const e of params.calendarEvents) {
      const span = eventInterval(e, params.tz)
      const blocks = e.blocksTime !== false
      if (span && span.end <= nowMs) continue
      if (blocks && !span) timingUnknown = true
      if (blocks && span) busy.push(span)
      if (e.allDay || (!e.startAt && !e.time)) {
        allDay.push(e.title + (!span ? ' (end time unverified)' : ''))
        continue
      }
      let at = span?.start ?? (e.startAt ? Date.parse(e.startAt) : NaN)
      // A legacy clock can display an uncertain item; it cannot establish availability.
      if (!span && e.time && (!Number.isFinite(at) || dayKeyIn(at, params.tz) !== dayKeyIn(nowMs, params.tz))) at = todayAtClock(e.time, nowMs, params.tz)
      const note = !span ? 'end time unverified' : span.start < nowMs ? `ongoing until ${clock(new Date(span.end).toISOString(), params.tz)}` : ''
      items.push({at: Number.isFinite(at) ? Math.max(at, nowMs) : nowMs, label: e.title, kind: 'meeting', note: [note, !blocks ? 'does not block time' : '', e.note || ''].filter(Boolean).join(' · ')})
    }
  }
  for (const r of upcoming) items.push({ at: new Date(r.remind_at).getTime(), label: cleanLabel(r.message), kind: 'reminder' })
  items.sort((a, b) => a.at - b.at)

  const lines: string[] = [`Your plan for the rest of today:`]
  if (allDay.length) lines.push(`All day — ${allDay.join(', ')}`)
  if (!items.length && !allDay.length) lines.push(params.calendarIncomplete || !params.calendarOk || !params.calendarConnected ? 'The incomplete calendar cannot establish what is scheduled from now on.' : `Nothing scheduled from now on.`)
  for (const item of items.slice(0, 8)) {
    lines.push(`${clock(new Date(item.at).toISOString(), params.tz)} — ${item.label}${item.kind === 'meeting' ? ' (meeting)' : ''}${item.note ? ` · ${item.note}` : ''}`)
  }
  if (items.length > 8) lines.push(`+${items.length - 8} more`)

  if (typeof params.approvalsWaiting === 'number' && params.approvalsWaiting > 0) {
    lines.push('', `Needs you: ${params.approvalsWaiting} decision${params.approvalsWaiting === 1 ? '' : 's'} waiting. Open Needs you to clear them.`)
  }

  // Complement of verified busy intervals until 10 pm. Reminders are moments.
  const nowMinutes = minutesIn(nowMs, params.tz)
  const endOfDay = todayAtClock('10:00 PM', nowMs, params.tz)
  // Only during waking hours: at 1 am "free until 10 pm" is not a useful fact.
  if (params.remindersOk && params.calendarOk && params.calendarConnected && !params.calendarIncomplete && !timingUnknown && endOfDay > nowMs && nowMinutes >= 6 * 60) {
    let cursor = nowMs, best = { from: 0, to: 0 }
    const intervals = [...busy, ...upcoming.map(r => ({start: Date.parse(r.remind_at), end: Date.parse(r.remind_at)}))]
      .filter(span => span.end >= nowMs && span.start < endOfDay).sort((a, b) => a.start - b.start)
    for (const span of intervals) {
      if (span.start - cursor > best.to - best.from) best = { from: cursor, to: span.start }
      cursor = Math.max(cursor, span.end)
    }
    if (endOfDay - cursor > best.to - best.from) best = { from: cursor, to: endOfDay }
    if (best.to - best.from >= 60 * 60_000) {
      lines.push('', `Longest free stretch: ${clock(new Date(best.from).toISOString(), params.tz)} – ${clock(new Date(best.to).toISOString(), params.tz)}.`)
    }
  }
  if (timingUnknown) lines.push('', 'Some calendar end times are unverified, so free time cannot be established.')
  if (!params.remindersOk || !params.calendarOk || params.calendarIncomplete) lines.push('', `Part of your day could not be loaded, so this plan may be missing items.`)
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
    calendarIncomplete: calendar.ok && calendar.connected ? calendar.incomplete : false,
    calendarConnected: calendar.ok ? calendar.connected : false,
    calendarEvents: calendar.ok && calendar.connected ? calendar.events : [],
    approvalsWaiting: approvals,
  })
}
