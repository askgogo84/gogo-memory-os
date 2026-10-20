import {isValidTimezone, parseLocalDateTime} from './timezone'

export type CalendarProviderEvent = {
  start?: {dateTime?: string; date?: string}; end?: {dateTime?: string; date?: string};
  endTimeUnspecified?: boolean; status?: string; transparency?: string;
  attendees?: Array<{self?: boolean; responseStatus?: string}>;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function explicitInstant(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN
  if (!validDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || (value[16] === ':' && Number(value.slice(17, 19)) > 59)) return NaN
  return Date.parse(value)
}

/** Google all-day end dates are exclusive. Missing/invalid ends prove no interval. */
export function calendarInterval(event: CalendarProviderEvent, timezone: string) {
  if (event.endTimeUnspecified === true) return null
  if (event.start?.dateTime || event.end?.dateTime) {
    const start = explicitInstant(event.start?.dateTime), end = explicitInstant(event.end?.dateTime)
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? {start, end, allDay: false} : null
  }
  if (validDate(event.start?.date) && validDate(event.end?.date) && isValidTimezone(timezone)) {
    try {
      const start = parseLocalDateTime({date: event.start.date, time: '00:00', timezone}).dueAtUtc.getTime()
      const end = parseLocalDateTime({date: event.end.date, time: '00:00', timezone}).dueAtUtc.getTime()
      if (end > start) return {start, end, allDay: true}
    } catch {}
  }
  return null
}

export function calendarBlocksTime(event: CalendarProviderEvent) {
  return event.status !== 'cancelled' && event.transparency !== 'transparent' &&
    !(Array.isArray(event.attendees) && event.attendees.some(attendee => attendee.self === true && attendee.responseStatus === 'declined'))
}

/**
 * 20 Oct live: a broken recurring invite ("Daily Connect-Standup Call") had ~9 entries that each span ~3 weeks
 * (Thu 8 Oct 11:30 am – Sat 31 Oct 11:45 am), all overlapping every day. Every calendar surface shows it the
 * same way: one line at its daily time (11:30 am – 11:45 am) with a note, never as N multi-week ranges or as
 * "ongoing" all day. A timed entry longer than a day is treated as a daily slot at its start/end clock times.
 */
export const LONG_SPAN_MS = 24 * 3600_000

function localMinute(ms: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(ms))
  return Number(parts.find(p => p.type === 'hour')?.value || 0) % 24 * 60 + Number(parts.find(p => p.type === 'minute')?.value || 0)
}

/** Daily clock window of a timed entry longer than a day; null for normal and all-day entries. */
export function longSpanDailyWindow(start: string | null | undefined, end: string | null | undefined, timezone: string) {
  const s = Date.parse(String(start || '')), e = Date.parse(String(end || ''))
  if (!/T/.test(String(start || '')) || !Number.isFinite(s) || !Number.isFinite(e) || e - s <= LONG_SPAN_MS || !isValidTimezone(timezone)) return null
  return {startMinute: localMinute(s, timezone), endMinute: localMinute(e, timezone)}
}

/** The daily slot of a long-span entry on one local date (YYYY-MM-DD); an end clock at/before the start ends next day. */
export function dailyOccurrenceOn(daily: {startMinute: number; endMinute: number}, date: string, timezone: string) {
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  try {
    const start = parseLocalDateTime({date, time: hhmm(daily.startMinute), timezone}).dueAtUtc.getTime()
    let end = parseLocalDateTime({date, time: hhmm(daily.endMinute), timezone}).dueAtUtc.getTime()
    if (end <= start) end += LONG_SPAN_MS
    return {start, end}
  } catch { return null }
}

export function longSpanNote(count: number) {
  return `${count > 1 ? `${count} overlapping entries, each` : 'this entry'} spans several days, so the invite may be set up wrongly`
}

export type CalendarCollapseGroup<T> = {first: T; members: T[]; count: number; daily: {startMinute: number; endMinute: number} | null}

/**
 * Shared collapse for every calendar surface. Long-span entries with the same title, account and daily start
 * become one group; other entries group only when `dupKey` matches (exact duplicates). First-appearance order.
 */
export function collapseCalendarEntries<T>(entries: T[], view: (entry: T) => {title: string; account?: string; start?: string | null; end?: string | null; dupKey: string}, timezone: string): CalendarCollapseGroup<T>[] {
  const groups = new Map<string, CalendarCollapseGroup<T>>()
  for (const entry of entries) {
    const v = view(entry)
    const daily = longSpanDailyWindow(v.start, v.end, timezone)
    const key = daily ? `long|${v.title}|${v.account || ''}|${daily.startMinute}` : `line|${v.dupKey}`
    const g = groups.get(key)
    if (g) { g.members.push(entry); g.count++ }
    else groups.set(key, {first: entry, members: [entry], count: 1, daily})
  }
  return [...groups.values()]
}
