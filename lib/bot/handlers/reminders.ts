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

function compactTimeParts(digits: string): { hour: number; minute: number } | null {
  if (!/^\d{3,4}$/.test(digits)) return null
  const hour = parseInt(digits.slice(0, -2), 10)
  const minute = parseInt(digits.slice(-2), 10)
  if (hour < 1 || hour > 12 || minute > 59) return null
  return { hour, minute }
}

export function getAmbiguousReminderTime(text: string): { label: string; hour: number; minute: number } | null {
  // With smart AM/PM defaults applied, times are no longer truly ambiguous
  // Only flag as ambiguous if the hour is genuinely unclear (e.g. "remind me at 8" could be 8am or 8pm)
  // For 7-11: could be AM or PM — these remain ambiguous
  // For 1-6 and 12: smart default to PM — not ambiguous
  const raw = text || ''
  if (/\b\d{1,4}([:.]\d{2})?\s*(am|pm)\b/i.test(raw)) return null
  if (!/\b(remind|wake|alarm|set|tomorrow|tmrw|tmr|at)\b/i.test(raw)) return null

  const hourOnly = raw.match(/\bat\s+(\d{1,2})\b/i)
  if (hourOnly) {
    const hour = parseInt(hourOnly[1], 10)
    // Only 7-11 are truly ambiguous (could be AM or PM)
    // 1-6 default to PM, 12 defaults to PM — not ambiguous
    if (hour >= 7 && hour <= 11) return { label: `${hour}:00`, hour, minute: 0 }
    return null  // smart default applies, not ambiguous
  }

  return null
}

export function buildAmPmClarificationReply(text: string) {
  const ambiguous = getAmbiguousReminderTime(text)
  const label = ambiguous?.label || 'that time'
  return (
    `Quick check — did you mean *${label} AM* or *${label} PM*?\n\n` +
    `Reply like:\n` +
    `• ${label} am\n` +
    `• ${label} pm`
  )
}

function applySmartAmPm(hour: number, hasAmPm: boolean, ampm?: string): number {
  if (hasAmPm && ampm) {
    if (ampm.toLowerCase() === 'pm' && hour !== 12) return hour + 12
    if (ampm.toLowerCase() === 'am' && hour === 12) return 0
    return hour
  }
  // Smart defaults: 1-6 without AM/PM = PM (daytime work hours), 7-11 = AM, 12 = PM
  if (hour >= 1 && hour <= 6) return hour + 12  // 1→13, 2→14 ... 6→18
  if (hour === 12) return 12  // noon
  return hour  // 7-11 stay as AM
}

function parseTimePart(input: string): { hour: number; minute: number } | null {
  // Normalize spoken/written variants: "p.m." → "pm", "a.m." → "am", "around X" → "X"
  const raw = (input || '')
    .replace(/\bp\.\s*m\.?\b/gi, 'pm')
    .replace(/\ba\.\s*m\.?\b/gi, 'am')
    .replace(/\baround\s+/gi, '')
    .replace(/\babout\s+/gi, '')

  const compact = raw.match(/\b(\d{3,4})\s*(am|pm)\b/i)
  if (compact) {
    const digits = compact[1]
    const ampm = compact[2].toLowerCase()
    let hour = parseInt(digits.slice(0, -2), 10)
    const minute = parseInt(digits.slice(-2), 10)

    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0

    if (hour <= 23 && minute <= 59) return { hour, minute }
  }

  const dotTime = raw.match(/\b(\d{1,2})\.(\d{2})\s*(am|pm)?\b/i)
  if (dotTime) {
    let hour = parseInt(dotTime[1], 10)
    const minute = parseInt(dotTime[2], 10)
    const ampm = dotTime[3]?.toLowerCase()

    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0

    if (hour <= 23 && minute <= 59) return { hour, minute }
  }

  const match = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!match) return null

  let hour = parseInt(match[1], 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const ampm = match[3]?.toLowerCase()

  if (ampm === 'pm' && hour < 12) hour += 12
  else if (ampm === 'am' && hour === 12) hour = 0
  else if (!ampm) {
    // Smart defaults: 1-6 = PM, 7-11 = AM, 12 = noon
    if (hour >= 1 && hour <= 6) hour += 12
  }

  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

function extractListNameFromText(text: string): string {
  const lower = text.toLowerCase()
  if (lower.includes('shopping')) return 'shopping'
  if (lower.includes('todo')) return 'todo'
  if (lower.includes('to-do')) return 'todo'
  if (lower.includes('grocery')) return 'grocery'
  return 'list'
}

function extractTaskAfterTo(input: string) {
  // Only use "task after to" for patterns like "remind me to call X"
  // Don't use for "Send X to Y" — that would strip the subject
  const reminderVerbs = /\b(remind|set|schedule|book|call|email|message|text|send|ping|follow up|check|do|complete|finish|submit|pay|buy|order)/i
  const match = input.match(/\bremind(?:\s+me)?\s+to\s+(.+)$/i)
  if (!match) {
    // Only extract "to Y" if it looks like a standalone recipient, not part of the task
    const toPersonMatch = input.match(/\bto\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:at|by|around|before|after|in|on|$)/i)
    if (toPersonMatch) return null // Let cleanMessageText handle it naturally
    return null
  }

  const task = match[1]
    .replace(/\b(?:at|for)\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\b/gi, '')
    .replace(/\b\d{1,2}[:.]\d{2}\s*(?:am|pm)?\b/gi, '')
    .replace(/\b\d{1,4}([:.]\d{2})?\s*(am|pm)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  return task || null
}

function cleanMessageText(input: string): string {
  const taskAfterTo = extractTaskAfterTo(input)

  let cleaned = input
    // Normalize spoken p.m./a.m. before stripping
    .replace(/\bp\.\s*m\.?\b/gi, 'pm')
    .replace(/\ba\.\s*m\.?\b/gi, 'am')
    // Strip trailing filler from voice ("So remind me", "Just remind me", "okay", etc.)
    .replace(/[,.]?\s*\b(so|just|please)\s+remind\s+me\.?$/gi, '')
    .replace(/[,.]?\s*\bjust\s+remind\.?$/gi, '')
    .replace(/[,.]?\s*\bremind\s+me\.?$/gi, '')
    .replace(/[,.]?\s*\b(so|just)\b\.?$/gi, '')
    .replace(/[,.]?\s*\b(okay|ok|yeah|yep|right)\b\.?$/gi, '')
    .replace(/[,.]?\s*\bwill\s+(pick|collect|get|grab|bring|come|be)\b.{0,60}$/gi, '')
    .replace(/[,.]?\s*\b(pick it up|collect it|come by|drop by|swing by).{0,60}$/gi, '')
    .replace(/[,.]?\s*\bfrom you\b.{0,40}$/gi, '')
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
    .replace(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\b(?:at|for)\s+\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\b/gi, '')
    .replace(/\b\d{1,2}[:.]\d{2}\s*(?:am|pm)?\b/gi, '')
    .replace(/\b\d{1,4}([:.]\d{2})?\s*(am|pm)\b/gi, '')
    .replace(/\bfrom\s+.+?\s+to\s+.+?(daily)?$/gi, '')

    .replace(/[.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  cleaned = cleaned.replace(/^(to|for|every)\s+/i, '').trim()
  cleaned = cleaned.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim()

  // Only use taskAfterTo as fallback if cleaned is empty/generic
  // Don't use it when it would discard the subject (e.g. "Send X to Y" → don't reduce to "Y")
  const taskAfterToIsSubset = taskAfterTo && cleaned && cleaned.length > taskAfterTo.length + 10
  if ((!cleaned || cleaned === 'Reminder' || cleaned.toLowerCase().startsWith('every ')) && taskAfterTo && !taskAfterToIsSubset) {
    cleaned = taskAfterTo
  }

  if (/^every\s+to\s+/i.test(cleaned) && taskAfterTo) {
    cleaned = taskAfterTo
  }

  return cleaned || taskAfterTo || 'Reminder'
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
  if (targetMinutes <= currentMinutes) targetDate = addIstDays(nowIst, 1)
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

  if (unit.startsWith('day')) {
    const textWithoutRelative = text.replace(/\bin\s+\d+\s+(days?|hours?|mins?|minutes?)\b/gi, '')
    const timeOverride = parseTimePart(textWithoutRelative)
    if (timeOverride) when.setHours(timeOverride.hour, timeOverride.minute, 0, 0)
  }

  return { kind: 'one_time', remindAtIso: when.toISOString(), message: cleanMessageText(text) }
}

function parseDailyRecurring(text: string): ParsedReminder {
  const lower = text.toLowerCase()
  const isDaily = /\bevery\s+day\b/i.test(lower) || /\bdaily\b/i.test(lower) || /\bevery\s+morning\b/i.test(lower) || /\bevery\s+evening\b/i.test(lower) || /\bevery\s+night\b/i.test(lower)
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
  if (getAmbiguousReminderTime(text)) return null
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
  if (getAmbiguousReminderTime(text)) return null
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
  if (getAmbiguousReminderTime(text)) return null
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
  // Handle both "at 1:30" and "for 1:30" (Whisper often transcribes as "for")
  if (!/\b(at|for)\s+\d/i.test(text)) return null
  if (/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)) return null
  if (getAmbiguousReminderTime(text)) return null
  const timeMatch = text.match(/\b(?:at|for)\s+(\d[^.]*?)(?:\s+to\s+|\s+and\s+|$)/i)
    || text.match(/\b(?:at|for)\s+(.+)$/i)
  if (!timeMatch) return null
  const time = parseTimePart(timeMatch[1])
  if (!time) return null
  const when = nextDailyTime(time)
  return { kind: 'one_time', remindAtIso: when.toISOString(), message: cleanMessageText(text) }
}

// ---- Phase 0: absolute-date reminders ("27th", "18 June", "Dec 25") ----
const MONTHS_ABS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function parseAbsoluteDateReminder(text: string): ParsedReminder {
  // Only fire on explicit reminder/scheduling intent
  if (!/\b(remind|reminder|alert|notify|ping|wake|alarm|schedule)\b/i.test(text)) return null

  const monthAlt =
    'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?' +
    '|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthAlt})(?:\\s+(\\d{4}))?\\b`, 'i')
  const monthDay = new RegExp(`\\b(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i')

  let day: number | null = null
  let monthName: string | null = null
  let yearStr: string | undefined
  let dateMatch = text.match(dayMonth)
  if (dateMatch) {
    day = parseInt(dateMatch[1], 10); monthName = dateMatch[2]; yearStr = dateMatch[3]
  } else {
    dateMatch = text.match(monthDay)
    if (dateMatch) { monthName = dateMatch[1]; day = parseInt(dateMatch[2], 10); yearStr = dateMatch[3] }
  }

  // Fallback: bare ordinal like "27th" / "on the 27th" (no month named)
  if (day === null || !monthName || !dateMatch) {
    const ordMatch = text.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(st|nd|rd|th)\b/i)
    if (!ordMatch) return null
    const d = parseInt(ordMatch[1], 10)
    if (d < 1 || d > 31) return null

    const timeMatch2 = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
    const time2 = (timeMatch2 && parseTimePart(timeMatch2[0])) || { hour: 9, minute: 0 }

    const nowIst2 = istNowParts()
    let y = nowIst2.year, m = nowIst2.month
    let when2 = istWallTimeToUtcDate(y, m, d, time2.hour, time2.minute)
    if (when2.getTime() <= Date.now() || isNaN(when2.getTime())) {
      m += 1; if (m > 12) { m = 1; y += 1 }
      when2 = istWallTimeToUtcDate(y, m, d, time2.hour, time2.minute)
    }
    if (isNaN(when2.getTime())) return null

    let msgInput2 = text.replace(ordMatch[0], ' ')
    if (timeMatch2) msgInput2 = msgInput2.replace(timeMatch2[0], ' ')
    return { kind: 'one_time', remindAtIso: when2.toISOString(), message: cleanMessageText(msgInput2) }
  }

  const month = MONTHS_ABS[monthName.toLowerCase().slice(0, 3)]
  if (!month || day < 1 || day > 31) return null

  // Time: only from an explicit time token — never the bare day number
  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || text.match(/\b(\d{1,2}):(\d{2})\b/)
  const time = (timeMatch && parseTimePart(timeMatch[0])) || { hour: 9, minute: 0 }

  const nowIst = istNowParts()
  let year = yearStr ? parseInt(yearStr, 10) : nowIst.year
  if (!yearStr) {
    const candidate = istWallTimeToUtcDate(year, month, day, time.hour, time.minute)
    if (candidate.getTime() <= Date.now()) year += 1 // date already passed -> next year
  }

  const when = istWallTimeToUtcDate(year, month, day, time.hour, time.minute)
  if (isNaN(when.getTime())) return null

  // Strip date + explicit time so the task text stays clean
  let msgInput = text.replace(dateMatch[0], ' ')
  if (timeMatch) msgInput = msgInput.replace(timeMatch[0], ' ')
  return { kind: 'one_time', remindAtIso: when.toISOString(), message: cleanMessageText(msgInput) }
}

export function parseReminderIntent(text: string): ParsedReminder {
  return parseDailyRecurring(text) || parseEveryNRecurring(text) || parseRelativeReminder(text) || parseTomorrowReminder(text) || parseSpecificWeekdayReminder(text) || parseWeekdayRecurring(text) || parseHourlyWindowRecurring(text) || parseAbsoluteDateReminder(text) || parseSimpleAtTime(text) || null
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






