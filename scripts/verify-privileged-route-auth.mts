import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import {
  isInternalServiceAuthorized,
  internalServiceAuthHeaders,
  isCronAuthorized,
} from '../lib/security/cron-auth'

// ─────────────────────────────────────────────────────────────────────────────
// Privileged-route authorization regression.
//
// These routes use the Supabase service-role key. Before this fix they had NO
// authentication: /api/admin/stats dumped user PII, and the bot-action routes
// (todos, contacts, expenses, news, skin-reminder, briefing, reminders/create,
// referral) read/wrote ANY user's data keyed by a caller-supplied `phone`.
//
// This test drives the ACTUAL route handlers (transpiled + run with mocked
// Supabase/session boundaries) and asserts:
//   - missing / invalid auth  → 401, ZERO privileged DB calls
//   - authenticated non-admin → 403 on admin stats, ZERO PII query
//   - a caller supplying a victim's phone but no secret → 401, ZERO DB calls
//   - a malformed authorized request → 400, ZERO DB mutation
//   - a valid authorized (internal-service / admin) request → passes the guard
// It executes behavior; it does not grep source for guard names.
// ─────────────────────────────────────────────────────────────────────────────

// Keep the real production secret out of this process/logs: pin a fixture value.
// Each verify-* script is its own `tsx` process, so this override is isolated.
process.env.CRON_SECRET = 'test-internal-secret'
const GOOD = internalServiceAuthHeaders().Authorization // "Bearer test-internal-secret"

// ── 1. Guard truth-table (the real shared guard every route calls) ────────────
const req = (auth?: string, url = 'https://app.askgogo.in/api/todos') =>
  new Request(url, { headers: auth ? { authorization: auth } : {} }) as unknown as Request

assert.equal(isInternalServiceAuthorized(req()), false, 'no header (real env) → rejected')
assert.equal(isInternalServiceAuthorized(req(undefined), { CRON_SECRET: 'test-internal-secret' }), false, 'missing header rejected')
assert.equal(isInternalServiceAuthorized(req(GOOD), { CRON_SECRET: 'test-internal-secret' }), true, 'correct bearer accepted')
assert.equal(isInternalServiceAuthorized(req('Bearer wrong'), { CRON_SECRET: 'test-internal-secret' }), false, 'wrong bearer rejected')
assert.equal(isInternalServiceAuthorized(req(GOOD), { CRON_SECRET: '' }), false, 'fail-closed when secret unset')
assert.equal(internalServiceAuthHeaders({ CRON_SECRET: '' }).Authorization, 'Bearer ', 'empty bearer when secret unset (fails closed downstream)')
// It shares the cron secret mechanism, so a valid cron bearer is equivalent.
assert.equal(isCronAuthorized(req(GOOD), { CRON_SECRET: 'test-internal-secret' }), true, 'reuses the cron shared-secret check')
console.log('guard truth-table passed')

// ── Handler harness ───────────────────────────────────────────────────────────
type Res = { status: number; body: any }
const NextResponse = { json: (body: any, init?: { status?: number }): Res => ({ status: init?.status ?? 200, body }) }

function makeSpy() {
  const calls: string[] = []
  const result = { data: [], error: null, count: 0 }
  const builder: any = {}
  for (const m of ['select', 'eq', 'or', 'ilike', 'in', 'order', 'limit', 'not', 'gte', 'lte', 'lt', 'gt', 'update', 'insert', 'delete', 'is']) {
    builder[m] = () => builder
  }
  builder.single = async () => result
  builder.maybeSingle = async () => result
  builder.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
  const client = { from: (table: string) => { calls.push(table); return builder } }
  return { client, calls }
}

function fakeReq(opts: { url?: string; auth?: string; body?: any } = {}) {
  const url = opts.url ?? 'https://app.askgogo.in/api/route'
  const headers = new Map<string, string>()
  if (opts.auth !== undefined) headers.set('authorization', opts.auth)
  return {
    url,
    method: 'POST',
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    nextUrl: new URL(url),
    json: async () => opts.body ?? {},
  } as any
}

function loadRoute(relPath: string, extraMocks: Record<string, any>, spy: ReturnType<typeof makeSpy>) {
  const source = readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mocks: Record<string, any> = {
    'next/server': { NextResponse, NextRequest: class {} },
    '@supabase/supabase-js': { createClient: () => spy.client },
    '@/lib/supabase-admin': { supabaseAdmin: spy.client },
    '@/lib/security/cron-auth': { isInternalServiceAuthorized, internalServiceAuthHeaders, isCronAuthorized },
    ...extraMocks,
  }
  const exportsObj: any = {}
  runInNewContext(code, {
    exports: exportsObj,
    require: (name: string) => mocks[name] ?? {},
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture', CRON_SECRET: 'test-internal-secret', NEXT_PUBLIC_APP_URL: 'https://app.askgogo.in' } },
    Buffer, URL, URLSearchParams, console, fetch: async () => { throw new Error('network blocked in test') }, AbortSignal, Date, Intl, Math, JSON,
  })
  return exportsObj
}

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) { console.log('  ok —', name) } else { failures++; console.error('  FAIL —', name) }
}

// ── 2. Bot-action routes: internal-service secret required ────────────────────
const resolveUserMock = { '@/lib/bot/resolve-user': { resolveUser: async () => ({ telegramId: 1, whatsappId: 'whatsapp:+10000000000', timezone: 'Asia/Kolkata' }) } }

// todos — full matrix incl. a real authorized mutation.
{
  const spy = makeSpy()
  const r = loadRoute('app/api/todos/route.ts', {}, spy)
  // missing auth → 401, ZERO DB (this is also the "User A targets User B's phone" case)
  spy.calls.length = 0
  let res: Res = await r.POST(fakeReq({ body: { phone: '+victim', action: 'list' } }))
  check('todos: no-auth caller supplying a victim phone → 401', res.status === 401)
  check('todos: no-auth → zero privileged DB calls', spy.calls.length === 0)
  // invalid bearer → 401, ZERO DB
  spy.calls.length = 0
  res = await r.POST(fakeReq({ auth: 'Bearer wrong', body: { phone: '+victim', action: 'clear' } }))
  check('todos: invalid bearer → 401', res.status === 401)
  check('todos: invalid bearer → zero DB calls (no delete)', spy.calls.length === 0)
  // authorized + malformed (no phone) → 400, ZERO DB
  spy.calls.length = 0
  res = await r.POST(fakeReq({ auth: GOOD, body: { action: 'add', text: 'x' } }))
  check('todos: authorized malformed (no phone) → 400', res.status === 400)
  check('todos: malformed → zero DB mutation', spy.calls.length === 0)
  // authorized + valid → proceeds, DB touched
  spy.calls.length = 0
  res = await r.POST(fakeReq({ auth: GOOD, body: { phone: '+15551234567', action: 'add', text: 'milk' } }))
  check('todos: authorized valid add → 200', res.status === 200)
  check('todos: authorized valid add → DB insert on todos', spy.calls.includes('todos'))
}

// contacts
{
  const spy = makeSpy()
  const r = loadRoute('app/api/contacts/route.ts', {}, spy)
  spy.calls.length = 0
  let res: Res = await r.POST(fakeReq({ body: { phone: '+victim', action: 'list' } }))
  check('contacts: no-auth → 401', res.status === 401)
  check('contacts: no-auth → zero DB calls', spy.calls.length === 0)
  spy.calls.length = 0
  res = await r.POST(fakeReq({ auth: GOOD, body: { phone: '+15551234567', action: 'list' } }))
  check('contacts: authorized → DB read on contact_memory', spy.calls.includes('contact_memory'))
}

// news (valid path would hit tavily fetch → use malformed to prove guard-pass without network)
{
  const spy = makeSpy()
  const r = loadRoute('app/api/news/route.ts', {}, spy)
  spy.calls.length = 0
  let res: Res = await r.POST(fakeReq({ body: { phone: '+victim' } }))
  check('news: no-auth → 401', res.status === 401)
  check('news: no-auth → zero DB calls', spy.calls.length === 0)
  spy.calls.length = 0
  res = await r.POST(fakeReq({ auth: GOOD, body: {} }))
  check('news: authorized malformed (no phone) → 400', res.status === 400)
  check('news: malformed → zero DB calls', spy.calls.length === 0)
}

// expenses (POST + GET)
{
  const spy = makeSpy()
  const r = loadRoute('app/api/expenses/route.ts', {
    '@/lib/bot/services/expense-analyzer': { parseExpenseText: async () => null, generateDailyInsight: async () => '' },
    '@/lib/bot/services/expense-storage': { saveExpense: async () => {}, getTodayExpenses: async () => ({ total: 0, count: 0, byCategory: {}, entries: [], topCategory: 'Food' }), getPeriodExpenses: async () => null },
  }, spy)
  spy.calls.length = 0
  let res: Res = await r.POST(fakeReq({ body: { phone: '+victim', text: 'spent 200' } }))
  check('expenses POST: no-auth → 401', res.status === 401)
  check('expenses POST: no-auth → zero DB calls', spy.calls.length === 0)
  spy.calls.length = 0
  res = await r.GET(fakeReq({ url: 'https://app.askgogo.in/api/expenses?phone=+victim' }))
  check('expenses GET: no-auth → 401', res.status === 401)
  check('expenses GET: no-auth → zero DB calls', spy.calls.length === 0)
  // authorized POST → owner derived via users lookup (guard passed)
  spy.calls.length = 0
  res = await r.POST(fakeReq({ auth: GOOD, body: { phone: '+15551234567', text: 'spent 200 on lunch' } }))
  check('expenses POST: authorized → resolves owner via users lookup', spy.calls.includes('users'))
}

// skin-reminder
{
  const spy = makeSpy()
  const r = loadRoute('app/api/skin-reminder/route.ts', resolveUserMock, spy)
  spy.calls.length = 0
  let res: Res = await r.POST(fakeReq({ body: { phone: '+victim' } }))
  check('skin-reminder: no-auth → 401', res.status === 401)
  check('skin-reminder: no-auth → zero DB calls (no reminder insert)', spy.calls.length === 0)
  spy.calls.length = 0
  res = await r.POST(fakeReq({ auth: GOOD, body: { phone: '+15551234567' } }))
  check('skin-reminder: authorized → reminders insert reached', spy.calls.includes('reminders'))
}

// reminders/create (dead route, gated fail-closed)
{
  const spy = makeSpy()
  const r = loadRoute('app/api/reminders/create/route.ts', {
    ...resolveUserMock,
    '@/lib/timezone': { normalizeTimezone: (x: any) => x || 'Asia/Kolkata', parseLocalDateTime: () => ({ dueAtUtc: new Date(Date.now() + 3600000), dueAtUtcISO: new Date(Date.now() + 3600000).toISOString(), displayText: 'later' }) },
  }, spy)
  spy.calls.length = 0
  let res: Res = await r.POST(fakeReq({ body: { phone: '+victim', reminder_text: 'x', date: '2027-01-01', time: '09:00', timezone: 'Asia/Kolkata' } }))
  check('reminders/create: no-auth → 401', res.status === 401)
  check('reminders/create: no-auth → zero DB (no timezone overwrite, no insert)', spy.calls.length === 0)
  spy.calls.length = 0
  res = await r.POST(fakeReq({ auth: GOOD, body: { phone: '+15551234567', reminder_text: 'call', date: '2027-01-01', time: '09:00' } }))
  check('reminders/create: authorized → reminders insert reached', spy.calls.includes('reminders'))
}

// briefing POST (GET keeps its own ?secret= guard, unchanged)
{
  const spy = makeSpy()
  const r = loadRoute('app/api/briefing/route.ts', { '@/lib/whatsapp': { sendWhatsApp: async () => {} } }, spy)
  spy.calls.length = 0
  let res: Res = await r.POST(fakeReq({ body: { phone: '+victim' } }))
  check('briefing POST: no-auth → 401', res.status === 401)
  check('briefing POST: no-auth → zero DB calls', spy.calls.length === 0)
  spy.calls.length = 0
  res = await r.POST(fakeReq({ auth: GOOD, body: { phone: '+15551234567' } }))
  check('briefing POST: authorized → user context load reached', spy.calls.includes('users'))
}

// referral (dead route, GET + POST gated)
{
  const spy = makeSpy()
  const r = loadRoute('app/api/referral/route.ts', { '@/lib/whatsapp': { sendWhatsApp: async () => {} } }, spy)
  spy.calls.length = 0
  let res: Res = await r.GET(fakeReq({ url: 'https://app.askgogo.in/api/referral?phone=+victim' }))
  check('referral GET: no-auth → 401', res.status === 401)
  check('referral GET: no-auth → zero DB calls (no code mint)', spy.calls.length === 0)
  spy.calls.length = 0
  res = await r.POST(fakeReq({ body: { action: 'apply', phone: '+victim', code: 'AGXXXX' } }))
  check('referral POST: no-auth → 401', res.status === 401)
  check('referral POST: no-auth → zero DB calls (no referred_by write)', spy.calls.length === 0)
}

// ── 3. /api/admin/stats: admin authority required ─────────────────────────────
function adminStats(verdict: any) {
  const spy = makeSpy()
  const r = loadRoute('app/api/admin/stats/route.ts', { '@/lib/admin/auth': { requireAdminSession: async () => verdict } }, spy)
  return { r, spy }
}
{
  // unauthenticated → 401, ZERO PII query
  let { r, spy } = adminStats({ ok: false, status: 401, reason: 'unauthenticated' })
  spy.calls.length = 0
  let res: Res = await r.GET()
  check('admin/stats: unauthenticated → 401', res.status === 401)
  check('admin/stats: unauthenticated → zero DB calls (no PII dump)', spy.calls.length === 0)

  // authenticated NON-admin → 403, ZERO PII query
  ;({ r, spy } = adminStats({ ok: false, status: 403, reason: 'not_admin' }))
  spy.calls.length = 0
  res = await r.GET()
  check('admin/stats: authenticated non-admin → 403', res.status === 403)
  check('admin/stats: non-admin → zero DB calls (no PII dump)', spy.calls.length === 0)

  // admin → proceeds, queries run
  ;({ r, spy } = adminStats({ ok: true, telegramId: '1', whatsappId: 'whatsapp:+1' }))
  spy.calls.length = 0
  res = await r.GET()
  check('admin/stats: admin → 200', res.status === 200)
  check('admin/stats: admin → users table queried (PII only after auth)', spy.calls.includes('users'))
}

if (failures > 0) {
  console.error(`\nprivileged-route-auth verification FAILED: ${failures} check(s)`)
  process.exit(1)
}
console.log('\nprivileged-route authorization verification passed')
