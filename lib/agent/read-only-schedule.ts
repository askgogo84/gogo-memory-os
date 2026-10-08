import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import { calendarReadWindow, executeReadOnlyCalendarStep, requestedCalendarTimezone, requestedCalendarDays, calendarAffirmativeText } from './calendar-read'
import { normalizeTimezone, parseLocalDateTime } from '@/lib/timezone'
import { rememberTypedObjects } from './typed-object-context'

function safe(value: unknown, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Return the next LOCAL calendar date, not "now + N hours". */
export function nextLocalDateKey(now: Date, timeZone: string) {
  const today = localDateKey(now, timeZone)
  const [year, month, day] = today.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

function localClock(value: string, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'All day'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'All day'
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

export function detectReadOnlyScheduleRequest(raw: string) {
  const text = safe(raw, 2000).toLowerCase().replace(/[’]/g, "'")
  if (!text) return null
  const explicitNoMutation = /\b(do not|don't|dont|without)\s+(?:change|changing|modify|modifying|create|creating|add|adding|edit|editing|move|moving|schedule|scheduling|cancel|cancelling|canceling)\b/.test(text) || /\bread[- ]only\b/.test(text)
  const request = calendarAffirmativeText(text)
  // Command boundaries distinguish "and book a table" from "for the book
  // launch". Event subjects must not become unrelated booking/write intents.
  if (/(?:^|[,.!?;\n]\s*|\b(?:and|then|also|but|instead|please|to|you)\s+)(?:please\s+)?(?:reserve|schedule|remind|create|add|invite|prepare|write|put|set|forward|save|remember|compose|archive|post|publish|renew|move|reschedule|resched|postpone|push|shift|update|make|edit|change|modify|cancel|delete|remove|clear|book|send|pay|buy|purchase)\b|\bschedule\s+(?:a|an|the|my|new|meeting|event)\b/.test(request)) return null
  const readVerb = /\b(check|tell me|show(?: me)?|list|plan my day|what is my day|what (?:meetings?|events?|appointments?) do i have|what do i have|what(?:'s| is) on|what needs my attention|review|summari[sz]e|brief me)\b/.test(text)
  const scheduleContext = /\b(calendar|schedule|meetings?|appointments?|events?|day)\b/.test(text) ||
    /\b(?:what (?:do )?i have tomorrow|what(?:'s| is) on tomorrow|what needs my attention tomorrow|(?:summari[sz]e|review|brief me(?: on)?) tomorrow)\b/.test(text)
  const {today,tomorrow}=requestedCalendarDays(text)
  if ((explicitNoMutation || readVerb) && scheduleContext && (tomorrow || today)) {
    const combined = /\b(?:reminders?|agenda|plan my day|what is my day|what (?:do )?i have tomorrow|what(?:'s| is) on tomorrow|my day|my schedule)\b/.test(request)
    const calendarOnly = /\b(?:calendar|meetings?|appointments?|events?)\b/.test(request) && !combined
    if(today&&!calendarOnly&&!tomorrow)return null // Preserve the existing Today/day route.
    return { horizon: today ? tomorrow ? 'today-tomorrow' as const : 'today' as const : 'tomorrow' as const, scope: calendarOnly ? 'calendar' as const : 'agenda' as const }
  }
  return null
}

export async function readTomorrowSchedule(params: { actor: AgentActor; scope?: 'calendar' | 'agenda'; text?: string }) {
  const telegramId = Number(params.actor.legacyTelegramId)
  const { data: user, error: userError } = await supabaseAdmin.from('users')
    .select('timezone')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (userError) throw new Error(`read_only_schedule_user_failed:${userError.message}`)

  const requestedTimeZone = normalizeTimezone(user?.timezone)
  const now = new Date()
  const tomorrowKey = nextLocalDateKey(now, requestedTimeZone)
  const originalRequest=params.text||'Show my calendar tomorrow'
  let window=calendarReadWindow(originalRequest,now,requestedTimeZone)

  // Use the exact same canonical Google Calendar reader as autonomous mission steps.
  // This prevents Agent/Talk-to-Gogo read-only summaries from drifting from the
  // calendar reality used by the planner, verifier and availability engine.
  let calendarConnected = true
  let timeZone = requestedTimeZone
  let calendarComplete=true
  let calendarAvailability=false
  let calendarText=''
  let calendarEvents: Array<{ id?: string; title: string; start: string; end?: string; label?: string }> = []
  let calendarReturnedCount=0
  try {
    // Independent reminders keep the same requested window even if Calendar
    // fails before producing its result (connection, refresh or provider).
    timeZone=requestedCalendarTimezone(originalRequest)||requestedTimeZone
    window=calendarReadWindow(originalRequest,now,timeZone)
    const calendar = await executeReadOnlyCalendarStep({
      actor: params.actor,
      instruction: originalRequest,
      missionText: originalRequest,
      rememberSelection: true,
    })
    const output: any = calendar.output || {}
    timeZone = safe(output.timezone || requestedTimeZone, 100)
    window=output.window||calendarReadWindow(originalRequest,now,timeZone)
    calendarComplete=output.complete!==false&&output.availabilityVerified!==false&&output.conflictsVerified!==false
    calendarAvailability=output.mode==='availability'
    calendarText=calendar.text
    calendarEvents = (Array.isArray(output.events) ? output.events : []).map((event: any) => ({
      id: safe(event?.id || '', 160) || undefined,
      title: safe(event?.summary || event?.title || 'Untitled event', 180),
      start: safe(event?.start || '', 120),
      end: safe(event?.end || '', 120) || undefined,
      label: safe(event?.label || '', 240) || undefined,
    })).filter((event: any) => event.start)
    calendarReturnedCount=Number.isInteger(output.returnedEventCount)?output.returnedEventCount:calendarEvents.length
  } catch (error: any) {
    if(error?.message==='calendar_timezone_invalid')return {
      text:'The requested timezone is invalid. Send a valid timezone such as Asia/Kolkata or UTC so I can check the right dates.',
      calendarEvents:[],reminders:[],timeZone:requestedTimeZone,tomorrowKey,calendarReadVerified:false,
    }
    if(error?.message==='calendar_availability_unverified'){
      timeZone=error.timezone||requestedTimeZone
      window=error.window||calendarReadWindow(originalRequest,now,timeZone)
      calendarComplete=false;calendarAvailability=true
      calendarText='I could not verify free slots: the calendar page is incomplete or event end times are missing.'
    }else{
      console.error('READ_ONLY_SCHEDULE_CALENDAR_FAILED:', safe(error?.message || error, 160))
      calendarConnected = false
    }
  }

  const localTomorrowKey = nextLocalDateKey(now, timeZone)
  // Calendar-only requests never read reminders, Attention or background monitors.
  if (params.scope === 'calendar') {
    const lines = [`Calendar ${window.label} (${timeZone}):`]
    if (!calendarConnected) lines.push('I could not read your connected calendar just now.')
    else if(calendarText)return {text:calendarText,calendarEvents,reminders:[],timeZone,tomorrowKey:localTomorrowKey,window,calendarReadVerified:calendarConnected&&calendarComplete}
    else lines.push('The calendar reader returned no verifiable schedule.')
    return { text: lines.join('\n'), calendarEvents, reminders: [], timeZone, tomorrowKey: localTomorrowKey,window, calendarReadVerified: calendarConnected&&calendarComplete }
  }
  const tomorrowStart = parseLocalDateTime({date:window.startDate,time:'00:00',timezone:timeZone}).dueAtUtc
  const [year,month,day]=window.endDate.split('-').map(Number)
  const tomorrowEnd = parseLocalDateTime({date:new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10),time:'00:00',timezone:timeZone}).dueAtUtc
  const { data: reminderRows, error: reminderError } = await supabaseAdmin.from('reminders')
    .select('id,message,remind_at,sent')
    .eq('telegram_id', telegramId)
    .gte('remind_at', tomorrowStart.toISOString())
    .lt('remind_at', tomorrowEnd.toISOString())
    .order('remind_at', { ascending: true })
  if (reminderError) throw new Error(`read_only_schedule_reminders_failed:${reminderError.message}`)
  const reminders = (reminderRows || []).filter((row: any) => {
    const due = new Date(row.remind_at)
    const key=Number.isFinite(due.getTime())?localDateKey(due,timeZone):''
    return !row.sent && key>=window.startDate && key<=window.endDate
  })
  // A mixed agenda is not a single typed selection. A later bare pronoun must
  // clarify rather than inherit the Calendar reader's intermediate selection.
  await rememberTypedObjects(telegramId,'calendar',[],null).catch(()=>{})

  const lines: string[] = [window.label==='tomorrow'?'Tomorrow:':`Schedule ${window.label}:`]
  if (calendarConnected) {
    if(calendarAvailability)lines.push(calendarText)
    else if (calendarEvents.length) {
      lines.push(`Calendar: ${calendarReturnedCount} returned event${calendarReturnedCount === 1 ? '' : 's'}${calendarReturnedCount>6?' (showing 6)':''}.`)
      for (const event of calendarEvents.slice(0, 6)) lines.push(`• ${event.label||localClock(event.start, timeZone)} — ${event.title}`)
    } else lines.push(calendarComplete?'Calendar: clear.':'Calendar: partial page, full schedule not verified.')
    if(!calendarComplete)lines.push('Calendar review is incomplete; more events or unverified intervals remain.')
    if(!calendarAvailability)for(const line of calendarText.split('\n'))if(/^(?:Overlap:|No overlapping|Overlap review)/.test(line))lines.push(line)
  } else lines.push('Calendar: I could not read your connected calendar just now.')

  if (reminders.length) {
    lines.push(`Reminders: ${reminders.length}.`)
    for (const reminder of reminders.slice(0, 6)) lines.push(`• ${localClock(reminder.remind_at, timeZone)} — ${safe(reminder.message || 'Reminder', 180)}`)
  } else lines.push('Reminders: none pending.')

  const attention: string[] = []
  for (const event of calendarEvents.slice(0, 3)) attention.push(`${localClock(event.start, timeZone)} ${event.title}`)
  for (const reminder of reminders.slice(0, 3)) attention.push(`${localClock(reminder.remind_at, timeZone)} ${safe(reminder.message || 'Reminder', 120)}`)
  if (attention.length) lines.push(`Needs your attention: ${attention.join('; ')}.`)
  else if(!calendarAvailability)lines.push(calendarComplete?`Nothing currently needs your attention ${window.label}.`:'Calendar attention could not be fully checked.')
  lines.push('I did not change, create, move or delete anything.')

  return { text: lines.join('\n'), calendarEvents, reminders, timeZone, tomorrowKey: localTomorrowKey || tomorrowKey,window, calendarReadVerified: calendarConnected&&calendarComplete }
}
