// P1 signed unsubscribe owner-isolation regression. Inert actual-route execution: no DB/network/recipients.
// Registered via verify-pulse-email-noise.mts; can also run directly with npx tsx.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactUnsubscribeOwnerId } from '../lib/email/unsubscribe-owner'

process.env.EMAIL_UNSUBSCRIBE_SECRET = 'fixture-secret-only-do-not-use-in-production'
const lifecycle = await import('../lib/email/unsubscribe')
const daily = await import('../lib/email/daily-brief-unsubscribe')
const email = 'fixture-owner@example.invalid'
const bigA = '9007199254740992'
const bigB = '9007199254740993'
assert.equal(Number(bigA), Number(bigB), 'test models genuine JS BIGINT precision aliasing')

for (const id of ['42', '-42', bigA, bigB, '9223372036854775807', '-9223372036854775808']) {
  assert.equal(exactUnsubscribeOwnerId(id), id, 'canonical signed bigint remains lossless: ' + id)
}
for (const id of ['', '0', '-0', '+1', '01', '-01', '1e3', '1.0', '1_000', ' 42', '42 ', '9223372036854775808', '-9223372036854775809', '99999999999999999999999999']) {
  assert.equal(exactUnsubscribeOwnerId(id), null, 'malformed or out-of-range owner denied: ' + id)
}
assert.equal(exactUnsubscribeOwnerId(Number(bigB)), null, 'unsafe numeric input cannot inherit another owner')
assert.equal(exactUnsubscribeOwnerId(null), null)

type OwnerRow = { telegram_id: string; email: string; email_opt_out: boolean; daily_brief_email_enabled: boolean }
type Write = { patch: Record<string, unknown>; filters: Array<[string, unknown]>; ownerIds: string[] }
type Handler = { GET(req: { url: string }): Promise<{ status: number }> }
function loadRoute(path: string, tokenTools: Record<string, unknown>) {
  const owners: OwnerRow[] = [bigA, bigB, '42', '-42', '9223372036854775807', '-9223372036854775808'].map(id => ({
    telegram_id: id, email, email_opt_out: false, daily_brief_email_enabled: true,
  }))
  const writes: Write[] = []
  const db = {
    from(table: string) {
      assert.equal(table, 'users')
      return {
        update(patch: Record<string, unknown>) {
          const filters: Array<[string, unknown]> = []
          const q = {
            eq(name: string, value: unknown) { filters.push([name, value]); return q },
            then(resolve: (x: { error: null }) => unknown, reject?: (error: unknown) => unknown) {
              const affected = owners.filter(row => filters.every(([k, v]) => String((row as unknown as Record<string, unknown>)[k]) === String(v)))
              for (const row of affected) Object.assign(row, patch)
              writes.push({ patch, filters: [...filters], ownerIds: affected.map(x => x.telegram_id) })
              return Promise.resolve({ error: null }).then(resolve, reject)
            },
          }
          return q
        },
      }
    },
  }
  class HtmlResponse { status: number; constructor(_body: string, opts?: {status?: number}) { this.status = opts?.status ?? 200 } }
  const exp: Record<string, unknown> = {}
  const modules: Record<string, unknown> = {
    'next/server': { NextResponse: HtmlResponse },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/email/unsubscribe': lifecycle,
    '@/lib/email/daily-brief-unsubscribe': daily,
    '@/lib/email/unsubscribe-owner': { exactUnsubscribeOwnerId },
    ...tokenTools,
  }
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(js, {
    exports: exp, require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error('unmocked route dependency: ' + name)
      return modules[name]
    },
    URL, process, console, Buffer,
  }, { filename: path })
  assert.equal(typeof exp.GET, 'function')
  return { GET: (exp as Handler).GET, owners, writes }
}

const cases = [
  { path: 'app/api/email/unsubscribe/route.ts', build: lifecycle.buildUnsubscribeUrl, key: 'email_opt_out', result: true },
  { path: 'app/api/email/daily-brief/unsubscribe/route.ts', build: daily.buildDailyBriefUnsubscribeUrl, key: 'daily_brief_email_enabled', result: false },
] as const

for (const c of cases) {
  const h = loadRoute(c.path, {})
  const status = async (id: string, e = email) => (await h.GET({ url: c.build(id, e) })).status
  const isAffected = (id: string) => h.owners.find(x => x.telegram_id === id)![c.key]
  const before = isAffected(bigA)
  assert.equal(await status(bigB), 200, c.path + ': valid signed BIGINT owner accepted')
  assert.equal(h.writes.length, 1, c.path + ': one owner-bound preference write')
  assert.deepEqual(h.writes[0].ownerIds, [bigB], c.path + ': aliased neighbor never changes')
  assert.equal(isAffected(bigA), before, c.path + ': adjacent 64-bit owner unchanged')
  assert.equal(isAffected(bigB), c.result, c.path + ': signed owner preference updated')
  assert.deepEqual(h.writes[0].filters, [['telegram_id', bigB], ['email', email]], c.path + ': exact unrounded string owner and email filter')
  assert.equal(typeof h.writes[0].filters[0][1], 'string', c.path + ': PostgREST predicate never receives JS rounded number')

  for (const id of ['42', '-42', bigA, '9223372036854775807', '-9223372036854775808']) {
    assert.equal(await status(id), 200, c.path + ': valid canonical legacy/signed64 link: ' + id)
    assert.deepEqual(h.writes.at(-1)?.ownerIds, [id], c.path + ': exact owner positive control')
  }
  const beforeInvalid = h.writes.length
  for (const id of ['0', '-0', '00123', '+42', '1e3', '9223372036854775808', '-9223372036854775809']) {
    assert.equal(await status(id), 400, c.path + ': valid-HMAC but invalid owner denied: ' + id)
  }
  assert.equal(h.writes.length, beforeInvalid, c.path + ': malformed owners cause ZERO SQL writes')

  const tampered = new URL(c.build(bigB, email))
  tampered.searchParams.set('e', 'stranger@example.invalid')
  assert.equal((await h.GET({ url: tampered.toString() })).status, 400, c.path + ': unsigned email change denied')
  const corrupt = new URL(c.build(bigB, email))
  corrupt.searchParams.set('s', 'invalid-signature')
  assert.equal((await h.GET({ url: corrupt.toString() })).status, 400, c.path + ': invalid signature denied')
  assert.equal(h.writes.length, beforeInvalid, c.path + ': tampered tokens cause ZERO SQL writes')
  const source = readFileSync(c.path, 'utf8')
  assert.doesNotMatch(source, /Number\(telegramId\)/, c.path + ': no precision-losing owner predicate')
  assert.match(source, /exactUnsubscribeOwnerId\(telegramId\)/, c.path + ': canonical owner validation mandatory')
}
console.log('PASS exact signed64 email unsubscribe: two real route handlers, HMAC, 64-bit neighbors, malformed/tampered zero-write')
