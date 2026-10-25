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
  // Each actual from('users') read/update is a distinct query. An UPDATE that
  // accidentally omits .eq('telegram_id', owner) mutates BOTH synthetic rows
  // and must fail this test, even when an earlier SELECT was owner-filtered.
  type Row = {
    telegram_id: string; email: string; email_captured_at: string
    email_opt_out: boolean; daily_brief_email_enabled: boolean
    briefing_time: string; onboarding_stage?: string
  }
  type Query = {
    table: string; operation: 'unknown' | 'select' | 'update'
    filters: Array<{ field: string, value: unknown }>; payload?: Partial<Row>
  }
  const queries: Query[] = []
  let rows: Row[] = []
  const db = {
    from(table: string) {
      assert.equal(table, 'users')
      const operation: Query = { table, operation: 'unknown', filters: [] }
      queries.push(operation)
      const matching = () => rows.filter(row =>
        operation.filters.every(f => row[f.field as keyof Row] === f.value))
      const q: any = {
        select(_columns: string) { operation.operation = 'select'; return q },
        update(payload: Partial<Row>) {
          operation.operation = 'update'
          operation.payload = payload
          return q
        },
        eq(field: string, value: unknown) {
          operation.filters.push({ field, value })
          return q
        },
        async maybeSingle() {
          const matches = matching()
          assert.ok(matches.length <= 1, 'a supposedly single owner read must not span multiple rows')
          return { data: matches[0] ? { ...matches[0] } : null, error: null }
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
          assert.equal(operation.operation, 'update', 'a thenable query must be an update')
          for (const row of matching()) Object.assign(row, operation.payload)
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
      queries.length = 0
      const other = owner === nearA ? nearB : nearA
      rows = [
        {
          telegram_id: owner, email: 'original@fixture.invalid',
          email_captured_at: '2026-01-01T00:00:00.000Z',
          email_opt_out: method === 'POST',
          daily_brief_email_enabled: method === 'DELETE',
          briefing_time: '08:00',
        },
        {
          telegram_id: other, email: 'other@fixture.invalid',
          email_captured_at: '2026-01-01T00:00:00.000Z',
          email_opt_out: method === 'POST',
          daily_brief_email_enabled: method === 'DELETE',
          briefing_time: '09:00',
        },
      ]
      const otherBefore = JSON.stringify(rows[1])
      const req = new Request('https://app.askgogo.in/api/dashboard/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@fixture.invalid' }),
      })
      const response: Response = method === 'POST' ? await handlers.POST(req)
        : method === 'DELETE' ? await handlers.DELETE() : await handlers.GET()
      assert.equal(response.status, 200, path + ' ' + method + ' works for exact ' + owner)
      assert.equal(queries.length, method === 'POST' && path.includes('/email-preferences/') ? 2 : 1,
        path + ' ' + method + ' must issue the expected distinct DB calls')
      for (const query of queries) {
        assert.equal(query.table, 'users')
        assert.equal(query.operation, method === 'GET' ? 'select'
          : method === 'DELETE' ? 'update'
          : query === queries[0] && queries.length === 2 ? 'select' : 'update',
        'each read and update must preserve its own operation')
        const ownerFilters = query.filters.filter(f => f.field === 'telegram_id')
        assert.equal(ownerFilters.length, 1,
          path + ' ' + method + ' EACH independent read/update requires exactly one owner predicate')
        assert.strictEqual(ownerFilters[0].value, owner,
          path + ' ' + method + ' must use the same exact owner string for EACH query')
        assert.equal(typeof ownerFilters[0].value, 'string', 'never round to a JS number')
      }
      if (method !== 'GET') {
        assert.equal(JSON.stringify(rows[1]), otherBefore,
          path + ' ' + method + ' must NEVER mutate second synthetic tenant')
        assert.equal(rows[0].email, method === 'POST' ? 'owner@fixture.invalid' : 'original@fixture.invalid')
        if (path.includes('/email-preferences/')) {
          assert.equal(rows[0].email_opt_out, method === 'DELETE', 'email opt-in/out must target only current owner')
        } else {
          assert.equal(rows[0].daily_brief_email_enabled, method === 'POST',
            'briefing opt-in/out must target only current owner')
        }
      } else {
        assert.equal(rows[0].email, 'original@fixture.invalid')
        assert.equal(JSON.stringify(rows[1]), otherBefore)
      }
    }
  }

  for (const bad of [null, '0', '0123', '9223372036854775808', 9007199254740993, 'not-an-id']) {
    sessionOwner = bad
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      queries.length = 0
      rows = []
      const req = new Request('https://app.askgogo.in/api/dashboard/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@fixture.invalid' }),
      })
      const res: Response = method === 'POST' ? await handlers.POST(req)
        : method === 'DELETE' ? await handlers.DELETE() : await handlers.GET()
      assert.equal(res.status, bad === null ? 401 : 403,
        path + ' ' + method + ' denies untrusted identity: ' + String(bad))
      assert.equal(queries.length, 0, path + ' ' + method + ' must not read/mutate service DB on denial')
    }
  }
  console.log('PASS: ' + path + ' six inert handler paths reject rounded cross-account owner aliases')
}
console.log('PASS: dashboard email and daily briefing preference owner precision — no provider or DB actions')
