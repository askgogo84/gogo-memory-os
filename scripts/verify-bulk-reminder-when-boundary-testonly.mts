/**
 * TEST ONLY / EXPECTED RED. #274 / #1098 unresolved P1.
 * Exercises the REAL shipped cancelReminder function in an isolated transpiled
 * CommonJS module with fake in-memory Supabase + fake stopReminderSeries.
 *
 * No Supabase, WhatsApp, cron, provider, credentials or customer data is accessed.
 * Not registered in npm test intentionally; focused workflow runs at literal PR SHA.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

type Row = {
  id: number
  telegram_id: number
  message: string
  remind_at: string
  is_recurring: boolean
  recurring_pattern: string
  sent: boolean
  created_at: string
  sent_at: null
}

const owner = 42
let table: Row[] = []
let stopped: number[] = []
let checks = 0
let failures = 0

function row(id: number, date: string, telegram_id = owner, pattern = 'daily'): Row {
  return {
    id,
    telegram_id,
    message: 'Drink water',
    remind_at: date,
    is_recurring: true,
    recurring_pattern: pattern,
    sent: false,
    created_at: '2026-10-29T01:00:00.000Z',
    sent_at: null,
  }
}

function reminderClock(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

function mockQuery() {
  const equalities: Array<[string, unknown]> = []
  let sortField = 'remind_at'
  let ascending = true
  const query = {
    select(_cols: string) { return query },
    eq(field: string, value: unknown) { equalities.push([field, value]); return query },
    order(field: string, cfg: { ascending?: boolean } = {}) {
      sortField = field
      ascending = cfg.ascending !== false
      return query
    },
    async limit(n: number) {
      const rows = table.filter(r => equalities.every(([key, value]) => String(r[key as keyof Row]) === String(value)))
      rows.sort((a, b) => String(a[sortField as keyof Row]).localeCompare(String(b[sortField as keyof Row])) * (ascending ? 1 : -1))
      return { data: rows.slice(0, n), error: null }
    },
  }
  return query
}

const fakes: Record<string, unknown> = {
  '@/lib/supabase-admin': { supabaseAdmin: { from(name: string) {
    if (name !== 'reminders') throw Error('Unexpected table: ' + name)
    return mockQuery()
  } } },
  '@/lib/bot/detect-intent': { isReminderReadQuestion: () => false },
  '@/lib/bot/reminder-dedup': { isInternalPlanStepReminder: () => false },
  '@/lib/services/reminder-series': {
    stopReminderSeries: async (telegramId: number, reminder: Row) => {
      if (telegramId !== owner || reminder.telegram_id !== owner) throw Error('Owner boundary violated')
      stopped.push(reminder.id)
      return { ok: true, wasRecurring: true }
    },
    skipReminderOccurrence: async () => { throw Error('Unexpected skip') },
    describeCadence: () => 'daily',
    formatReminderTimeOfDay: reminderClock,
    formatReminderWhen: (iso: string) => iso,
  },
}

function requireMock(specifier: string): unknown {
  if (!(specifier in fakes)) throw Error('Unexpected module import: ' + specifier)
  return fakes[specifier]
}

const source = readFileSync(resolve(process.cwd(), 'lib/bot/handlers/edit-reminder.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: 'lib/bot/handlers/edit-reminder.ts',
}).outputText
const mod: { exports: Record<string, unknown> } = { exports: {} }
new Function('require', 'module', 'exports', compiled)(requireMock, mod, mod.exports)
const shippedCancel = mod.exports.cancelReminder as (ownerId: number, command: string) => Promise<string>
if (typeof shippedCancel !== 'function') throw Error('Real cancelReminder export missing')

async function test(
  label: string,
  rows: Row[],
  command: string,
  expectedStoppedIds: number[],
) {
  checks++
  table = rows
  stopped = []
  try {
    const response = await shippedCancel(owner, command)
    const actual = [...stopped].sort((a, b) => a - b)
    const expected = [...expectedStoppedIds].sort((a, b) => a - b)
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    if (!ok) failures++
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + label +
      ' (expected=' + expected.length + ', actual=' + actual.length +
      ', reply=' + (response.includes('Cancelled') ? 'cancelled' : 'other') + ')')
  } catch (err) {
    failures++
    console.error('FAIL ' + label + ': ' + (err instanceof Error ? err.message : String(err)))
  }
}

const six = row(101, '2026-11-15T00:30:00.000Z') // 06:00 IST
const nine = row(102, '2026-11-15T03:30:00.000Z') // 09:00 IST
const foreignOwner = row(999, '2026-11-15T00:30:00.000Z', 43)

// Positive controls: user-authorized unqualified bulk, single time-specific
// cancellation and an unrelated owner's private row must remain untouched.
await test('control: unqualified all cancels both owned time slots', [six, nine, foreignOwner],
  'cancel all water reminders', [101, 102])
await test('control: singular 6am cancels only 6am', [six, nine],
  'cancel water reminder at 6am', [101])
await test('control: singular 9am cancels only 9am', [six, nine],
  'cancel water reminder at 9am', [102])

// Expected RED on deployed #1098: bulk candidate selection ignores qualifiers,
// so a destructive mutation touches reminders the user did not name.
await test('P1: bulk with 6am qualifier must preserve 9am', [six, nine],
  'cancel all water reminders at 6am', [101])
await test('P1: bulk with 9am qualifier must preserve 6am', [six, nine],
  'cancel all water reminders at 9am', [102])

const monday = row(201, '2026-11-16T00:30:00.000Z', owner, 'every_monday')
const tuesday = row(202, '2026-11-17T00:30:00.000Z', owner, 'every_tuesday')
await test('P1: bulk Monday qualifier must preserve Tuesday series', [monday, tuesday],
  'cancel all water reminders on monday', [201])

console.log('Bulk reminder time boundary: ' + (checks - failures) + '/' + checks +
  ' passed, ' + failures + ' failed; fake-only, TEST ONLY, no actual cancellation')
if (failures) process.exitCode = 1
