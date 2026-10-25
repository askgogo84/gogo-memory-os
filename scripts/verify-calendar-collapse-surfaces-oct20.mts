// 20 Oct live (~23:00 IST): a broken recurring invite ("Daily Connect-Standup Call", 9 entries each spanning ~3
// weeks) was collapsed on "what's on my calendar today" but not elsewhere:
//  1. "What do I have tomorrow?" listed 6 multi-week copies and hid the real meetings (cut to 12 before collapse).
//  2. "Plan my day" at 10:43 PM said "ongoing until 11:45 AM" five times.
//  3. "Summarise my week" never read Google Calendar ("no recorded events" on a day with meetings).
// Actual modules, inert transports; no provider writes.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const intervals = await import('../lib/calendar-intervals.ts')
const timezone = await import('../lib/timezone.ts')
const calendarWord = await import('../lib/data/calendar-word.ts')
const {redactSecretShapedText} = await import('../lib/bot/memory-redaction.ts')

function load(file: string, deps: Record<string, unknown>) {
  const exports: any = {}
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {exports, process, Date, Intl, URL, URLSearchParams, console, require: (name: string) => { assert.ok(name in deps, 'Unexpected dependency ' + name); return deps[name] }})
  return exports
}
const tz = 'Asia/Kolkata'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d)
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const today = ymd(new Date())
const tomorrow = addDays(today, 1)
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00+05:30`
const standupCopies = (n: number) => Array.from({length: n}, (_, i) => {
  const date = addDays(tomorrow, -12 + i)
  return {id: `standup-${i}`, summary: 'Daily Connect-Standup Call', start: {dateTime: at(date, '11:30')},
    end: {dateTime: new Date(Date.parse(at(date, '11:45')) + 23 * 86400_000).toISOString().replace('.000Z', 'Z')}}
})
const real = (date: string) => [
  {id: 'ondc', summary: 'ONDC l Tipplr weekly connect', start: {dateTime: at(date, '10:30')}, end: {dateTime: at(date, '11:00')}},
  {id: 'cohort', summary: 'Cohort Connect', start: {dateTime: at(date, '11:00')}, end: {dateTime: at(date, '11:30')}},
  {id: 'divya', summary: 'Lunch with Divya', start: {dateTime: at(date, '13:00')}, end: {dateTime: at(date, '14:00')}},
  {id: 'nithin', summary: 'Review with Nithin', start: {dateTime: at(date, '16:00')}, end: {dateTime: at(date, '16:30')}},
  {id: 'ops', summary: 'Ops sync', start: {dateTime: at(date, '18:00')}, end: {dateTime: at(date, '18:30')}},
]
let providerEvents: any[] = []
const db = {from(table: string) {
  assert.ok(['users', 'reminders'].includes(table), table)
  const result = () => ({data: table === 'users' ? {google_calendar_connected: true, google_refresh_token: 'fixture-only', timezone: tz} : [], error: null})
  const q: any = {select: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q, maybeSingle: async () => result(), then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej)}
  return q
}}
const read = load('lib/agent/calendar-read.ts', {
  '@/lib/agent/typed-object-context': {rememberTypedObjects: async () => {}}, '@/lib/supabase-admin': {supabaseAdmin: db},
  '@/lib/google-calendar': {fetchPrimaryCalendarEventsPage: async () => ({events: providerEvents.slice(0, 40), hasMore: providerEvents.length > 40}), fetchPrimaryCalendarAccount: async () => 'synthetic@example.test'},
  '@/lib/services/google-calendar-accounts': {getCalendarAccountAccess: async () => [{accessToken: 'fixture-only', email: 'synthetic@example.test', primary: true}], fetchMergedCalendarEventsPage: async () => { throw Error('single account') }, describeCalendarAccounts: () => ''},
  '@/lib/timezone': timezone, '@/lib/bot/memory-redaction': {redactSecretShapedText}, '@/lib/data/calendar-word': calendarWord, '@/lib/calendar-intervals': intervals,
})
const schedule = load('lib/agent/read-only-schedule.ts', {'@/lib/supabase-admin': {supabaseAdmin: db}, './calendar-read': read, '@/lib/timezone': timezone, './typed-object-context': {rememberTypedObjects: async () => {}}})
const actor = {userId: 'u', legacyTelegramId: 123, whatsappId: '9100000000', name: 'Gogo'}

// 1. "What do I have tomorrow?" (agenda scope, the live handledBy read-only-schedule path).
providerEvents = [...standupCopies(9), ...real(tomorrow)].sort((a, b) => Date.parse(a.start.dateTime) - Date.parse(b.start.dateTime))
const detected = schedule.detectReadOnlyScheduleRequest('What do I have tomorrow?')
assert.deepEqual(JSON.parse(JSON.stringify(detected)), {horizon: 'tomorrow', scope: 'agenda'})
const agenda = await schedule.readTomorrowSchedule({actor, scope: detected.scope, text: 'What do I have tomorrow?'})
const standupLines = agenda.text.split('\n').filter((l: string) => /Daily Connect-Standup Call/.test(l) && /^•/.test(l))
assert.equal(standupLines.length, 1, agenda.text)
assert.match(standupLines[0], /Daily Connect-Standup Call — 11:30 am – 11:45 am · 9 overlapping entries, each spans several days, so the invite may be set up wrongly/)
for (const title of ['ONDC l Tipplr weekly connect', 'Cohort Connect']) assert.ok(agenda.text.includes(title), title + ' must be shown:\n' + agenda.text)
assert.doesNotMatch(agenda.text, /Sat, \d+ \w+, 11:45|– \w{3}, \d+ \w{3}, 11:45 am — Daily/, 'no multi-week range labels')
assert.match(agenda.text, /Calendar: 6 events \(14 returned entries; repeats combined\)/)
console.log('PASS tomorrow agenda collapses the broken invite and shows the real meetings')

// Calendar-only scope / canonical reader: all 5 real events survive the display bound (cut after collapse).
const direct = await read.executeReadOnlyCalendarStep({actor, instruction: 'Show my calendar tomorrow', missionText: 'Show my calendar tomorrow'})
assert.equal(direct.output.events.length, 6); assert.equal(direct.output.entryCount, 6); assert.equal(direct.output.returnedEventCount, 14)
assert.equal((direct.text.match(/Daily Connect-Standup Call/g) || []).length, 1)
for (const title of ['ONDC l Tipplr weekly connect', 'Cohort Connect', 'Lunch with Divya', 'Review with Nithin', 'Ops sync']) assert.ok(direct.text.includes(title), title)
assert.doesNotMatch(direct.text, /Showing \d+ of/)
console.log('PASS canonical reader collapses before bounding the display')

// 2. "Plan my day" (dashboard-day) — same collapse; a daily 11:30–11:45 slot is not "ongoing" at 10:43 PM.
const day = load('lib/dashboard/day-chat.ts', {'@/lib/dashboard/queries': {}, '@/lib/supabase-admin': {supabaseAdmin: db}, '@/lib/calendar-intervals': intervals, '@/lib/timezone': timezone})
assert.equal(day.detectDashboardDayIntent('Plan my day'), 'plan')
const dayEvents = [...standupCopies(9), ...real(today).slice(0, 2)].map(e => ({id: e.id, title: e.summary, time: null, startAt: e.start.dateTime, endAt: e.end.dateTime, allDay: false, blocksTime: true, timingKnown: true}))
const planAt = (hhmm: string, events = dayEvents) => day.formatDashboardDayReply({intent: 'plan', tz, remindersOk: true, reminders: [], calendarOk: true, calendarConnected: true, calendarIncomplete: false, calendarEvents: events, now: new Date(at(today, hhmm))})
const late = planAt('22:43')
assert.doesNotMatch(late, /Daily Connect-Standup Call/, late)
assert.doesNotMatch(late, /ongoing/, late)
assert.match(late, /Nothing scheduled from now on\./)
const morning = planAt('09:00')
assert.equal((morning.match(/Daily Connect-Standup Call/g) || []).length, 1, morning)
assert.match(morning, /11:30 AM — Daily Connect-Standup Call \(meeting\) · 9 overlapping entries, each spans several days/)
assert.doesNotMatch(morning, /ongoing/)
assert.match(morning, /10:30 AM — ONDC l Tipplr weekly connect/)
const during = planAt('11:35')
assert.equal((during.match(/ongoing until 11:45 AM/g) || []).length, 1, during)
const duplicated = planAt('09:00', [...dayEvents.slice(9), ...dayEvents.slice(9)])
assert.equal((duplicated.match(/ONDC l Tipplr weekly connect/g) || []).length, 1, 'exact duplicates show once')
const summary = day.formatDashboardDayReply({intent: 'summary', tz, remindersOk: true, reminders: [], calendarOk: true, calendarConnected: true, calendarEvents: dayEvents, now: new Date(at(today, '09:00'))})
assert.equal((summary.match(/Daily Connect-Standup Call/g) || []).length, 1, summary)
assert.match(summary, /Calendar: 3 events/)
console.log('PASS plan my day: one daily slot, not ongoing at night, duplicates once')

// 3. "Summarise my week" reads the whole current week from Google Calendar, collapsed the same way.
const {planningCalendarInstruction} = await import('../lib/bot/process-message.ts')
const weekInstruction = planningCalendarInstruction('Summarise my week')
assert.match(String(weekInstruction), /^Show my calendar for (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/)
const [, monday, sunday] = String(weekInstruction).match(/for (\S+) to (\S+)/)!
assert.equal(new Date(monday + 'T00:00:00Z').getUTCDay(), 1); assert.equal(addDays(monday, 6), sunday)
assert.ok(monday <= today && today <= sunday)
for (const text of ['summarize my week', 'Give me a recap of my week'.replace('a recap of', 'recap'), 'weekly summary please', "how's my week looking"]) assert.ok(planningCalendarInstruction(text), text)
assert.equal(planningCalendarInstruction('plan my week'), 'Show my calendar for the next 7 days')
assert.equal(planningCalendarInstruction('summarise this article'), null)
const window = read.calendarReadWindow(String(weekInstruction), new Date(), tz)
assert.equal(window.startDate, monday); assert.equal(window.endDate, sunday)
providerEvents = [...standupCopies(9), ...real(today), ...real(addDays(today, 1)), ...real(addDays(today, 2)), ...real(addDays(today, 3))]
  .sort((a, b) => Date.parse(a.start.dateTime) - Date.parse(b.start.dateTime))
const week = await read.executeReadOnlyCalendarStep({actor, instruction: String(weekInstruction), missionText: String(weekInstruction)})
assert.equal((week.text.match(/Daily Connect-Standup Call/g) || []).length, 1, week.text)
assert.equal(week.output.entryCount, 21); assert.equal(week.output.events.length, 21, 'a week shows up to 24 lines, not 12')
assert.ok(week.text.includes('ONDC l Tipplr weekly connect'))
if (process.env.SHOW_REPLIES) console.log([agenda.text, morning, late, week.text].join('\n-----\n'))
console.log('PASS summarise my week reads the calendar for Monday–Sunday, collapsed')
console.log('CALENDAR_COLLAPSE_SURFACES_OK')
