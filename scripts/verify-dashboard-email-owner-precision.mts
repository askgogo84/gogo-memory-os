// Security regression: exercise ACTUAL transpiled authenticated handlers with inert
// Supabase/session/response fakes; no database, mailbox, provider or network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const load = (path: string, mocks: Record<string, unknown> = {}) => {
  const source = readFileSync(path, 'utf8')
  const mod: { exports: Record<string, any> } = { exports: {} }
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(js, {
    exports: mod.exports,
    module: mod,
    require: (key: string) => {
      if (Object.prototype.hasOwnProperty.call(mocks, key)) return mocks[key]
      throw new Error('Unexpected import in inert email owner test: ' + key)
    },
    console, URL, Request, Response, Date, BigInt,
  }, { filename: path })
  return mod.exports
}

const { exactDashboardOwnerId } = load('lib/dashboard/exact-owner-id.ts')
const nearA = '9007199254740992'
const nearB = '9007199254740993'
assert.equal(Number(nearA), Number(nearB), 'fixture must expose IEEE-754 owner collision')
for (const owner of ['1', '-1', '42', '-100123456789012', nearA, nearB, '9223372036854775807', '-9223372036854775808']) {
  assert.equal(exactDashboardOwnerId(owner), owner, 'exact signed BIGINT owner ' + owner)
}
for (const bad of ['', '0', '-0', '01', '-01', '+123', ' 123', '123 ', '1.0',
  '9e15', 'NaN', 'Infinity', '9223372036854775808', '-9223372036854775809',
  '999999999999999999999999999999', 123, 9007199254740993, null, undefined]) {
  assert.equal(exactDashboardOwnerId(bad), null, 'reject ambiguous or invalid owner ' + String(bad))
}

const routes = [
  'app/api/dashboard/email-preferences/route.ts',
  'app/api/dashboard/daily-brief-email/route.ts',
]
const NextResponse = {
  json: (body: unknown, init: { status?: number } = {}) =>
    new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'Content-Type': 'application/json' } }),
}

for (const path of routes) {
  const source = readFileSync(path, 'utf8')
  assert.doesNotMatch(source, /Number\s*\(\s*session\.telegramId\s*\)/,
    'authenticated owner may NEVER round before a service-role email read/write')

  let sessionOwner: unknown = nearA
  const calls: Array<{ type: string, table?: string, field?: string, value?: unknown }> = []
  const db = {
    from(table: string) {
      calls.push({ type: 'from', table })
      assert.equal(table, 'users')
      const q: any = {
        select(_columns: string) { calls.push({ type: 'select' }); return q },
        update(_payload: unknown) { calls.push({ type: 'update' }); return q },
        eq(field: string, value: unknown) { calls.push({ type: 'eq', field, value }); return q },
        async maybeSingle() {
          return {
            data: {
              email: 'existing@fixture.invalid',
              email_captured_at: '2026-01-01T00:00:00.000Z',
              email_opt_out: false,
              daily_brief_email_enabled: true,
              briefing_time: '08:00',
            },
            error: null,
          }
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
        },
      }
      return q
    },
  }
  const handlers = load(path, {
    'next/server': { NextResponse },
    '@/lib/dashboard/session': {
      getSession: async () => sessionOwner === null ? null : { telegramId: sessionOwner },
    },
    '@/lib/dashboard/exact-owner-id': { exactDashboardOwnerId },
    '@/lib/supabase-admin': { supabaseAdmin: db },
  })

  for (const owner of ['42', '-100123456789012', nearA, nearB, '900719925474099300', '9223372036854775807']) {
    sessionOwner = owner
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      calls.length = 0
      const req = new Request('https://app.askgogo.in/api/dashboard/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@fixture.invalid' }),
      })
      const result: Response = method === 'POST' ? await handlers.POST(req)
        : method === 'DELETE' ? await handlers.DELETE() : await handlers.GET()
      assert.equal(result.status, 200, path + ' ' + method + ' works for exact ' + owner)
      const ownerFilters = calls.filter(c => c.type === 'eq' && c.field === 'telegram_id')
      assert.ok(ownerFilters.length >= 1, path + ' ' + method + ' must filter by owner')
      assert.ok(ownerFilters.every(c => c.value === owner && typeof c.value === 'string'),
        path + ' ' + method + ' must query EXACT persisted decimal owner, never rounded numeric ID')
      assert.equal(calls.some(c => c.type === 'update'), method !== 'GET',
        path + ' ' + method + ' must preserve read/write semantics')
    }
  }

  for (const bad of [null, '0', '0123', '9223372036854775808', 9007199254740993, 'not-an-id']) {
    sessionOwner = bad
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      calls.length = 0
      const req = new Request('https://app.askgogo.in/api/dashboard/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@fixture.invalid' }),
      })
      const res: Response = method === 'POST' ? await handlers.POST(req)
        : method === 'DELETE' ? await handlers.DELETE() : await handlers.GET()
      assert.equal(res.status, bad === null ? 401 : 403, path + ' ' + method + ' denies untrusted identity: ' + String(bad))
      assert.equal(calls.length, 0, path + ' ' + method + ' must not read/mutate service DB on denial')
    }
  }
  console.log('PASS: ' + path + ' six inert handler paths reject rounded cross-account owner aliases')
}
console.log('PASS: dashboard email and daily briefing preference owner precision — no provider or DB actions')
