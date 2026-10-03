import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { detectIntent } from '../lib/bot/detect-intent'
import * as reminders from '../lib/bot/handlers/reminders'
import * as responseStyle from '../lib/bot/handlers/response-style'
import * as formatResponse from '../lib/bot/format-response'
import * as pendingFollowup from '../lib/bot/pending-followup'
import * as amPmFollowup from '../lib/bot/handlers/reminder-ampm-followup'
import { isCalendarAction, buildCalendarActionReply } from '../lib/bot/handlers/calendar-actions'
import { isCalendarMutation } from '../lib/bot/handlers/calendar-mutations'

// Oct 1 WhatsApp failure: 16:30 appointment minus ten minutes was saved as 17:20.
// Exercise the actual processIncomingMessage -> insert -> confirmation path with
// a fixed incident clock, isolated storage, and no model/network calls allowed.
const RealDate = Date
const realFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Network is forbidden in reminder regression') }
let now = RealDate.parse('2026-10-01T06:42:37Z')
class FixedDate extends RealDate {
  constructor(value?: string | number) { super(value === undefined ? now : value) }
  static now() { return now }
}
globalThis.Date = FixedDate as DateConstructor

const written: Record<string, any>[] = []
let modelCalls = 0
let failInsert = false
let followup: {kind:string,payload:any}|null = null
const db = {
  from(table: string) {
    let payload: any
    const query: any = {
      select() { return query },
      eq(key: string, value: unknown) {
        if (table === 'users') assert.equal(value, 42, 'timezone lookup must use the owner')
        return query
      },
      insert(row: any) { payload = row; return query },
      maybeSingle: async () => ({ data: { timezone: 'Asia/Kolkata' }, error: null }),
      single: async () => {
        assert.equal(table, 'reminders')
        if (failInsert) return { data: null, error: { message: 'injected reminder insert failure' } }
        written.push({ ...payload })
        return { data: { id: 'test-reminder' }, error: null }
      },
      then(resolve: any, reject: any) {
        assert.equal(table, 'conversations', 'unexpected database side effect')
        return Promise.resolve({ data: null, error: null }).then(resolve, reject)
      },
    }
    return query
  },
}

const noMatch = new Set([
  'handleLinkVaultText', 'tryTypedTimeRouting', 'normalizePhoneNumber',
  'detectFriendReminder', 'getLatestFollowupState', 'isAmPmChoice',
  'isCalendarConflictMoveCommand', 'parsePlanSelection', 'isPlanMyDayIntent',
  'isTranslationRequest', 'isFollowupReminderText',
])
const actual: Record<string, any> = {
  './handlers/reminders': reminders,
  './detect-intent': { detectIntent },
  './handlers/response-style': responseStyle,
  './format-response': formatResponse,
  './pending-followup': pendingFollowup,
  './handlers/reminder-ampm-followup': amPmFollowup,
  './handlers/followup-state': {
    getLatestFollowupState: async (_owner:number, kind:string) => followup?.kind===kind ? {...followup,created_at:new Date(now).toISOString()} : null,
    isFreshFollowupState: () => true,
    saveFollowupState: async () => {},
  },
  '@/lib/supabase-admin': { supabaseAdmin: db },
  './handlers/calendar-actions': { isCalendarAction, buildCalendarActionReply },
  './handlers/calendar-mutations': { isCalendarMutation },
  './resolve-user': { resolveUser: async () => ({ id: 'owner', telegramId: 42, whatsappId: 'test-owner', name: 'Test', tier: 'free' }) },
  '@/lib/limits': { checkAndIncrementLimit: async () => ({ allowed: true }) },
  '@/lib/agent/typed-object-context': { rememberTypedObjects: async () => {} },
  '@/lib/claude': { askClaude: async () => { modelCalls++; throw new Error('Reminder arithmetic must not call a model') } },
}
const source = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports: any = {}
runInNewContext(compiled, {
  exports, Date: FixedDate, Intl, URL, console, process: { env: {} },
  require(name: string) {
    if (actual[name]) return actual[name]
    return new Proxy({}, { get(_target, key) {
      if (noMatch.has(String(key))) return () => null
      throw new Error(`Unexpected dependency used: ${name}.${String(key)}`)
    } })
  },
})

async function run(text: string) {
  return exports.processIncomingMessage({ channel: 'whatsapp', externalUserId: 'test-owner', text })
}

try {
  const incident = 'Aqua appointment at 4.30pm..remind me..10 mins earlier'
  assert.equal(detectIntent(incident).type, 'set_reminder')
  const reply = await run(incident)
  assert.equal(written.length, 1)
  assert.equal(written[0].remind_at, '2026-10-01T10:50:00.000Z')
  assert.equal(written[0].message, 'Aqua appointment')
  assert.equal(written[0].telegram_id, 42)
  assert.equal(written[0].timezone, 'Asia/Kolkata')
  assert.match(reply.text, /Reminder set/)
  assert.match(reply.text, /4:20\s*pm/i)
  assert.doesNotMatch(reply.text, /5:20|4:30/)

  // The same request in standard punctuation must have identical arithmetic.
  const standard = await run('Remind me about Aqua appointment at 4:30 pm, 10 minutes before')
  assert.equal(written[1].remind_at, written[0].remind_at)
  assert.match(standard.text, /4:20\s*pm/i)

  // Existing direct and relative reminders retain their original meaning.
  assert.equal(reminders.parseReminderIntent('remind me to call at 4:30 pm')?.remindAtIso, '2026-10-01T11:00:00.000Z')
  assert.equal(reminders.parseReminderIntent('remind me in 10 mins to call')?.remindAtIso, '2026-10-01T06:52:37.000Z')

  const missing = await run('Aqua appointment tomorrow, remind me 10 mins earlier')
  assert.equal(written.length, 2, 'missing appointment time must not save a guessed reminder')
  assert.match(missing.text, /Nothing has been saved/)
  now = RealDate.parse('2026-10-01T10:55:00Z') // 16:25: advance notice already missed
  const missed = await run(incident)
  assert.equal(written.length, 2, 'missed advance notice must not save a past or shifted reminder')
  assert.match(missed.text, /Nothing has been saved/)

  // Oct 1 13:25 WhatsApp: time-first wording went to web_search and saved nothing.
  // The real pipeline must save a reminder without web/model calls.
  now = RealDate.parse('2026-10-01T07:55:14Z')
  const timeFirst = '4pm aqua dental appointment today.. reminder'
  assert.equal(detectIntent(timeFirst).type, 'set_reminder', 'time-first reminder must not become web research')
  const timeFirstReply = await run(timeFirst)
  assert.equal(written.length, 3)
  assert.equal(written[2].remind_at, '2026-10-01T10:30:00.000Z')
  assert.equal(written[2].message, 'aqua dental appointment')
  assert.match(timeFirstReply.text, /Reminder set/)
  assert.match(timeFirstReply.text, /today at 4:00\s*pm/i)
  assert.doesNotMatch(timeFirstReply.text, /contact|210-824-7900|https?:/i)

  now = RealDate.parse('2026-10-03T13:13:00Z') // 18:43 IST, after the reported meeting.
  const beforeTemporalChecks=written.length
  for(const text of [
    'Remind me today at 4pm to join Food Working Session',
    '4pm aqua appointment today reminder',
    'Remind me Saturday, 3 Oct 2026 at 4pm to join Food Working Session',
    'Remind me on 3 Oct at 4pm to join Food Working Session',
    'Remind me yesterday at 4pm to call',
    'Remind me on 31 September 2026 at 4pm to call',
    'Remind me on 2026-10-03 at 4pm to call',
    'Remind me on 03/10/2026 at 4pm to call',
    'Remind me on 2026-13-03 at 4pm to call',
    'Remind me Tuesday, 12 Oct 2026 at 4pm to call',
  ]){
    const reply=await run(text)
    assert.equal(written.length,beforeTemporalChecks,`must not silently move date: ${text}`)
    assert.match(reply.text,/passed|valid date/i)
    assert.doesNotMatch(reply.text,/Reminder set/i)
  }
  const future=reminders.parseReminderIntent('Remind me Monday, 12 Oct 2026 at 4pm to call')
  assert.equal(future?.remindAtIso,'2026-10-12T10:30:00.000Z','explicit date wins over next Monday')
  assert.equal(reminders.parseReminderIntent('Remind me every Saturday at 4pm to call')?.kind,'recurring')
  const ambiguousDate='remind me on 3 October 2026 at 8 to call Mom'
  assert.equal(reminders.reminderTimingProblem(ambiguousDate),null,'must clarify AM/PM before judging whether the clock is past')
  assert.equal(reminders.parseReminderIntent(ambiguousDate),null,'ambiguous named-date clock must not become default 9am')

  followup={kind:'pending_reminder',payload:{task:'call Mom',dateText:'today'}}
  assert.match((await run('4 pm')).text,/passed/)
  assert.equal(written.length,beforeTemporalChecks,'past follow-up must not fall through to model or create')
  await run('tomorrow 8 pm')
  assert.equal(written.at(-1)?.remind_at,'2026-10-04T14:30:00.000Z','new date answer replaces old today context')
  assert.equal(written.at(-1)?.message,'call Mom')
  followup={kind:'reminder_ampm',payload:{originalText:'remind me to call Mom today at 8'}}
  const beforeAmPm=written.length
  assert.match((await run('am')).text,/passed/)
  assert.equal(written.length,beforeAmPm,'expired AM choice must terminate routing without a write')
  const withYear=amPmFollowup.buildReminderFromAmPmChoice('remind me on 12 October 2026 at 8 to call Mom','pm')
  assert.equal(withYear?.remindAtIso,'2026-10-12T14:30:00.000Z','AM/PM choice must preserve the year')
  assert.equal(amPmFollowup.buildReminderFromAmPmChoice('remind me on 12 October 2026 at 8:30 to call Mom','8:30 pm')?.remindAtIso,'2026-10-12T15:00:00.000Z','AM/PM choice must preserve minutes')
  followup=null

  now = RealDate.parse('2026-10-01T06:42:37Z')
  failInsert = true
  await assert.rejects(() => run(incident), /Reminder insert failed/, 'failed persistence must not confirm success')
  assert.equal(modelCalls, 0, 'valid and unresolved lead-time requests must bypass model arithmetic')
  console.log('PASS: Aqua lead-time reminder saves 16:20 IST; time-first reminder saves 16:00 IST without web/model calls')
} finally {
  globalThis.Date = RealDate
  globalThis.fetch = realFetch
}
