import {parseLocalDateTime} from './timezone'

export type CalendarProviderEvent = {
  start?: {dateTime?: string; date?: string}; end?: {dateTime?: string; date?: string};
  endTimeUnspecified?: boolean; status?: string; transparency?: string;
  attendees?: Array<{self?: boolean; responseStatus?: string}>;
}

function explicitInstant(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN
  const date = new Date(value.slice(0, 10) + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN
  return Date.parse(value)
}

/** Google all-day end dates are exclusive. Missing/invalid ends prove no interval. */
export function calendarInterval(event: CalendarProviderEvent, timezone: string) {
  if (event.endTimeUnspecified === true) return null
  if (event.start?.dateTime || event.end?.dateTime) {
    const start = explicitInstant(event.start?.dateTime), end = explicitInstant(event.end?.dateTime)
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? {start, end, allDay: false} : null
  }
  if (event.start?.date && event.end?.date) {
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
    !event.attendees?.some(attendee => attendee.self === true && attendee.responseStatus === 'declined')
}
