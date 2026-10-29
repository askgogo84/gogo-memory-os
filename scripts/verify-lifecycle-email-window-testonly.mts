// TEST-ONLY: execute the real lifecycle-email cron in an isolated VM.
// Every address is synthetic .invalid, dry=1, no network/database/provider calls.
// No application code or existing tests are changed by this draft.
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type User = { telegram_id: number; name: string; email: string; email_captured_at: string; email_opt_out: boolean; onboarding_started_at: string; created_at: string }
let users: User[] = []
let completedOwners = new Set<number>()
let authorized = true
let failUserRead = false
let dbQueries = 0
let providerSendAttempts = 0

const fakeDb = {
  from(table: string) {
    let filters: Array<{ field: string; operator: string; value: unknown }> = []
    let sortField = ''
    let sortAscending = true
    let start = 0
    let end = Number.POSITIVE_INFINITY
    let owner: unknown = null
    const q: any = {
      select(_columns: string) { return q },
      not(field: string, operator: string, value: unknown) {
        filters.push({ field, operator: 'not_' + operator, value })
        return q
      },
      eq(field: string, value: unknown) {
        filters.push({ field, operator: 'eq', value })
        if (table === 'lifecycle_email_log' && field === 'telegram_id') owner = value
        return q
      },
      is(field: string, value: unknown) { filters.push({ field, operator: 'is', value }); return q },
      order(field: string, opts?: { ascending?: boolean }) {
        sortField = field
        sortAscending = opts?.ascending !== false
        return q
      },
      limit(n: number) { end = Math.min(end, start + n - 1); return q },
      range(first: number, last: number) { start = first; end = last; return q },
      async then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
        try {
          dbQueries++
          if (table === 'users') {
            if (failUserRead) return resolve({ data: null, error: { message: 'inert_user_read_failure' } })
            const selected = users.filter(row => filters.every(f => {
              const v = (row as any)[f.field]
              if (f.operator === 'not_is') return v !== f.value
              if (f.operator === 'is') return v === f.value
              if (f.operator === 'eq') return v === f.value
              throw new Error('Unexpected users filter: ' + f.operator)
            })).sort((a, b) => {
              if (!sortField) return 0
              const left = String((a as any)[sortField] || '')
              const right = String((b as any)[sortField] || '')
              return (left < right ? -1 : left > right ? 1 : 0) * (sortAscending ? 1 : -1)
            }).slice(start, Number.isFinite(end) ? end + 1 : undefined)
            return resolve({ data: selected, error: null })
          }
          if (table === 'lifecycle_email_log') {
            const rows = completedOwners.has(Number(owner))
              ? [{ email_key: 'welcome', sent_at: new Date().toISOString() }]
              : []
            return resolve({ data: rows, error: null })
          }
          throw new Error('Unexpected private table: ' + table)
        } catch (error) {
          if (reject) return reject(error)
          throw error
        }
      },
    }
    return q
  },
}

const moduleRef: { exports: Record<string, any> } = { exports: {} }
const source = readFileSync('app/api/cron/lifecycle-emails/route.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText

const mocks: Record<string, unknown> = {
  'next/server': { NextResponse: { json: (body: any, options?: { status?: number }) => ({
    status: options?.status ?? 200, body,
  }) } },
  '@/lib/security/cron-auth': { isCronAuthorized: () => authorized },
  '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
  '@/lib/email/lifecycle': {
    LIFECYCLE_EMAILS: [{ key: 'welcome', day: 0 }],
    renderLifecycleEmail: ({ email }: { email: { key: string } }) => ({
      subject: 'Inert ' + email.key, html: '<p>test only</p>', text: 'test only',
    }),
  },
  '@/lib/email/resend': { sendAskGogoEmail: async () => {
    providerSendAttempts++
    throw new Error('TEST VIOLATION: no provider sends allowed')
  } },
  '@/lib/email/unsubscribe': { buildUnsubscribeUrl: () => 'https://example.invalid/unsubscribe' },
}
runInNewContext(compiled, {
  module: moduleRef, exports: moduleRef.exports,
  require: (name: string) => {
    if (!(name in mocks)) throw new Error('Unexpected import: ' + name)
    return mocks[name]
  },
  Date, Number, String, Set, URL, console,
}, { filename: 'app/api/cron/lifecycle-emails/route.ts', timeout: 3000 })

assert.equal(typeof moduleRef.exports.GET, 'function', 'Must execute actual shipped GET handler')
const user = (index: number, optedOut = false): User => ({
  telegram_id: 50000 + index,
  name: 'Synthetic User',
  email: 'synthetic' + index + '@example.invalid',
  email_captured_at: new Date(Date.UTC(2020, 0, 1, 0, index)).toISOString(),
  onboarding_started_at: '2020-01-01T00:00:00.000Z',
  created_at: '2020-01-01T00:00:00.000Z',
  email_opt_out: optedOut,
})
const reset = (rows: User[], completed: number[] = []) => {
  users = rows
  completedOwners = new Set(completed)
  authorized = true
  failUserRead = false
  dbQueries = 0
  providerSendAttempts = 0
}
const dryRun = async () => moduleRef.exports.GET({
  url: 'https://app.example.invalid/api/cron/lifecycle-emails?dry=1',
})
let controls = 0
let safetyFailures = 0
async function positive(label: string, fn: () => Promise<void>) {
  try { await fn(); controls++; console.log('PASS control: ' + label) }
  catch (e) { safetyFailures++; console.error('FAIL control: ' + label + ':', e) }
}
async function safety(label: string, fn: () => Promise<void>) {
  try { await fn(); console.log('PASS safety: ' + label) }
  catch (e) { safetyFailures++; console.error('FAIL safety (EXPECTED RED on unsafe implementation): ' + label + ':', e) }
}

await positive('authorized dry preview considers eligible user within window; no email sent', async () => {
  reset([user(1, true), user(2, false)])
  const result = await dryRun()
  assert.equal(result.status, 200)
  assert.equal(result.body.dryRun, true)
  assert.deepEqual(Array.from(result.body.candidates, (c: any) => c.telegramId), [50002])
  assert.equal(providerSendAttempts, 0)
})
await positive('all opted-out synthetic users never appear as candidates', async () => {
  reset([user(3, true), user(4, true)])
  const result = await dryRun()
  assert.equal(result.status, 200)
  assert.equal(result.body.candidates.length, 0)
  assert.equal(providerSendAttempts, 0)
})
await positive('unauthorized GET fails before private reads', async () => {
  reset([user(5)])
  authorized = false
  const result = await dryRun()
  assert.equal(result.status, 401)
  assert.equal(dbQueries, 0)
  assert.equal(providerSendAttempts, 0)
})
await positive('database read failure denies send', async () => {
  reset([user(6)])
  failUserRead = true
  const result = await dryRun()
  assert.equal(result.status, 500)
  assert.equal(result.body.ok, false)
  assert.equal(providerSendAttempts, 0)
})
await positive('already-sent in-window user is suppressed without provider call', async () => {
  reset([user(7)], [50007])
  const result = await dryRun()
  assert.equal(result.status, 200)
  assert.equal(result.body.candidates.length, 0)
  assert.equal(providerSendAttempts, 0)
})

await safety('251st eligible user is considered despite 250 earlier opted-out rows', async () => {
  reset(Array.from({ length: 250 }, (_, i) => user(i + 1, true)).concat([user(251)]))
  const result = await dryRun()
  assert.equal(result.status, 200)
  assert.ok(result.body.candidates.some((r: any) => r.telegramId === 50251),
    'eligible synthetic user #251 omitted by a permanent fixed 250-row window')
  assert.equal(providerSendAttempts, 0)
})
await safety('251st eligible user is considered despite 250 previously-completed rows', async () => {
  const rows = Array.from({ length: 251 }, (_, i) => user(i + 1))
  reset(rows, rows.slice(0, 250).map(row => row.telegram_id))
  const result = await dryRun()
  assert.equal(result.status, 200)
  assert.ok(result.body.candidates.some((r: any) => r.telegramId === 50251),
    'eligible synthetic user #251 starved by earlier lifecycle-complete cohort')
  assert.equal(providerSendAttempts, 0)
})

console.log('Lifecycle-email window: controls PASS=' + controls + '/5; safety failures=' + safetyFailures + ' (2 expected negatives on shipped route); zero real sends.')
if (safetyFailures > 0) process.exitCode = 1
