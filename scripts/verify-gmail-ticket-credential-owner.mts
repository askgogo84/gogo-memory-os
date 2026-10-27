// Synthetic real-module owner-boundary regression. No Gmail, DB, provider or network access.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Actor = { userId: string; legacyTelegramId: number; whatsappId: string; name: string }
type FixtureRow = Record<string, unknown> | null

function fixture(row: FixtureRow) {
  const queries: Array<[string, unknown]> = []
  let decrypts = 0
  let gmailRequests = 0
  let refreshes = 0
  let updates = 0
  const query = {
    select(_fields: string) { return this },
    eq(key: string, value: unknown) { queries.push([key, value]); return this },
    maybeSingle: async () => ({ data: row, error: null }),
    update(_values: unknown) { updates++; return this },
  }
  const db = { from(table: string) {
    assert.equal(table, 'users', 'test may only query inert users fixture')
    return query
  } }
  const exported: Record<string, any> = {}
  const source = readFileSync('lib/agent/gmail-ticket-credential.ts', 'utf8')
  const transpiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  runInNewContext(transpiled, {
    exports: exported, Buffer, URLSearchParams, process: { env: {} }, console,
    require(id: string) {
      if (id === '@anthropic-ai/sdk') return class FakeAnthropic {}
      if (id === '@/lib/supabase-admin') return { supabaseAdmin: db }
      if (id === '@/lib/google-gmail') return { refreshGmailAccessToken: async () => { refreshes++; return null } }
      if (id === '@/lib/security/google-token-crypto') return {
        decryptGoogleToken: (value: unknown) => { decrypts++; return String(value || '') },
        encryptGoogleToken: (value: unknown) => String(value || ''),
      }
      throw new Error('Unexpected module in inert Gmail fixture: ' + id)
    },
    fetch: async (url: string, opts: { headers?: Record<string, string> }) => {
      gmailRequests++
      assert.ok(String(url).startsWith('https://gmail.googleapis.com/gmail/v1/'), 'trusted Gmail endpoint only')
      assert.equal(opts?.headers?.Authorization, 'Bearer connected-token')
      return { ok: true, status: 200, json: async () => ({ messages: [] }) }
    },
  })
  return {
    run: async (actor: Actor) => {
      try { await exported.findGmailTicketEvidence(actor, 'ticket confirmation') }
      catch { /* A fail-closed rejection is acceptable; side effects are not. */ }
    },
    get queries() { return queries },
    get decrypts() { return decrypts },
    get gmailRequests() { return gmailRequests },
    get refreshes() { return refreshes },
    get updates() { return updates },
  }
}

const actor: Actor = { userId: 'owner-b', legacyTelegramId: 123, whatsappId: 'whatsapp:+15550000002', name: 'Fixture B' }
const foreign = { id: 'owner-a', telegram_id: '123', gmail_connected: true,
  gmail_access_token: 'connected-token', gmail_refresh_token: '' }
const wrongUuid = fixture(foreign)
await wrongUuid.run(actor)
assert.equal(wrongUuid.decrypts, 0, 'foreign UUID must not decrypt Gmail tokens')
assert.equal(wrongUuid.gmailRequests, 0, 'foreign UUID must never reach Gmail')
assert.equal(wrongUuid.refreshes, 0, 'foreign UUID must never refresh credentials')

const wrongTelegram = fixture({ ...foreign, id: 'owner-b', telegram_id: '124' })
await wrongTelegram.run(actor)
assert.equal(wrongTelegram.decrypts, 0, 'wrong persisted telegram owner must not decrypt tokens')
assert.equal(wrongTelegram.gmailRequests, 0, 'wrong persisted telegram owner must never reach Gmail')

for (const badOwner of [0, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
  const unsafe = fixture({ ...foreign, id: 'owner-b' })
  await unsafe.run({ ...actor, legacyTelegramId: badOwner })
  assert.equal(unsafe.queries.length, 0, 'invalid numeric owner must be refused before users lookup: ' + badOwner)
  assert.equal(unsafe.decrypts, 0)
  assert.equal(unsafe.gmailRequests, 0)
}
for (const malformed of ['', ' ', '0']) {
  const missingUuid = fixture({ ...foreign, id: 'owner-b' })
  await missingUuid.run({ ...actor, userId: malformed })
  assert.equal(missingUuid.queries.length, 0, 'invalid account UUID must be refused before private query')
  assert.equal(missingUuid.decrypts, 0)
}

const valid = fixture({ ...foreign, id: 'owner-b' })
await valid.run(actor)
assert.ok(valid.queries.some(([key, value]) => key === 'id' && value === 'owner-b'),
  'positive lookup must bind exact opaque account UUID')
assert.ok(valid.queries.some(([key, value]) => key === 'telegram_id' && String(value) === '123'),
  'positive lookup must bind exact owner decimal')
assert.ok(valid.decrypts > 0, 'correct owner retains normal Gmail credential selection')
assert.ok(valid.gmailRequests > 0, 'correct owner retains Gmail ticket search')
assert.equal(valid.updates, 0, 'no provider refresh or token update in fixture')
console.log('✅ Gmail ticket credential private owner boundary passed (actual module; inert synthetic two-owner fixtures)')
