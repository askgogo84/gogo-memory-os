// Synthetic actual-route lifecycle-email owner/recipient/consent containment.
// No real DB, email, token, customer, credential, provider or network access.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('app/api/cron/lifecycle-emails/route.ts', 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText

type User = {
  telegram_id: unknown, name: string, email: string, email_captured_at: string,
  email_opt_out: boolean, onboarding_started_at: null, created_at: string
}
const row = (owner: unknown, email = 'owner@example.test'): User => ({
  telegram_id: owner, name: 'Fixture', email, email_captured_at: '2026-09-01T00:00:00Z',
  email_opt_out: false, onboarding_started_at: null, created_at: '2026-09-01T00:00:00Z',
})

let scanRows: User[] = []
let freshUser: Record<string, unknown> | null = null
let freshError = false
const logOwnerPredicates: unknown[] = []
const freshOwnerPredicates: unknown[] = []
const sendCalls: any[] = []
const logWrites: any[] = []
const urlInputs: any[] = []

const fakeDb = {
  from(table: string) {
    assert.ok(table === 'users' || table === 'lifecycle_email_log', 'unexpected private DB table ' + table)
    const filters: Array<[string, unknown]> = []
    let columns = ''
    const q: any = {
      select(value: string) { columns = value; return q },
      not() { return q },
      order() { return q },
      limit() { return q },
      eq(field: string, value: unknown) {
        filters.push([field, value])
        if (field === 'telegram_id' && table === 'lifecycle_email_log') logOwnerPredicates.push(value)
        if (field === 'telegram_id' && table === 'users') freshOwnerPredicates.push(value)
        return q
      },
      async maybeSingle() {
        assert.equal(table, 'users', 'only users can be rechecked')
        assert.ok(columns.includes('telegram_id'), 'fresh consent read must project owner for row verification')
        if (freshError) return { data: null, error: { message: 'fixture unavailable' } }
        return { data: freshUser, error: null }
      },
      async insert(value: any) {
        assert.equal(table, 'lifecycle_email_log')
        logWrites.push(value)
        return { error: null }
      },
      then(resolve: (result: unknown) => unknown, reject?: (err: unknown) => unknown) {
        try {
          if (table === 'users') {
            assert.equal(filters.length, 0, 'bulk scan must not spoof returned owner rows')
            return resolve({ data: scanRows.filter(x => x.email), error: null })
          }
          return resolve({ data: [], error: null })
        } catch (error) {
          if (reject) return reject(error)
          throw error
        }
      },
    }
    return q
  },
}
const mockModules: Record<string, unknown> = {
  'next/server': {
    NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status || 200 }) },
  },
  '@/lib/security/cron-auth': { isCronAuthorized: () => true },
  '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
  '@/lib/email/lifecycle': {
    LIFECYCLE_EMAILS: [{ key: 'first_tips', day: 0 }],
    renderLifecycleEmail: ({ unsubscribeUrl }: { unsubscribeUrl: string }) => ({
      subject: 'Inert lifecycle example', html: '<p>fixture</p>', text: 'fixture', unsubscribeUrl,
    }),
  },
  '@/lib/email/resend': {
    sendAskGogoEmail: async (input: unknown) => {
      sendCalls.push(input)
      return { ok: true, id: 'inert-provider-message' }
    },
  },
  '@/lib/email/unsubscribe': {
    buildUnsubscribeUrl: (id: unknown, email: string) => {
      urlInputs.push([id, email])
      return 'https://example.test/unsubscribe'
    },
  },
}
const mod = { exports: {} as Record<string, any> }
runInNewContext(js, {
  module: mod, exports: mod.exports, require: (name: string) => {
    if (!(name in mockModules)) throw new Error('unexpected import ' + name)
    return mockModules[name]
  },
  Date, URL, Number, String, Set, Math, console,
}, { filename: 'app/api/cron/lifecycle-emails/route.ts', timeout: 3000 })
const GET = mod.exports.GET
assert.equal(typeof GET, 'function')

async function run(owner: unknown, opts: { fresh?: Record<string, unknown> | null, freshError?: boolean, dry?: boolean } = {}) {
  scanRows = [row(owner)]
  freshUser = opts.fresh === undefined ? { telegram_id: owner, email: scanRows[0].email, email_opt_out: false } : opts.fresh
  freshError = opts.freshError === true
  sendCalls.length = 0
  logWrites.length = 0
  logOwnerPredicates.length = 0
  freshOwnerPredicates.length = 0
  urlInputs.length = 0
  const response = await GET({ url: 'https://example.test/api/cron/lifecycle-emails' + (opts.dry ? '?dry=1' : '') })
  return response
}

// Distinct signed64 owner IDs, noncanonical IDs, and already-rounded JS numbers
// cannot be used as a private log lookup, unsubscribe owner or email key.
for (const invalid of [
  '9007199254740992', '9007199254740993', 9007199254740992,
  '-9007199254740993', '00123', '123suffix', ' 123', '+123', 0,
  null, undefined, '1.5',
]) {
  const response = await run(invalid)
  assert.equal(sendCalls.length, 0, 'unsafe owner triggered provider call: ' + String(invalid))
  assert.equal(logOwnerPredicates.length, 0, 'unsafe owner reached private log lookup')
  assert.equal(freshOwnerPredicates.length, 0, 'unsafe owner reached private user lookup')
  assert.equal(logWrites.length, 0, 'unsafe owner logged a different identity')
  assert.equal(response.body.skipped, 1)
}

// Canonical safe owners preserve existing deterministic idempotency & log keys.
for (const safe of ['123', '-123', 123]) {
  const response = await run(safe)
  assert.equal(response.status, 200)
  assert.equal(sendCalls.length, 1, 'valid owner still gets its opted-in lifecycle email')
  assert.equal(logWrites.length, 1)
  assert.equal(logWrites[0].telegram_id, Number(safe))
  assert.equal(sendCalls[0].idempotencyKey, 'lifecycle/' + String(safe) + '/first_tips')
  assert.deepEqual(freshOwnerPredicates, [String(safe)], 'recheck must bind exact canonical owner text')
  assert.deepEqual(logOwnerPredicates, [String(safe)], 'log read must use exact canonical owner text')
  assert.equal(response.body.sent, 1)
}

// Consent and destination are checked again at the immediate send boundary.
// Scan-time opt-in alone is insufficient: an opt-out after scan is not approval.
for (const fresh of [
  { telegram_id: '123', email: 'owner@example.test', email_opt_out: true },
  { telegram_id: '123', email: 'changed@example.test', email_opt_out: false },
  { telegram_id: '124', email: 'owner@example.test', email_opt_out: false },
  null,
]) {
  await run('123', { fresh })
  assert.equal(sendCalls.length, 0, 'stale consent, changed destination or foreign owner must not send')
  assert.equal(logWrites.length, 0)
}
const readFailure = await run('123', { freshError: true })
assert.equal(sendCalls.length, 0, 'consent DB read error must never send')
assert.equal(logWrites.length, 0)
assert.ok(readFailure.body.failures.length > 0, 'DB uncertainty is a recorded delivery failure')

// A dry-run remains inert; it describes a candidate but never sends.
const dry = await run('123', { dry: true })
assert.equal(dry.body.dryRun, true)
assert.equal(dry.body.candidates.length, 1)
assert.equal(sendCalls.length, 0)
assert.equal(logWrites.length, 0)

console.log('lifecycle email exact owner and consent boundary: inert actual-route checks passed')
