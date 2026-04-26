type ParsedReminder =
  | {
      kind: 'one_time'
      remindAtIso: string
      message: string
    }
  | {
      kind: 'recurring'
      remindAtIso: string
      message: string
      pattern: string
    }
  | null

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

function istNowParts() {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'long',
  }).formatToParts(now)

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00'

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: (get('weekday') || '').toLowerCase(),
  }
}

function istWallTimeToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0))
}

function addIstDays(parts: { year: number; month: number; day: number }, daysToAdd: number) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysToAdd, 0, 0, 0))

  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

function parseTimePart(input: string): { hour: number; minute: number } | null {
  const match = input.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!match) return null

  let hour = parseInt(match[1], 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const ampm = match[3]?.toLowerCase()

  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0

  if (hour > 23 || minute > 59) return null

  return { hour, minute }
}

function cleanMessageText(input: string): string {
  let cleaned = input
    .replace(/\bplease\b/gi, '')
    .replace(/\bkindly\b/gi, '')
    .replace(/\bfor me\b/gi, '')

    .replace(/\bset a reminder to\b/gi, '')
    .replace(/\bset a reminder for\b/gi, '')
    .replace(/\bset a reminder\b/gi, '')
    .replace(/\bset reminder to\b/gi, '')
    .replace(/\bset reminder for\b/gi, '')
    .replace(/\bset reminder\b/gi, '')
    .replace(/\bremind me to\b/gi, '')
    .replace(/\bremind me for\b/gi, '')
    .replace(/\bremind to\b/gi, '')
    .replace(/\bremind for\b/gi, '')
    .replace(/\bremind me\b/gi, '')
    .replace(/\bremind\b/gi, '')

    .replace(/\bin\s+\d+\s+(minute|minutes|min|mins|hour|hours|day|days)\b/gi, '')
    .replace(/\b(tomorrow|tmrw|tmr)\b/gi, '')
    .replace(/\bevery\s+(day|daily|morning|evening|night)\b/gi, '')
    .replace(/\bdaily\b/gi, '')
    .replace(/\bevery\s+\d+\s+(minute|minutes|min|mins|hour|hours)\b/gi, '')
    .replace(/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, '')
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, '')
    .replace(/\bfrom\s+.+?\s+to\s+.+?(daily)?$/gi, '')

    .replace(/[.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  cleaned = cleaned.replace(/^(to|for)\s+/i, '').trim()
  cleaned = cleaned.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim()

  return cleaned || 'Reminder'
}

function formatReminderTime(iso: string): string {
  const target = new Date(iso)
  const now = new Date()

  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)

  const targetDay = fmtDate(target)
  const today = fmtDate(now)
  const tomorrow = fmtDate(new Date(now.getTime() + 24 * 60 * 60 * 1000))

  const timeText = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(target)

  if (targetDay === today) return `today at ${timeText}`
  if (targetDay === tomorrow) return `tomorrow at ${timeText}`

  const dateText = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(target)

  return `${dateText} at ${timeText}`
}

function nextDailyTime(time: { hour: number; minute: number }) {
  const nowIst = istNowParts()
  let targetDate = { year: nowIst.year, month: nowIst.month, day: nowIst.day }

  const currentMinutes = nowIst.hour * 60 + nowIst.minute
  const targetMinutes = time.hour * 60 + time.minute

  if (targetMinutes <= currentMinutes) {
    targetDate = addIstDays(nowIst, 1)
  }

  return istWallTimeToUtcDate(targetDate.year, targetDate.month, targetDate.day, time.hour, time.minute)
}

function parseRelativeReminder(text: string): ParsedReminder {
  const match = text.match(/\bin\s+(\d+)\s+(minute|minutes|min|mins|hour|hours|day|days)\b/i)
  if (!match) return null

  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  const when = new Date()

  if (unit.startsWith('min')) when.setMinutes(when.getMinutes() + value)
  else if (unit.startsWith('hour')) when.setHours(when.getHours() + value)
  else if (unit.startsWith('day')) when.setDate(when.getDate() + value)

  return { kind: 'one_time', remindAtIso: when.toISOString(), message: cleanMessageText(text) }
}

function parseDailyRecurring(text: string): ParsedReminder {
  const lower = text.toLowerCase()
  const isDaily =
    /\bevery\s+day\b/i.test(lower) ||
    /\bdaily\b/i.test(lower) ||
    /\bevery\s+morning\b/i.test(lower) ||
    /\bevery\s+evening\b/i.test(lower) ||
    /\bevery\s+night\b/i.test(lower)

  if (!isDaily) return null

  let time = parseTimePart(text)

  if (!time) {
    if (/every\s+morning/i.test(lower)) time = { hour: 9, minute: 0 }
    else if (/every\s+evening/i.test(lower)) time = { hour: 18, minute: 0 }
    else if (/every\s+night/i.test(lower)) time = { hour: 21, minute: 0 }
    else time = { hour: 9, minute: 0 }
  }

  const when = nextDailyTime(time)

  return {
    kind: 'recurring',
    remindAtIso: when.toISOString(),
    message: cleanMessageText(text),
    pattern: `daily:${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
  }
}

function parseEveryNRecurring(text: string): ParsedReminder {
  const match = text.match(/\bevery\s+(\d+)\s+(minute|minutes|min|mins|hour|hours)\b/i)
  if (!match) return null

  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  const when = new Date()

  if (unit.startsWith('hour')) when.setHours(when.getHours() + value)
  else when.setMinutes(when.getMinutes() + value)

  return {
    kind: 'recurring',
    remindAtIso: when.toISOString(),
    message: cleanMessageText(text),
    pattern: unit.startsWith('hour') ? `every_${value}_hours` : `every_${value}_minutes`,
  }
}

function parseTomorrowReminder(text: string): ParsedReminder {
  if (!/\b(tomorrow|tmrw|tmr)\b/i.test(text)) return null

  const nowIst = istNowParts()
  const nextDay = addIstDays(nowIst, 1)
  const time = parseTimePart(text) || { hour: 9, minute: 0 }
  const when = istWallTimeToUtcDate(nextDay.year, nextDay.month, nextDay.day, time.hour, time.minute)

  return { kind: 'one_time', remindAtIso: when.toISOString(), message: cleanMessageText(text) }
}

function parseSpecificWeekdayReminder(text: string): ParsedReminder {
  if (/\bevery\s+/i.test(text)) return null

  const match = text.match(/\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  if (!match) return null

  const weekdayName = match[1].toLowerCase()
  const time = parseTimePart(text) || { hour: 9, minute: 0 }
  const nowIst = istNowParts()
  const targetDay = WEEKDAYS.indexOf(weekdayName)
  const currentDayIndex = WEEKDAYS.indexOf(nowIst.weekday)

  let delta = targetDay - currentDayIndex
  if (delta < 0) delta += 7

  const currentMinutes = nowIst.hour * 60 + nowIst.minute
  const targetMinutes = time.hour * 60 + time.minute
  if (delta === 0 && targetMinutes <= currentMinutes) delta = 7

  const targetDate = addIstDays(nowIst, delta)
  const when = istWallTimeToUtcDate(targetDate.year, targetDate.month, targetDate.day, time.hour, time.minute)

  return { kind: 'one_time', remindAtIso: when.toISOString(), message: cleanMessageText(text) }
}

function parseWeekdayRecurring(text: string): ParsedReminder {
  const match = text.match(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(.+))?/i)
  if (!match) return null

  const weekdayName = match[1].toLowerCase()
  const time = parseTimePart(match[2] || text) || { hour: 9, minute: 0 }
  const nowIst = istNowParts()
  const targetDay = WEEKDAYS.indexOf(weekdayName)
  const currentDayIndex = WEEKDAYS.indexOf(nowIst.weekday)

  let delta = targetDay - currentDayIndex
  if (delta < 0) delta += 7

  const currentMinutes = nowIst.hour * 60 + nowIst.minute
  const targetMinutes = time.hour * 60 + time.minute
  if (delta === 0 && targetMinutes <= currentMinutes) delta = 7

  const targetDate = addIstDays(nowIst, delta)
  const when = istWallTimeToUtcDate(targetDate.year, targetDate.month, targetDate.day, time.hour, time.minute)

  return {
    kind: 'recurring',
    remindAtIso: when.toISOString(),
    message: cleanMessageText(text),
    pattern: `weekly:${weekdayName}:${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`,
  }
}

function parseHourlyWindowRecurring(text: string): ParsedReminder {
  const match = text.match(/\bevery\s+hour\s+from\s+(.+?)\s+to\s+(.+?)(?:\s+daily)?$/i)
  if (!match) return null

  const start = parseTimePart(match[1])
  const end = parseTimePart(match[2])
  if (!start || !end) return null

  const nowIst = istNowParts()
  let candidateHour = start.hour
  let candidateMinute = start.minute

  if (nowIst.hour > start.hour || (nowIst.hour === start.hour && nowIst.minute >= start.minute)) {
    candidateHour = nowIst.minute < start.minute ? nowIst.hour : nowIst.hour + 1
    candidateMinute = start.minute
  }

  let targetDate = { year: nowIst.year, month: nowIst.month, day: nowIst.day }

  if (candidateHour > end.hour || (candidateHour === end.hour && candidateMinute > end.minute)) {
    targetDate = addIstDays(nowIst, 1)
    candidateHour = start.hour
    candidateMinute = start.minute
  }

  const when = istWallTimeToUtcDate(targetDate.year, targetDate.month, targetDate.day, candidateHour, candidateMinute)

  return {
    kind: 'recurring',
    remindAtIso: when.toISOString(),
    message: cleanMessageText(text),
    pattern: `hourly_between:${String(start.hour).padStart(2, '0')}:${String(start.minute).padStart(2, '0')}-${String(end.hour).padStart(2, '0')}:${String(end.minute).padStart(2, '0')}:daily`,
  }
}

function parseSimpleAtTime(text: string): ParsedReminder {
  if (!/^remind/i.test(text) && !/\bset a reminder\b/i.test(text) && !/\bset reminder\b/i.test(text)) return null
  if (!/\bat\s+/i.test(text)) return null
  if (/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)) return null

  const timeMatch = text.match(/\bat\s+(.+)$/i)
  if (!timeMatch) return null

  const time = parseTimePart(timeMatch[1])
  if (!time) return null

  const when = nextDailyTime(time)

  return { kind: 'one_time', remindAtIso: when.toISOString(), message: cleanMessageText(text) }
}

export function parseReminderIntent(text: string): ParsedReminder {
  return (
    parseDailyRecurring(text) ||
    parseEveryNRecurring(text) ||
    parseRelativeReminder(text) ||
    parseTomorrowReminder(text) ||
    parseSpecificWeekdayReminder(text) ||
    parseWeekdayRecurring(text) ||
    parseHourlyWindowRecurring(text) ||
    parseSimpleAtTime(text) ||
    null
  )
}

export function buildReminderConfirmation(parsed: Exclude<ParsedReminder, null>): string {
  const displayTime = formatReminderTime(parsed.remindAtIso)

  if (parsed.kind === 'one_time') {
    if (parsed.message === 'Reminder') return `Done — I'll remind you ${displayTime}.`
    return `Done — I'll remind you to *${parsed.message}* ${displayTime}.`
  }

  const patternText = parsed.pattern.startsWith('daily:')
    ? 'daily'
    : parsed.pattern.startsWith('weekly:')
      ? 'weekly'
      : parsed.pattern.startsWith('every_')
        ? parsed.pattern.replace(/_/g, ' ')
        : 'recurring'

  return `🔁 *Recurring reminder set*\n\n${parsed.message}\nPattern: ${patternText}\nStarts: ${displayTime}.`
}
