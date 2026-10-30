/**
 * TEST ONLY; synthetic owner/secret, real shipped authorization helper and route.
 * No network, provider, real database, user data, or production operation.
 *
 * Expected RED against 30 Oct 2026 main: the privileged internal guard accepts
 * CRON_SECRET from a URL query instead of requiring a Bearer header.
 * This is a transport-policy weakness, NOT a no-credential authentication bypass.
 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { isCronAuthorized, isInternalServiceAuthorized } from '../lib/security/cron-auth'

const SECRET = 'fixture-no-real-credential'
const OWNER = '+15550001111' // synthetic; no provider calls
const BASE = 'https://app.askgogo.in/api/todos'
const PROTECTED = BASE + '?secret=' + encodeURIComponent(SECRET)
process.env.CRON_SECRET = SECRET

type FakeRes = { status: number; body: any }
const response = {
  json: (body: unknown, init?: { status?: number }): FakeRes =>
    ({ status: init?.status ?? 200, body }),
}
const seen: string[] = []
const db = {
  from: (table: string) => {
    seen.push('from:' + table)
    return {
      insert: async (row: unknown) => {
        seen.push('insert:' + table)
        if (JSON.stringify(row).includes(OWNER)) seen.push('synthetic-owner')
        return { data: row, error: null }
      },
    }
  },
}

const source = readFileSync(new URL('../app/api/todos/route.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
} }).outputText
const exportsObj: { POST?: (request: unknown) => Promise<FakeRes> } = {}
runInNewContext(js, {
  exports: exportsObj,
  require: (name: string) => {
    if (name === 'next/server') return { NextResponse: response }
    if (name === '@supabase/supabase-js') return { createClient: () => db }
    if (name === '@/lib/security/cron-auth') return { isInternalServiceAuthorized }
    throw new Error('Unexpected dependency: ' + name)
  },
  process: { env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'placeholder-not-real',
    CRON_SECRET: SECRET,
  } },
  Date, URL, URLSearchParams, Buffer, JSON, console,
  fetch: () => { throw new Error('Network forbidden in test') },
})

if (!exportsObj.POST) throw new Error('Real shipped POST route not loaded')
const post = exportsObj.POST
function request(url: string, bearer?: string) {
  const header = bearer === undefined ? null : 'Bearer ' + bearer
  const req = new Request(url, {
    method: 'POST',
    headers: header ? { authorization: header } : {},
    body: JSON.stringify({ phone: OWNER, action: 'add', text: 'synthetic todo only' }),
  })
  return Object.assign(req, { json: async () => ({ phone: OWNER, action: 'add', text: 'synthetic todo only' }) })
}
let positivePass = 0, positiveFail = 0, safetyPass = 0, safetyFail = 0
function check(name: string, ok: boolean, kind: 'positive' | 'safety') {
  const passed = Boolean(ok)
  if (kind === 'positive') { if (passed) positivePass++; else positiveFail++ }
  else { if (passed) safetyPass++; else safetyFail++ }
  console[passed ? 'log' : 'error']((passed ? 'PASS' : 'FAIL') + ' ' + kind + ': ' + name)
}

check('legacy cron query credential remains accepted (compatibility only)',
  isCronAuthorized(request(PROTECTED), { CRON_SECRET: SECRET }), 'positive')
check('missing internal credential is rejected',
  !isInternalServiceAuthorized(request(BASE), { CRON_SECRET: SECRET }), 'positive')
check('real internal POST without credential returns 401 before any database access',
  await (async () => { seen.length = 0; const res = await post(request(BASE)); return res.status === 401 && seen.length === 0 })(),
  'positive')
check('Bearer credential may reach synthetic storage as intended',
  await (async () => { seen.length = 0; const res = await post(request(BASE, SECRET)); return res.status === 200 && seen.includes('insert:todos') })(),
  'positive')

// Safety negative assertions. They intentionally fail against the real shipped guard.
check('query-only secret MUST NOT authorize internal privileged route',
  !isInternalServiceAuthorized(request(PROTECTED), { CRON_SECRET: SECRET }), 'safety')
check('invalid Bearer must NOT be rescued by query-only secret',
  !isInternalServiceAuthorized(request(PROTECTED, 'wrong'), { CRON_SECRET: SECRET }), 'safety')
check('query-only secret POST must return 401 without touching owner data',
  await (async () => { seen.length = 0; const res = await post(request(PROTECTED)); return res.status === 401 && seen.length === 0 })(),
  'safety')
check('wrong Bearer + valid URL query must return 401 without storage',
  await (async () => { seen.length = 0; const res = await post(request(PROTECTED, 'wrong')); return res.status === 401 && seen.length === 0 })(),
  'safety')

console.log(`RESULT positive=${positivePass}/${positivePass + positiveFail}, required_safety=${safetyPass}/${safetyPass + safetyFail}`)
if (positiveFail || safetyFail) process.exitCode = 1
