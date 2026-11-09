// Security regression: execute the original trial route with inert services only.
// No network, Supabase, real credentials, accounts, payments or provider operations.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('app/api/payment/trial/route.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

let checks = 0
for (const environment of ['production', 'preview', 'development', '', undefined]) {
  let dbCalls = 0
  let providerCalls = 0
  let requestBodyReads = 0
  const out: Record<string, unknown> = {}
  const mocks: Record<string, unknown> = {
    'next/server': {
      NextResponse: { json: (body: any, init?: {status?: number}) => ({ body, status: init?.status || 200 }) },
    },
    '@/lib/supabase-admin': {
      supabaseAdmin: {
        from: () => { dbCalls++; throw new Error('Forbidden: a real trial grant DB call') },
      },
    },
  }
  const requireStub = (name: string) => {
    if (!(name in mocks)) { providerCalls++; throw new Error('Forbidden imported dependency: ' + name) }
    return mocks[name]
  }
  runInNewContext(compiled, {
    exports: out, require: requireStub, process: { env: { VERCEL_ENV: environment } },
  }, { timeout: 2000 })
  const post = out.POST as (request: unknown) => Promise<any>
  assert.equal(typeof post, 'function', 'must execute the actual exported POST handler')
  for (const claimedOwner of [
    { telegramId: '9007199254740993' },
    { whatsappId: 'whatsapp:+14155552671' },
    { telegramId: '-123456789', whatsappId: '+919876543210' },
  ]) {
    const result = await post({
      json: async () => { requestBodyReads++; return claimedOwner },
    })
    assert.equal(result.status, 404, 'all environments deny the legacy grant')
    assert.equal(result.body?.ok, false, 'never claim an entitlement was granted')
    assert.equal(result.body?.error, 'not_found')
    checks++
  }
  assert.equal(dbCalls, 0, 'no account reads or entitlement writes')
  assert.equal(providerCalls, 0, 'no unverified external/provider work')
  assert.equal(requestBodyReads, 0, 'untrusted owner input is never parsed')
  checks += 3
}

// Static contract prevents reintroducing an environment-sensitive service-role route.
assert.doesNotMatch(source, /\b(?:supabaseAdmin|createClient|tier_expires_at|trial_started_at|VERCEL_ENV|NODE_ENV)\b/)
assert.match(source, /export async function POST\s*\(/)
assert.match(source, /status:\s*404\b/)
checks += 3
console.log('Legacy trial grant retired: ' + checks + ' inert original-handler checks passed')
