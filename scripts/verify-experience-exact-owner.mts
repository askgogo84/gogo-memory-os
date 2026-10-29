/** P2 synthetic defense-in-depth regression: REAL experience GET/POST route.
 * Tests fake session, Supabase, HTTP and response only; no provider, user or DB access.
 * Production getSession already rejects unsafe/invalid owners upstream: this fixture
 * deliberately bypasses that guard to exercise the route's privileged boundary.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity.ts'

const source = readFileSync('app/api/dashboard/experience/route.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

type Selector = { table: string; column: string; value: unknown }
type Mutation = { table: string; payload: Record<string, unknown>; conflict: unknown }
type Mode = 'get' | 'post'
type ErrMode = 'none' | 'read' | 'save'

async function exercise(owner: string | number | null, mode: Mode, opts: {
  origin?: string; personality?: string; comfortDrink?: string; error?: ErrMode
} = {}) {
  const selectors: Selector[] = []
  const upserts: Mutation[] = []
  const tableCalls: string[] = []
  const fakeDb = {
    from(table: string) {
      tableCalls.push(table)
      const q: any = {
        select(_columns: string) { return this },
        eq(column: string, value: unknown) { selectors.push({ table, column, value }); return this },
        maybeSingle() {
          return Promise.resolve({
            data: { personality: 'sharp_professional', comfort_drink: 'tea' },
            error: opts.error === 'read' ? { code: 'synthetic_error' } : null,
          })
        },
        upsert(payload: Record<string, unknown>, conflict: unknown) {
          upserts.push({ table, payload, conflict })
          return Promise.resolve({ error: opts.error === 'save' ? { code: 'synthetic_error' } : null })
        },
      }
      return q
    },
  }
  const imports: Record<string, any> = {
    'next/server': { NextResponse: { json(payload: unknown, init?: { status?: number }) {
      return { status: init?.status ?? 200, body: payload }
    } } },
    '@/lib/dashboard/session': { getSession: async () => owner === null ? null : { telegramId: owner } },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
    '@/lib/supabase-admin': { supabaseAdmin: fakeDb },
  }
  const mod: any = { exports: {} }
  runInNewContext(compiled, {
    module: mod, exports: mod.exports,
    require(name: string) {
      if (!(name in imports)) throw new Error('Unexpected module import: ' + name)
      return imports[name]
    },
    Date, URL, Set,
  }, { filename: 'synthetic-experience-route.cjs', timeout: 5000 })
  const req = {
    headers: { get: (name: string) => name.toLowerCase() === 'origin' ? opts.origin ?? 'https://app.askgogo.in' : null },
    nextUrl: { host: 'app.askgogo.in' },
    json: async () => ({ personality: opts.personality ?? 'sharp_professional', comfortDrink: opts.comfortDrink ?? 'tea' }),
  }
  const result = mode === 'get' ? await mod.exports.GET() : await mod.exports.POST(req)
  return { result, selectors, upserts, tableCalls }
}

assert.equal(Number('9007199254740992'), Number('9007199254740993'), 'source hazard is unsafe JS rounding')
let validChecks = 0
for (const owner of ['9007199254740992', '9007199254740993', '42', '-123', 42] as const) {
  for (const mode of ['get', 'post'] as const) {
    const { result, selectors, upserts, tableCalls } = await exercise(owner, mode)
    assert.equal(result.status, 200, mode + ': valid signed-64 owner expected success')
    assert.deepEqual(tableCalls, ['user_experience_preferences'], 'only the owned preference table may be touched')
    if (mode === 'get') {
      assert.equal(selectors.length, 1, 'read must bind exactly one owner selector')
      assert.equal(upserts.length, 0, 'read must never write')
    } else {
      assert.equal(upserts.length, 1, 'write must only upsert one owner-bound preference row')
      assert.equal(selectors.length, 0)
      assert.equal(upserts[0].payload.telegram_id, String(owner), 'upsert owner must remain exact decimal TEXT')
      assert.equal(upserts[0].payload.personality, 'sharp_professional')
      assert.equal(upserts[0].payload.comfort_drink, 'tea')
      assert.equal(typeof upserts[0].payload.updated_at, 'string')
      assert.equal((upserts[0].conflict as { onConflict: string }).onConflict, 'telegram_id')
    }
    for (const s of selectors) {
      assert.equal(s.table, 'user_experience_preferences')
      assert.equal(s.column, 'telegram_id')
      assert.equal(s.value, String(owner), 'read must preserve exact decimal TEXT')
      assert.equal(typeof s.value, 'string')
    }
    validChecks++
  }
}
let rejectedChecks = 0
for (const owner of ['', '0', '00042', '42junk', '42.0', '9007199254740993x',
  '9223372036854775808', '9999999999999999999999999', 9007199254740992, 42.5]) {
  for (const mode of ['get', 'post'] as const) {
    const { result, tableCalls, selectors, upserts } = await exercise(owner, mode)
    assert.equal(result.status, 400, 'invalid/unsafe synthetic owner must fail with 400')
    assert.equal(tableCalls.length, 0, 'invalid/unsafe owner must perform ZERO DB accesses')
    assert.equal(selectors.length + upserts.length, 0)
    rejectedChecks++
  }
}
for (const mode of ['get', 'post'] as const) {
  const { result, tableCalls } = await exercise(null, mode)
  assert.equal(result.status, 401, 'missing synthetic session must be unauthorized')
  assert.equal(tableCalls.length, 0)
}
const crossOrigin = await exercise('42', 'post', { origin: 'https://evil.example' })
assert.equal(crossOrigin.result.status, 403, 'CSRF origin boundary must remain enforced')
assert.equal(crossOrigin.tableCalls.length, 0)
const invalidPref = await exercise('42', 'post', { personality: 'not-allowed' })
assert.equal(invalidPref.result.status, 400)
assert.equal(invalidPref.tableCalls.length, 0)
const badRead = await exercise('42', 'get', { error: 'read' })
assert.equal(badRead.result.status, 500)
const badWrite = await exercise('42', 'post', { error: 'save' })
assert.equal(badWrite.result.status, 500)

console.log('PASS EXPERIENCE_EXACT_OWNER: GET/POST decimal-string owner, rejected invalid sessions, origin, validation, errors (' + validChecks + ' valid, ' + rejectedChecks + ' invalid)')
