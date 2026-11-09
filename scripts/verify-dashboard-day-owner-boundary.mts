/**
 * Synthetic Dashboard day-read owner-binding regression against the real TypeScript module.
 * No getSession, real user data, Supabase SQL/RLS, Gmail, Calendar, reminders or production calls.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactDashboardOwnerId } from '../lib/dashboard/session-access.ts'

const source = readFileSync('lib/dashboard/day-chat.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

type Predicate = { table: string; column: string; value: unknown }
type Intent = 'summary' | 'plan'

async function exercise(owner: unknown, intent: Intent) {
  const tables: string[] = []
  const predicates: Predicate[] = []
  const reminderReads: unknown[] = []
  const calendarReads: unknown[] = []
  const db = {
    from(table: string) {
      tables.push(table)
      assert.ok(table === 'users' || table === 'agent_approvals', 'unexpected private DB table ' + table)
      const query: any = {
        select(_columns: string, _options?: unknown) { return query },
        eq(column: string, value: unknown) { predicates.push({ table, column, value }); return query },
        async maybeSingle() { return { data: { timezone: 'Asia/Kolkata' }, error: null } },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          assert.equal(table, 'agent_approvals', 'unexpected thenable database query')
          return Promise.resolve({ count: 2, error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }

  const imports: Record<string, unknown> = {
    '@/lib/dashboard/queries': {
      getTodayReminders: async (id: unknown) => {
        reminderReads.push(id)
        return { ok: true, reminders: [] }
      },
      getTodayCalendar: async (id: unknown) => {
        calendarReads.push(id)
        return { ok: true, connected: false, events: [] }
      },
    },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/calendar-intervals': {
      calendarInterval: () => null,
      collapseCalendarEntries: () => [],
      dailyOccurrenceOn: () => null,
      longSpanNote: () => '',
    },
    '@/lib/timezone': {
      isValidTimezone: () => true,
      parseLocalDateTime: ({ date, time }: { date: string; time: string }) =>
        ({ dueAtUtc: new Date(date + 'T' + time + ':00.000Z') }),
    },
    '@/lib/dashboard/session-access': { exactDashboardOwnerId },
  }
  const mod: any = { exports: {} }
  runInNewContext(compiled, {
    module: mod, exports: mod.exports, Promise, Date, Intl,
    require(path: string) {
      assert.ok(Object.prototype.hasOwnProperty.call(imports, path), 'unexpected module import: ' + path)
      return imports[path]
    },
  }, { filename: 'day-chat-synthetic.cjs', timeout: 5000 })

  assert.equal(typeof mod.exports.getDashboardDayReply, 'function')
  const reply = await mod.exports.getDashboardDayReply(owner, intent)
  return { reply, tables, predicates, reminderReads, calendarReads }
}

assert.equal(Number('9007199254740992'), Number('9007199254740993'),
  'the fixture must expose adjacent signed64 Number precision loss')

let denied = 0
for (const owner of [
  null, '', '0', '00042', '42junk', '42.0', '+42', ' 42', '42 ', 'NaN',
  '9007199254740992', '9007199254740993', '-9007199254740992',
  '9223372036854775808', '-9223372036854775809', 42.5,
] as const) {
  assert.equal(exactDashboardOwnerId(owner), null, 'invalid synthetic owner input')
  const result = await exercise(owner, 'plan')
  assert.deepEqual(result.tables, [], 'invalid session must make ZERO privileged DB calls: ' + String(owner))
  assert.deepEqual(result.predicates, [], 'invalid session cannot bind any private query')
  assert.deepEqual(result.reminderReads, [], 'invalid session cannot reach private reminders')
  assert.deepEqual(result.calendarReads, [], 'invalid session cannot reach private calendar')
  assert.equal(result.reply, "I couldn't read your full day right now. Try again in a moment.")
  denied++
}

let accepted = 0
for (const owner of ['42', '-123', '9007199254740991', '-9007199254740991'] as const) {
  const exact = exactDashboardOwnerId(owner)
  assert.ok(exact !== null && Number.isSafeInteger(exact))
  for (const intent of ['summary', 'plan'] as const) {
    const result = await exercise(owner, intent)
    assert.deepEqual(result.tables, intent === 'plan' ? ['users', 'agent_approvals'] : ['users'])
    const users = result.predicates.filter(p => p.table === 'users')
    assert.equal(users.length, 1)
    assert.equal(users[0].column, 'telegram_id')
    assert.equal(users[0].value, exact, 'timezone lookup must bind exact SAFE owner')
    assert.equal(typeof users[0].value, 'number', 'keep legacy numeric timezone lookup contract')
    const approvals = result.predicates.filter(p => p.table === 'agent_approvals')
    if (intent === 'plan') {
      assert.ok(approvals.some(p => p.column === 'telegram_id' && p.value === owner),
        'approval read stays tied to the exact validated owner string')
      assert.match(result.reply, /Needs you: 2 decisions waiting/)
    } else assert.equal(approvals.length, 0)
    assert.deepEqual(result.reminderReads, [owner])
    assert.deepEqual(result.calendarReads, [owner])
    assert.match(result.reply, intent === 'plan' ? /Your plan for the rest of today/ : /Here’s your day/)
    accepted++
  }
}
console.log('PASS DASHBOARD_DAY_OWNER_BOUNDARY: real TS, inert owner/timezone/reminder/calendar/approval paths (' +
  accepted + ' valid scenarios / ' + denied + ' invalid identities)')
