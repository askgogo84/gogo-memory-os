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

function getNowIST(): Date {
  const now = new Date()
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

function toIsoWithOffset(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = '00'
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`
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
    .replace(/\bset a reminder\b/gi, '')
    .replace(/\bset reminder\b/gi, '')
    .replace(/\bremind me to\b/gi, '')
    .replace(/\bremind me\b/gi, '')
    .replace(/\bin\s+\d+\s+(minute|minutes|hour|hours|day|days)\b/gi, '')
    .replace(/\b(tomorrow|tmrw|tmr)\b/gi, '')
    .replace(/\bevery\s+hour\s+from\s+.+?\s+to\s+.+?(daily)?$/gi, '')
    .replace(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+.+$/gi, '')
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, '')
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, '')
    .replace(/[.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  cleaned = cleaned.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim()

  return cleaned || 'Reminder'
}

function parseRelativeReminder(text: string, now: Date): ParsedReminder {
  const match = text.match(/\bin\s+(\d+)\s+(minute|minutes|hour|hours|day|days)\b/i)
  if (!match) return null

  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  const when = new Date(now)

  if (unit.startsWith('minute')) when.setMinutes(when.getMinutes() + value)
  else if (unit.startsWith('hour')) when.setHours(when.getHours() + value)
  else if (unit.startsWith('day')) when.setDate(when.getDate() + value)

  return {
    kind: 'one_time',
    remindAtIso: toIsoWithOffset(when),
    message: cleanMessageText(text),
  }
}

function parseTomorrowReminder(text: string, now: Date): ParsedReminder {
  if (!/\b(tomorrow|tmrw|tmr)\b/i.test(text)) return null

  const time = parseTimePart(text)
  const when = new Date(now)
  when.setDate(when.getDate() + 1)
  when.setSeconds(0, 0)

  if (time) {
    when.setHours(time.hour, time.minute, 0, 0)
  } else {
    when.setHours(9, 0, 0, 0)
  }

  return {
    kind: 'one_time',
    remindAtIso: toIsoWithOffset(when),
    message: cleanMessageText(text),
  }
}

function parseWeekdayRecurring(text: string, now: Date): ParsedReminder {
  const match = text.match(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(.+)$/i)
  if (!match) return null

  const weekdayName = match[1].toLowerCase()
  const time = parseTimePart(match[2])
  if (!time) return null

  const targetDay = WEEKDAYS.indexOf(weekdayName)
  const when = new Date(now)
  const currentDay = when.getDay()

  let delta = targetDay - currentDay
  if (delta < 0) delta += 7
  if (delta === 0) {
    const currentMinutes = when.getHours() * 60 + when.getMinutes()
    const targetMinutes = time.hour * 60 + time.minute
    if (targetMinutes <= currentMinutes) delta = 7
  }

  when.setDate(when.getDate() + delta)
  when.setHours(time.hour, time.minute, 0, 0)

  return {
    kind: 'recurring',
    remindAtIso: toIsoWithOffset(when),
    message: cleanMessageText(text),
    pattern: `every ${match[1]}`,
  }
}

function parseHourlyWindowRecurring(text: string, now: Date): ParsedReminder {
  const match = text.match(/\bevery\s+hour\s+from\s+(.+?)\s+to\s+(.+?)(?:\s+daily)?$/i)
  if (!match) return null

  const start = parseTimePart(match[1])
  const end = parseTimePart(match[2])
  if (!start || !end) return null

  const when = new Date(now)
  when.setHours(start.hour, start.minute, 0, 0)

  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const startMinutes = start.hour * 60 + start.minute

  if (currentMinutes >= startMinutes) {
    while (when <= now) {
      when.setHours(when.getHours() + 1)
    }
  }

  return {
    kind: 'recurring',
    remindAtIso: toIsoWithOffset(when),
    message: cleanMessageText(text),
    pattern: `hourly_between:${String(start.hour).padStart(2, '0')}:${String(start.minute).padStart(2, '0')}-${String(end.hour).padStart(2, '0')}:${String(end.minute).padStart(2, '0')}:daily`,
  }
}

function parseSimpleAtTime(text: string, now: Date): ParsedReminder {
  if (!/^remind me/i.test(text)) return null
  if (!/\bat\s+/i.test(text)) return null

  const timeMatch = text.match(/\bat\s+(.+)$/i)
  if (!timeMatch) return null

  const time = parseTimePart(timeMatch[1])
  if (!time) return null

  const when = new Date(now)
  when.setHours(time.hour, time.minute, 0, 0)

  if (when <= now) {
    when.setDate(when.getDate() + 1)
  }

  return {
    kind: 'one_time',
    remindAtIso: toIsoWithOffset(when),
    message: cleanMessageText(text),
  }
}

export function parseReminderIntent(text: string): ParsedReminder {
  const now = getNowIST()

  return (
    parseRelativeReminder(text, now) ||
    parseTomorrowReminder(text, now) ||
    parseWeekdayRecurring(text, now) ||
    parseHourlyWindowRecurring(text, now) ||
    parseSimpleAtTime(text, now) ||
    null
  )
}

export function buildReminderConfirmation(parsed: Exclude<ParsedReminder, null>): string {
  if (parsed.kind === 'one_time') {
    return `Done — I'll remind you for *${parsed.message}* at *${parsed.remindAtIso}*.`
  }

  return `Done — I've set a recurring reminder for *${parsed.message}* starting at *${parsed.remindAtIso}* with pattern *${parsed.pattern}*.`
}
