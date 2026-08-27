import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkFeatureLimit, logUsage } from '@/lib/limits'
import { saveFollowupState } from './followup-state'
import {
  createCalendarEvent,
  fetchPrimaryCalendarEvents,
  refreshAccessToken,
} from '@/lib/google-calendar'

type CalendarActionResult = {
  handled: boolean
  reply: string
}

// Tolerant "calendar" matcher — canonical spelling set now lives in the zero-import
// lib/data/calendar-word.ts so it can be shared with the list-routing guard without
// dragging this file's @/… deps into the type-stripped harness. Re-exported here so
// existing importers (detect-intent.ts) keep working.
export { CALENDAR_WORD_RE } from '@/lib/data/calendar-word'
import { CALENDAR_WORD_RE } from '@/lib/data/calendar-word'

// Calendar-create SIGNAL phrases, derived from the shared spelling set rather than
// re-encoding the cal[ae]nd[ae]rs? vowel-swaps by hand (that hand-encoding is exactly how
// "calender" leaked). CALENDAR_WORD_RE.source already carries its own \b boundaries.
const CALENDAR_POSSESSIVE_RE = new RegExp(`\\b(?:in|on|to)\\s+(?:my|the|your)\\s+${CALENDAR_WORD_RE.source}`)
const CALENDAR_EVENT_RE = new RegExp(`${CALENDAR_WORD_RE.source}\\s+event\\b`)

type CalendarDateTarget = 'today' | 'tomorrow' | 'day_after_tomorrow'

type CalendarCreatePayload = {
  title: string
  startIso: string
  endIso: string
  displayTime: string
  created_at?: string
}

function istPartsNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
  }
}

function istDatePartsPlusDays(days: number) {
  const now = istPartsNow()
  const anchor = new Date(Date.UTC(now.year, now.month - 1, now.day, 12, 0, 0))
  anchor.setUTCDate(anchor.getUTCDate() + days)

  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  }
}

function istWallTimeToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
) {
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0))
}

function googleDateTimeWithIstOffset(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
) {
  const yyyy = String(year)
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  const hh = String(hour).padStart(2, '0')
  const min = String(minute).padStart(2, '0')

  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`
}

function formatIstDisplayFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
) {
  const utcDate = istWallTimeToUtcDate(year, month, day, hour, minute)

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(utcDate)
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

function targetFromText(text: string): CalendarDateTarget {
  const lower = text.toLowerCase()

  if (lower.includes('day after tomorrow')) return 'day_after_tomorrow'
  if (lower.includes('tomorrow')) return 'tomorrow'

  return 'today'
}

function targetLabel(target: CalendarDateTarget) {
  if (target === 'tomorrow') return 'tomorrow'
  if (target === 'day_after_tomorrow') return 'day after tomorrow'
  return 'today'
}

function targetParts(target: CalendarDateTarget) {
  if (target === 'tomorrow') return istDatePartsPlusDays(1)
  if (target === 'day_after_tomorrow') return istDatePartsPlusDays(2)
  return istDatePartsPlusDays(0)
}

function calendarRangeForTarget(target: CalendarDateTarget) {
  const parts = targetParts(target)
  const startUtc = istWallTimeToUtcDate(parts.year, parts.month, parts.day, 0, 0)
  const endUtc = istWallTimeToUtcDate(parts.year, parts.month, parts.day, 23, 59)

  return {
    timeMin: startUtc.toISOString(),
    timeMax: endUtc.toISOString(),
  }
}

function cleanTitle(text: string) {
  return (text || 'Meeting')
    .replace(/^(add|create|schedule|book|set up)\s+/i, '')
    .replace(/\b(on|in my)?\s*calendar\b/gi, '')
    .replace(/\btomorrow\b/gi, '')
    .replace(/\btoday\b/gi, '')
    .replace(/\bday after tomorrow\b/gi, '')
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?/gi, '')
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTime(text: string) {
  const lower = text.toLowerCase()

  const match =
    lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i) ||
    lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)

  if (!match) return null

  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const ampm = match[3]?.toLowerCase()

  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  if (!ampm && hour >= 1 && hour <= 7) hour += 12

  return { hour, minute }
}

export function parseCalendarCreate(text: string) {
  const lower = text.toLowerCase()

  // Structural detection. The old test matched exact contiguous bigrams ("add meeting",
  // "schedule call"), so a single article broke it: "add a meeting" ≠ "add meeting". A
  // calendar-create needs BOTH a create VERB and a calendar SIGNAL, anywhere in the text,
  // regardless of intervening articles or title words.
  //   verb:   add | schedule | book | create | set up | put
  //   signal: meeting | appointment(s) | appt(s) | call | event, OR the possessive phrase
  //           "in/on/to my|the|your calendar", OR the literal "calendar event".
  // Requiring a create verb is what keeps this from swallowing reminders that merely mention
  // a calendar noun ("remind me to check my calendar", "add milk to my grocery list").
  // FOLLOW-UP: a verb-only phrasing with no calendar noun ("schedule lunch tomorrow") is
  // genuinely ambiguous with a reminder and deliberately stays a reminder here. Resolving
  // that class robustly would need an LLM classification step — deferred; this structural
  // test is zero-latency and covers every reported phrasing.
  const hasCreateVerb = /\b(?:add|schedule|book|create|set\s+up|put)\b/.test(lower)
  const hasCalendarSignal =
    /\b(?:meeting|appointments?|appts?|call|event)\b/.test(lower) ||
    CALENDAR_POSSESSIVE_RE.test(lower) ||  // "in/on/to my|the|your calendar" (+ misspellings)
    CALENDAR_EVENT_RE.test(lower)          // "calendar event" (+ misspellings)
  const isCreate = hasCreateVerb && hasCalendarSignal

  if (!isCreate) return null

  const time = parseTime(text)

  if (!time) {
    return {
      needsTime: true,
      title: cleanTitle(text),
    }
  }

  const target = targetFromText(text)
  const parts = targetParts(target)

  let title = cleanTitle(text)

  if (!title || title.length < 3) {
    title = lower.includes('call') ? 'Call' : 'Meeting'
  }

  title = title.charAt(0).toUpperCase() + title.slice(1)

  const endHourMinute = (() => {
    const endDate = istWallTimeToUtcDate(parts.year, parts.month, parts.day, time.hour, time.minute)
    endDate.setMinutes(endDate.getMinutes() + 30)

    const endParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(endDate)

    return {
      hour: Number(endParts.find((p) => p.type === 'hour')?.value || time.hour),
      minute: Number(endParts.find((p) => p.type === 'minute')?.value || time.minute),
    }
  })()

  return {
    needsTime: false,
    title,
    target,
    start: {
      ...parts,
      hour: time.hour,
      minute: time.minute,
    },
    end: {
      ...parts,
      hour: endHourMinute.hour,
      minute: endHourMinute.minute,
    },
  }
}

export async function getCalendarTokens(telegramId: number) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('google_calendar_connected, google_refresh_token')
    .eq('telegram_id', telegramId)
    .single()

  if (!user?.google_calendar_connected || !user?.google_refresh_token) {
    return {
      connected: false,
      accessToken: null,
    }
  }

  const accessToken = await refreshAccessToken(user.google_refresh_token)

  if (!accessToken) {
    return {
      connected: false,
      accessToken: null,
    }
  }

  return {
    connected: true,
    accessToken,
  }
}

// Throws on a non-200 (bad/expired token, wrong account, Google error) via the shared
// fetch — a failed fetch must NOT masquerade as an empty day. Callers below catch it and
// either surface a "couldn't reach Calendar" reply (view) or degrade to no-conflicts (create).
async function getEventsForTarget(accessToken: string, target: CalendarDateTarget) {
  const range = calendarRangeForTarget(target)
  return fetchPrimaryCalendarEvents(accessToken, range.timeMin, range.timeMax, 'GCAL_TARGET_EVENTS_FAILED')
}

function findConflictingEvents(events: any[], startIso: string, endIso: string) {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()

  return events.filter((event: any) => {
    const eventStart = event?.start?.dateTime
    const eventEnd = event?.end?.dateTime

    if (!eventStart || !eventEnd) return false

    const existingStart = new Date(eventStart).getTime()
    const existingEnd = new Date(eventEnd).getTime()

    return existingStart < end && existingEnd > start
  })
}

async function createEventFromPayload(
  telegramId: number,
  accessToken: string,
  payload: CalendarCreatePayload
) {
  const calendarLimit = await checkFeatureLimit(telegramId, 'calendar_event')

  if (!calendarLimit.allowed) {
    return calendarLimit.upgradeMessage || 'Calendar event limit reached.'
  }

  const created = await createCalendarEvent(
    accessToken,
    payload.title,
    payload.startIso,
    payload.endIso
  )

  if (created?.error) {
    return (
      `📅 *Calendar error*\n\n` +
      `I couldn’t add this event right now.\n\n` +
      `Please try again, or reconnect calendar.`
    )
  }

  await logUsage(telegramId, 'calendar_event', {
    title: payload.title,
    startIso: payload.startIso,
    endIso: payload.endIso,
  })

  return (
    `✅ *Calendar event added*\n\n` +
    `${payload.title}\n` +
    `${payload.displayTime}\n\n` +
    `Duration: 30 mins`
  )
}

export function isCalendarAction(text: string) {
  const lower = (text || '').toLowerCase()

  return (
    CALENDAR_WORD_RE.test(lower) ||   // calendar + common misspellings (calender/calandar/…)
    lower.includes('meeting') ||
    lower.includes('schedule call') ||
    lower.includes('add call') ||
    lower.includes('book call') ||
    lower.includes('add event') ||
    lower.includes('schedule event')
  )
}

export async function createCalendarConflictEvent(
  telegramId: number,
  payload: CalendarCreatePayload
) {
  if (!payload?.title || !payload?.startIso || !payload?.endIso) {
    return null
  }

  if (payload.created_at) {
    const ageMs = Date.now() - new Date(payload.created_at).getTime()
    if (ageMs > 15 * 60 * 1000) return null
  }

  const tokens = await getCalendarTokens(telegramId)

  if (!tokens.connected || !tokens.accessToken) {
    return null
  }

  return await createEventFromPayload(telegramId, tokens.accessToken, payload)
}

// Complete a pending calendar-create once the user answers with a time. The caller resolves
// the answer to an absolute instant (via the shared reminder parser, so "8pm today", "in 2
// hours" and "every Monday 10am" all work); here we just turn that instant into a 30-min
// primary-calendar event. Recurring answers are created as their next single occurrence —
// the create path has no recurrence support (a documented limitation). Returns the reply
// string, or null on a bad instant so the caller can fall through.
export async function createCalendarEventAtIso(
  telegramId: number,
  title: string,
  startIso: string
): Promise<string | null> {
  const start = new Date(startIso)
  if (isNaN(start.getTime())) return null

  const tokens = await getCalendarTokens(telegramId)
  if (!tokens.connected || !tokens.accessToken) {
    return (
      `📅 *Connect Google Calendar*\n\n` +
      `To add this event, connect Calendar once.\n\n` +
      `Type *connect calendar* to get the secure Google link.`
    )
  }

  const end = new Date(start.getTime() + 30 * 60 * 1000)
  const displayTime = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(start)

  return await createEventFromPayload(telegramId, tokens.accessToken, {
    title: title || 'Meeting',
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    displayTime,
  })
}

// Pure "does the user want to SEE their calendar" test — exported so the routing
// harness can assert the same view/create/fall-through precedence prod uses.
export function isCalendarViewRequest(text: string): boolean {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower.includes('calendar today') ||
    lower.includes('calendar tomorrow') ||
    lower.includes('calendar for today') ||
    lower.includes('calendar for tomorrow') ||
    lower.includes('what is on my calendar') ||
    lower.includes("what's on my calendar") ||
    lower.includes('show my calendar')
  )
}

export async function buildCalendarActionReply(
  telegramId: number,
  text: string
): Promise<CalendarActionResult> {
  const wantsCalendarView = isCalendarViewRequest(text)

  const createIntent = parseCalendarCreate(text)

  if (!wantsCalendarView && !createIntent) {
    return {
      handled: false,
      reply: '',
    }
  }

  const tokens = await getCalendarTokens(telegramId)

  if (!tokens.connected || !tokens.accessToken) {
    return {
      handled: true,
      reply:
        `📅 *Connect Google Calendar*\n\n` +
        `To manage meetings and show your daily schedule, connect Calendar once.\n\n` +
        `Type *connect calendar* to get the secure Google link.`,
    }
  }

  if (wantsCalendarView) {
    const target = targetFromText(text)
    let events: any[]
    try {
      events = await getEventsForTarget(tokens.accessToken, target)
    } catch (err) {
      // Fetch failed — say so instead of the empty-day copy, mirroring the morning
      // briefing (getCalendarState → "Couldn't reach Google Calendar"). Empty vs failed
      // must read differently to the user.
      console.error('CALENDAR_VIEW_FETCH_FAILED:', err)
      return {
        handled: true,
        reply:
          `📅 *Your calendar ${targetLabel(target)}*\n\n` +
          `⚠️ Couldn't reach Google Calendar just now — this is a temporary hiccup, not ` +
          `necessarily an empty day. If it keeps happening, reconnect with *connect calendar*.`,
      }
    }

    if (!events.length) {
      return {
        handled: true,
        reply:
          `📅 *Your calendar ${targetLabel(target)}*\n\n` +
          `No calendar events lined up ${targetLabel(target)}.\n\n` +
          `Try:\n` +
          `• Add meeting tomorrow at 4 pm\n` +
          `• Plan my day`,
      }
    }

    return {
      handled: true,
      reply:
        `📅 *Your calendar ${targetLabel(target)}*\n\n` +
        events
          .slice(0, 7)
          .map((event: any) => {
            const title = event.summary || 'Untitled event'
            return `• ${formatEventTime(event)} — ${title}`
          })
          .join('\n') +
        `\n\nTry:\n• add meeting tomorrow at 4 pm\n• plan my day`,
    }
  }

  if (createIntent?.needsTime) {
    // Store the pending create so the user's next message (the time) completes THIS event.
    // Previously nothing was stored, so "8pm" fell through to the reminder path and silently
    // became a reminder instead of a calendar event. Keyed by user with created_at TTL via
    // saveFollowupState — the same store the AM/PM and conflict follow-ups already use.
    await saveFollowupState(telegramId, 'pending_calendar', {
      title: createIntent.title,
      target: targetFromText(text),
    })
    return {
      handled: true,
      reply:
        `📅 *Almost there*\n\n` +
        `What time should I add it?\n\n` +
        `Example:\n` +
        `Add meeting with Rahul tomorrow at 4 pm`,
    }
  }

  if (createIntent && !createIntent.needsTime && createIntent.start && createIntent.end) {
    const start = createIntent.start
    const end = createIntent.end

    const startIso = googleDateTimeWithIstOffset(
      start.year,
      start.month,
      start.day,
      start.hour,
      start.minute
    )

    const endIso = googleDateTimeWithIstOffset(
      end.year,
      end.month,
      end.day,
      end.hour,
      end.minute
    )

    const displayTime = formatIstDisplayFromParts(start.year, start.month, start.day, start.hour, start.minute)
    // Conflict detection is best-effort: if we can't read the day's events (token/API
    // error), don't block the create — proceed as if no known conflicts. Blocking a user's
    // event because the conflict-check fetch failed is worse than skipping the warning.
    let eventsForDay: any[] = []
    try {
      eventsForDay = await getEventsForTarget(tokens.accessToken, createIntent.target)
    } catch (err) {
      console.error('GCAL_CONFLICT_CHECK_FAILED:', err)
    }
    const conflicts = findConflictingEvents(eventsForDay, startIso, endIso)

    if (conflicts.length) {
      const conflict = conflicts[0]
      const payload = {
        title: createIntent.title,
        startIso,
        endIso,
        displayTime,
        created_at: new Date().toISOString(),
      }

      await saveFollowupState(telegramId, 'calendar_conflict', payload)

      return {
        handled: true,
        reply:
          `⚠️ *Calendar conflict found*\n\n` +
          `You already have:\n` +
          `• ${formatEventTime(conflict)} — ${conflict.summary || 'Calendar event'}\n\n` +
          `New event:\n` +
          `• ${displayTime} — ${createIntent.title}\n\n` +
          `Reply *yes* to add anyway, or send another time like *move to 4:30 pm*.`,
      }
    }

    const reply = await createEventFromPayload(telegramId, tokens.accessToken, {
      title: createIntent.title,
      startIso,
      endIso,
      displayTime,
    })

    return {
      handled: true,
      reply,
    }
  }

  return {
    handled: false,
    reply: '',
  }
}
