// TEST-ONLY, EXPECTED RED: lifecycle email transport uncertainty is NOT a definite rejection.
// Executes real (transpiled) sender and cron-route TypeScript with in-memory fake Resend and Supabase.
// No real network, account, email, user data, credentials, cron invocation, or production changes.
// Source control: #274. The lifecycle route is separately leased to draft #985; DO NOT edit it here.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const SENDER_PATH = 'lib/email/resend.ts'
const ROUTE_PATH = 'app/api/cron/lifecycle-emails/route.ts'
const OWNER = 1234
const EMAIL = 'synthetic@example.invalid'
const STEP = 'fixture-first'
const DEADLINE = '2026-10-01T00:00:00Z'

type Stub = Record<string, unknown>
type FetchStub = (url: string, init: any) => Promise<any>

function sourceModule(filePath: string, stubs: Stub, providerFetch: FetchStub) {
  // Load ACTUAL checked-out application source; require() is an explicit allowlist.
  const code = ts.transpileModule(readFileSync(filePath, 'utf8'), {
    fileName: filePath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    reportDiagnostics: true,
  })
  assert.equal(code.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length || 0, 0)
  const mod: { exports: Record<string, any> } = { exports: {} }
  vm.runInNewContext(code.outputText, {
    exports: mod.exports, module: mod,
    require: (name: string) => {
      if (!Object.prototype.hasOwnProperty.call(stubs, name)) throw Error('Unexpected application dependency ' + name)
      return stubs[name]
    },
    process: { env: { RESEND_API_KEY: 'synthetic-not-real', EMAIL_FROM: 'Test <synthetic@example.invalid>' } },
    fetch: providerFetch,
    Date, Math, JSON, URL, AbortSignal, setTimeout, clearTimeout,
    console: { log: () => {}, error: () => {} },
  }, { filename: filePath + '.inert.cjs', timeout: 2000 })
  return mod.exports
}

function makeFakeDb(settings: { optedOut?: boolean; prelogged?: boolean } = {}) {
  const users = [{ telegram_id: OWNER, name: 'Synthetic', email: EMAIL,
    email_captured_at: DEADLINE, email_opt_out: Boolean(settings.optedOut),
    onboarding_started_at: DEADLINE, created_at: DEADLINE }]
  const logs: Array<Record<string, unknown>> = settings.prelogged
    ? [{ telegram_id: OWNER, email_key: STEP, sent_at: '2026-10-28T12:00:00Z' }] : []
  const reads: string[] = []
  function from(name: string) {
    assert.ok(['users', 'lifecycle_email_log'].includes(name), 'only two fixture tables may be queried')
    let op = 'select'
    const filters: Array<{ key: string; value: unknown }> = []
    const query: any = {
      select: () => query,
      not: () => query,
      order: () => query,
      limit: () => query,
      eq: (key: string, value: unknown) => { filters.push({ key, value }); return query },
      maybeSingle: async () => {
        const result = await evaluate()
        return { data: result.data?.[0] || null, error: result.error }
      },
      insert: async (data: Record<string, unknown>) => {
        assert.equal(name, 'lifecycle_email_log')
        logs.push({ ...data, sent_at: new Date().toISOString() })
        return { error: null }
      },
      then: (resolve: any, reject: any) => evaluate().then(resolve, reject),
    }
    async function evaluate() {
      assert.equal(op, 'select')
      reads.push(name)
      const rows = (name === 'users' ? users : logs)
        .filter(row => filters.every(f => String((row as Record<string, unknown>)[f.key]) === String(f.value)))
      return { data: rows, error: null }
    }
    return query
  }
  return { from, reads, logs }
}

function createInertHarness(providerFetch: FetchStub, settings: { optedOut?: boolean; prelogged?: boolean } = {}) {
  const db = makeFakeDb(settings)
  const sender = sourceModule(SENDER_PATH, {}, providerFetch)
  assert.equal(typeof sender.sendAskGogoEmail, 'function', 'real sender implementation must be executed')
  const route = sourceModule(ROUTE_PATH, {
    'next/server': { NextResponse: { json: (body: unknown, options: any = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/security/cron-auth': { isCronAuthorized: () => true },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/email/lifecycle': {
      LIFECYCLE_EMAILS: [{ key: STEP, day: 0 }],
      renderLifecycleEmail: () => ({
        subject: 'Synthetic onboarding',
        html: '<p>synthetic</p>',
        text: 'synthetic only',
      }),
    },
    '@/lib/email/resend': sender,
    '@/lib/email/unsubscribe': { buildUnsubscribeUrl: () => 'https://example.invalid/unsubscribe' },
  }, providerFetch)
  assert.equal(typeof route.GET, 'function', 'real lifecycle cron route must be executed')
  const invoke = () => route.GET({ url: 'https://fixture.invalid/api/cron/lifecycle-emails' })
  return { invoke, db }
}

const results: Array<{ case: string; pass: boolean; detail: string }> = []
async function check(label: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ case: label, pass: true, detail: '' }); console.log('PASS ' + label) }
  catch (error: any) {
    const msg = String(error?.message || error).slice(0, 350)
    results.push({ case: label, pass: false, detail: msg }); console.error('FAIL ' + label + ': ' + msg)
  }
}

await check('control: successful Resend acceptance writes log and suppresses next cron send', async () => {
  const calls: any[] = []
  const h = createInertHarness(async (_url, init) => {
    calls.push(init)
    return { ok: true, status: 200, json: async () => ({ id: 'synthetic-receipt-1' }) }
  })
  const first = await h.invoke()
  assert.equal(first.body.sent, 1)
  assert.equal(h.db.logs.length, 1)
  const second = await h.invoke()
  assert.equal(second.body.sent, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers['Idempotency-Key'], 'lifecycle/' + OWNER + '/' + STEP)
})
await check('control: opt-out never reaches email provider', async () => {
  let sent = 0
  const h = createInertHarness(async () => { sent++; throw Error('provider must not be called') }, { optedOut: true })
  const result = await h.invoke()
  assert.equal(result.body.sent, 0)
  assert.equal(sent, 0)
})
await check('control: existing lifecycle delivery log suppresses repeated send', async () => {
  let sent = 0
  const h = createInertHarness(async () => { sent++; throw Error('provider must not be called') }, { prelogged: true })
  const result = await h.invoke()
  assert.equal(result.body.sent, 0)
  assert.equal(sent, 0)
})
await check('control: definitely rejected provider request can be reconsidered; no acceptance claimed', async () => {
  let attempts = 0
  const h = createInertHarness(async () => {
    attempts++
    return { ok: false, status: 400, json: async () => ({ message: 'Synthetic definite rejection' }) }
  })
  const first = await h.invoke()
  assert.equal(first.body.sent, 0)
  assert.equal(first.body.failures.length, 1)
  assert.equal(h.db.logs.length, 0)
  await h.invoke()
  assert.equal(attempts, 2, 're-attempt after definite rejection does not imply an accepted side effect')
})

await check('P1: accepted-then-timeout MUST NOT retry unknown email outcome on the next cron run', async () => {
  const events: string[] = []
  const providerKeys: string[] = []
  const h = createInertHarness(async (_url, init) => {
    providerKeys.push(String(init?.headers?.['Idempotency-Key'] || ''))
    events.push('provider-accepted-' + providerKeys.length)
    if (events.length === 1) {
      // First POST reached a fake provider which accepted it; response was lost.
      const err = Object.assign(new Error('Synthetic ETIMEDOUT after upstream acceptance'), { code: 'ETIMEDOUT' })
      throw err
    }
    // Separate later run: fake provider's finite dedupe window has elapsed.
    return { ok: true, status: 200, json: async () => ({ id: 'second-provider-receipt' }) }
  })
  const first = await h.invoke()
  assert.equal(first.body.sent, 0)
  assert.equal(first.body.failures.length, 1)
  assert.equal(h.db.logs.length, 0, 'current route does not persist the uncertain first request')
  const second = await h.invoke()
  // A stable provider idempotency key is not permanent; the local ledger must
  // preserve outcome_unknown without a blind second acceptance attempt.
  assert.equal(providerKeys[0], 'lifecycle/' + OWNER + '/' + STEP)
  assert.equal(providerKeys[1], providerKeys[0])
  assert.equal(events.length, 1, 'do not issue a second POST when prior acceptance was ambiguous; observed: ' + events.join(','))
  assert.equal(second.body.sent, 0, 'do not claim fresh successful send after an ambiguous earlier acceptance')
})

const failed = results.filter(r => !r.pass)
console.log('LIFECYCLE_EMAIL_UNKNOWN_TESTONLY', JSON.stringify({ passes: results.length - failed.length, failed: failed.map(f => f.case), source: [SENDER_PATH, ROUTE_PATH], network: 'in-memory-only' }))
if (failed.length) process.exitCode = 1
