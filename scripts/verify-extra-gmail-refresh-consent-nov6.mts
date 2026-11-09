// Inert original-module test: a secondary Gmail token refresh must not resurrect
// a disconnected account or continue a Google request after revocation wins the race.
// No actual provider, database, credentials or user emails are accessed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const owner = '-4500000001'
const row = { id: 'account-1', telegram_id: owner, disconnected_at: null as string | null, access_token: 'sealed:expired' }
let writes = 0
let databaseFailure = false
const db = {
  from(table: string) {
    const eqs: Record<string, string> = {}
    const is: Record<string, any> = {}
    let update: any = null
    const query: any = {
      update(value: any) { update = value; return query },
      eq(k: string, v: any) { eqs[k] = String(v); return query },
      is(k: string, v: any) { is[k] = v; return query },
      select(field: string) {
        if (table === 'user_consent_settings') return query
        assert.equal(table, 'gmail_accounts')
        assert.equal(field, 'id')
        if (databaseFailure) return Promise.resolve({ data: null, error: { message: 'fixture read-only failure' } })
        const matches = update && eqs.id === row.id && eqs.telegram_id === row.telegram_id
          && ('disconnected_at' in is) && is.disconnected_at === null && row.disconnected_at === null
        if (matches) { writes++; row.access_token = update.access_token }
        return Promise.resolve({ data: matches ? [{ id: row.id }] : [], error: null })
      },
      async maybeSingle() {
        assert.equal(table, 'user_consent_settings')
        assert.equal(eqs.telegram_id, owner)
        return { data: { gmail_enabled: true }, error: null }
      },
    }
    return query
  },
}
const crypto = { encryptGoogleToken: (v: string) => 'sealed:' + v, decryptGoogleToken: (v: string) => v }
function compile(path: string, tail = '', imports: Record<string, any> = {}, extras: Record<string, any> = {}) {
  const source = readFileSync(path, 'utf8') + tail
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const exported: Record<string, any> = {}
  runInNewContext(js, {
    exports: exported, module: { exports: exported },
    require(name: string) {
      if (name in imports) return imports[name]
      throw new Error('Unexpected module in inert fixture: ' + name)
    },
    console, process, Date, Number, String, Promise, Set, Map, Buffer,
    URL, URLSearchParams, Response, AbortSignal, ...extras,
  })
  return exported
}
const accounts = compile('lib/agent/gmail-accounts.ts', '', {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/security/google-token-crypto': crypto,
})

// 1. An active account belonging to this exact signed owner permits one sealed write.
await accounts.saveExtraAccessToken(owner, row.id, 'fresh-1')
assert.equal(writes, 1)
assert.equal(row.access_token, 'sealed:fresh-1')
console.log('PASS active exact-owner mailbox refresh persists encrypted token')

// 2. A different owner, an unsafe numeric owner and malformed identity cannot write.
for (const wrong of ['-4500000002', '-04500000001', 9007199254740993, '0', '']) {
  await assert.rejects(() => accounts.saveExtraAccessToken(wrong, row.id, 'forbidden'))
}
assert.equal(writes, 1)
assert.equal(row.access_token, 'sealed:fresh-1')
console.log('PASS wrong/ambiguous owner identities are rejected')

// 3. A revocation that already committed must never be undone by stale refresh.
row.disconnected_at = '2026-11-06T00:00:00Z'
row.access_token = null as any
await assert.rejects(() => accounts.saveExtraAccessToken(owner, row.id, 'should-not-survive'), /gmail_account_disconnected_or_owner_mismatch/)
assert.equal(row.access_token, null)
assert.equal(writes, 1)
console.log('PASS disconnected account token cannot be restored')

// 4. Unknown result and DB failure fail closed rather than silently accepting.
row.disconnected_at = null
databaseFailure = true
await assert.rejects(() => accounts.saveExtraAccessToken(owner, row.id, 'failed'), /gmail_account_token_persist_failed/)
databaseFailure = false
assert.equal(writes, 1)
console.log('PASS refresh persistence errors are not success')

// 5. Exercise ORIGINAL workspaceFetch and ORIGINAL refresh together with only
// synthetic responses. The disconnect happens during the refresh provider call,
// before its account-token save. A second Google GET would violate revocation.
let fetchCount = 0
let disconnectDuringRefresh = false
const workspace = compile(
  'lib/agent/google-workspace-read.ts',
  '\nexports.__testWorkspaceFetch = workspaceFetch;\n',
  {
    '@/lib/security/email-redaction': { decodeHtmlEntities: (x: any) => x, formatEmailSnippet: (x: any) => x, redactEmailAuthSecrets: (x: any) => x },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/services/pdf-js-serverless': { extractServerlessPdfText: () => '' },
    '@/lib/google-gmail': { refreshGmailAccessToken: async () => {
      if (disconnectDuringRefresh) { row.disconnected_at = '2026-11-06T00:00:00Z'; row.access_token = null as any }
      return 'fresh-from-provider-fixture'
    } },
    '@/lib/bot/memory-redaction': { redactSecretShapedText: (x: any) => x },
    '@/lib/security/google-token-crypto': { ...crypto, hasGoogleTokenEncryptionKey: () => true, isEncryptedGoogleToken: () => true },
    './gmail-accounts': accounts,
  },
  { fetch: async (_url: string, init: any) => {
    fetchCount++
    assert.match(String(init?.headers?.Authorization || ''), /^Bearer /)
    return { status: fetchCount === 1 ? 401 : 200, ok: fetchCount !== 1 }
  } },
)
const actor = { legacyTelegramId: Number(owner) }
const extra = { id: row.id, email: 'second@example.test', accessToken: 'expired', refreshToken: 'fixture-refresh' }
row.disconnected_at = null
row.access_token = 'sealed:expired'
fetchCount = 0
disconnectDuringRefresh = true
await assert.rejects(() => workspace.__testWorkspaceFetch(actor,
  'https://gmail.googleapis.com/gmail/v1/users/me/messages', {}, extra), /gmail_account_disconnected_or_owner_mismatch/)
assert.equal(fetchCount, 1, 'must not issue a second Google request after revocation')
assert.equal(row.access_token, null)
console.log('PASS original workspace fetch aborts renewed provider request after committed revocation')

// 6. With owner consent and active record, the original 401 refresh path still works.
row.disconnected_at = null
row.access_token = 'sealed:expired'
fetchCount = 0
disconnectDuringRefresh = false
const response = await workspace.__testWorkspaceFetch(actor,
  'https://gmail.googleapis.com/gmail/v1/users/me/messages', {}, extra)
assert.equal(response.status, 200)
assert.equal(fetchCount, 2)
assert.equal(row.access_token, 'sealed:fresh-from-provider-fixture')
console.log('PASS connected exact owner still refreshes normally using inert provider fixture')
console.log('Extra Gmail refresh/consent regression passed')
