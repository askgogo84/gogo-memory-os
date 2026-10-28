/** Inert execution-path regression for the REAL Dashboard learning-progress route.
 * All session, Supabase, lesson, HTTP and Next.js behavior is synthetic. No network/database/provider.
 * This bypasses getSession's normal upstream exactDashboardOwnerId guard to verify
 * defense-in-depth at this route's own service-role read/write boundary.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity.ts'

const source = readFileSync('app/api/dashboard/learning-progress/route.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

type Row = { table: string; column: string; value: unknown }
type Write = { table: string; data: Record<string, unknown> }
type Action = 'get' | 'start' | 'verify' | 'complete'

async function exercise(owner: string | number | null, action: Action) {
  const selectors: Row[] = []
  const upserts: Write[] = []
  const updates: Write[] = []
  const readTables: string[] = []
  const fakeDb = {
    from(table: string) {
      readTables.push(table)
      const query: any = {
        select(_columns: string) { return this },
        eq(column: string, value: unknown) { selectors.push({ table, column, value }); return this },
        gte(_column: string, _value: unknown) { return this },
        order(_column: string, _options?: unknown) { return this },
        limit(_count: number) {
          return Promise.resolve({ data: table === 'reminders' ? [{ id: 'synthetic-reminder' }] : [], error: null })
        },
        maybeSingle() {
          return Promise.resolve({
            data: table === 'learning_progress' && action === 'verify'
              ? { watched_at: '2026-10-28T12:00:00.000Z', completed: false } : null,
            error: null,
          })
        },
        upsert(data: Record<string, unknown>, _opts?: unknown) {
          upserts.push({ table, data })
          return Promise.resolve({ error: null })
        },
        update(data: Record<string, unknown>) { updates.push({ table, data }); return this },
        then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const fakeResponse = { json(body: unknown, options?: { status?: number }) {
    return { body, status: options?.status ?? 200 }
  } }
  const imports: Record<string, any> = {
    'next/server': { NextResponse: fakeResponse },
    '@/lib/dashboard/session': { getSession: async () => owner === null ? null : { telegramId: owner } },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
    '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
    '@/lib/dashboard/lessons': { GOGO_LESSONS: [
      { key: 'intro' }, { key: 'first-reminder' }, { key: 'recurring-reminders' },
    ] },
  }
  const mod: any = { exports: {} }
  runInNewContext(compiled, {
    module: mod, exports: mod.exports,
    require: (name: string) => {
      if (!(name in imports)) throw new Error('Unexpected import: ' + name)
      return imports[name]
    },
    Date, URL, Set,
  }, { filename: 'synthetic-learning-progress-route.cjs', timeout: 5000 })
  const req = {
    headers: { get: (name: string) => name.toLowerCase() === 'origin' ? 'https://app.askgogo.in' : null },
    nextUrl: { host: 'app.askgogo.in' },
    json: async () => ({
      lessonKey: action === 'verify' ? 'first-reminder' : 'intro',
      action: action === 'get' ? 'start' : action,
    }),
  }
  const res = action === 'get' ? await mod.exports.GET() : await mod.exports.POST(req)
  return { selectors, upserts, updates, readTables, status: res.status, body: res.body }
}

// These valid signed-64-bit decimal strings collide if the route uses JS Number.
assert.equal(Number('9007199254740992'), Number('9007199254740993'))
for (const owner of ['9007199254740992', '9007199254740993', '42', '-123', 42] as const) {
  for (const action of ['get', 'start', 'verify', 'complete'] as const) {
    const result = await exercise(owner, action)
    assert.equal(result.status, 200, action + ' should work for valid synthetic owner ' + owner)
    const ownerSelectors = result.selectors.filter(r => r.column === 'telegram_id')
    assert.ok(ownerSelectors.length, 'expected exact owner selector for ' + action)
    for (const row of ownerSelectors) {
      assert.equal(row.value, String(owner), action + ' must not round/parse owner at ' + row.table)
      assert.equal(typeof row.value, 'string', 'service-role selector requires decimal TEXT for exact bigint')
    }
    for (const row of result.upserts) {
      assert.equal(row.data.telegram_id, String(owner), action + ' writes must preserve exact decimal owner')
    }
    assert.ok(result.readTables.every(t => t === 'learning_progress' || t === 'reminders'))
  }
}

for (const owner of ['', '0', '42junk', '42.0', '9007199254740993abc',
  '9223372036854775808', '999999999999999999999999', 9007199254740992, 42.5]) {
  for (const action of ['get', 'start', 'verify', 'complete'] as const) {
    const result = await exercise(owner, action)
    assert.equal(result.status, 400, 'invalid synthetic session must fail closed for ' + action + ': ' + owner)
    assert.equal(result.readTables.length, 0, 'invalid owner MUST perform zero private reads or writes')
  }
}
for (const action of ['get', 'start', 'verify', 'complete'] as const) {
  const result = await exercise(null, action)
  assert.equal(result.status, 401)
  assert.equal(result.readTables.length, 0)
}
console.log('PASS LEARNING_PROGRESS_EXACT_OWNER: synthetic GET/POST/read/verify/write owner integrity')