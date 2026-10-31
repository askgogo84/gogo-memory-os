// P2 conditional preview-only Gmail owner-precision regression.
// Executes the ACTUAL route under strict inert credential, DB and Gmail mocks.
// Never reaches a real database, mailbox, OAuth endpoint or provider.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('app/api/test-gmail/route.ts', 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const lookup: unknown[] = []
const writes: { owner: unknown; value: unknown }[] = []
const gmailReads: string[] = []
const decrypts: string[] = []
const refreshes: string[] = []
const rows = new Map<string, any>()
let forcedRow: any = undefined
const db = {
  from(table: string) {
    assert.equal(table, 'users', 'only users may be accessed')
    let owner: unknown
    let changed: unknown = undefined
    const builder: any = {
      select(_columns: string) { return builder },
      eq(column: string, value: unknown) {
        assert.equal(column, 'telegram_id', 'every read/write binds owner')
        owner = value
        return builder
      },
      async single() {
        lookup.push(owner)
        const user = forcedRow === undefined ? rows.get(String(owner)) : forcedRow
        return { data: user || null, error: user ? null : { message: 'not_found' } }
      },
      update(value: unknown) { changed = value; return builder },
      then(resolve: any, reject: any) {
        if (changed === undefined) throw new Error('unexpected unbounded query')
        writes.push({ owner, value: changed })
        return Promise.resolve({ error: null }).then(resolve, reject)
      },
    }
    return builder
  },
}
const mocks: Record<string, any> = {
  'next/server': {
    NextResponse: { json: (body: any, init?: { status?: number }) => ({ status: init?.status || 200, body }) },
  },
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/google-gmail': {
    fetchLatestEmails: async (token: string) => {
      gmailReads.push(token)
      if (token === 'expired-access') throw new Error('inert_expired')
      return [{ subject: 'Synthetic owned message' }]
    },
    refreshGmailAccessToken: async (token: string) => {
      refreshes.push(token)
      return 'renewed-access'
    },
  },
  '@/lib/security/cron-auth': { isInternalServiceAuthorized: (req: any) => req.authorized === true },
  '@/lib/security/google-token-crypto': {
    decryptGoogleToken: (token: string) => { decrypts.push(token); return token },
    encryptGoogleToken: (token: string) => 'encrypted:' + token,
  },
}
const env = { VERCEL_ENV: 'preview' }
const exportsObj: any = {}
runInNewContext(js, {
  exports: exportsObj,
  require: (name: string) => {
    if (!(name in mocks)) throw Error('unexpected route dependency: ' + name)
    return mocks[name]
  },
  process: { env }, URL, String, Number, BigInt, console,
}, { filename: 'app/api/test-gmail/route.ts', timeout: 3000 })
assert.equal(typeof exportsObj.GET, 'function')
const query = (owner: string | null, authorized = true) => exportsObj.GET({
  url: 'https://preview.example.test/api/test-gmail' + (owner === null ? '' : '?telegramId=' + encodeURIComponent(owner)),
  authorized,
})
function clear() {
  lookup.length = 0
  writes.length = 0
  gmailReads.length = 0
  decrypts.length = 0
  refreshes.length = 0
  forcedRow = undefined
}
function user(telegram_id: string | number, access = 'owned-access', refresh = '') {
  return { telegram_id, gmail_connected: true, gmail_access_token: access,
    gmail_refresh_token: refresh, gmail_email: 'synthetic@example.test' }
}
rows.set('42', user('42'))
rows.set('-42', user('-42'))
rows.set('9007199254740992', user('9007199254740992'))
// Production and missing internal bearer guard MUST precede privileged DB, crypto or mail.
clear()
env.VERCEL_ENV = 'production'
assert.equal((await query('42')).status, 404)
assert.equal(lookup.length + decrypts.length + gmailReads.length, 0)
env.VERCEL_ENV = 'preview'
assert.equal((await query('42', false)).status, 401)
assert.equal(lookup.length + decrypts.length + gmailReads.length, 0)
// Distinct signed64 owners are NOT interchangeable. Original Number(...) aliases 993 to 992.
clear()
const alien = await query('9007199254740993')
assert.equal(alien.status, 404, 'a neighboring signed64 owner with no row cannot read another mailbox')
assert.deepEqual(lookup, ['9007199254740993'], 'lookup keeps requested TEXT exactly')
assert.equal(decrypts.length + gmailReads.length + writes.length, 0, 'no private token decrypt/mail read/write')
// Text owners above JS safe range may still be used if returned as lossless DB decimal strings.
clear()
const exact = await query('9007199254740992')
assert.equal(exact.status, 200)
assert.deepEqual(lookup, ['9007199254740992'])
assert.deepEqual(gmailReads, ['owned-access'])
// Unsafe DB numeric decoding has already destroyed identity precision: reject even on an exact query.
clear()
forcedRow = user(9007199254740992)
assert.equal((await query('9007199254740992')).status, 404)
assert.equal(gmailReads.length + decrypts.length + writes.length, 0)
clear()
// Returned wrong owner must fail closed BEFORE decryption/provider even if query was exact.
forcedRow = user('43')
assert.equal((await query('42')).status, 404)
assert.deepEqual(lookup, ['42'])
assert.equal(decrypts.length + gmailReads.length + writes.length, 0)
// Reject malformed, noncanonical and out-of-range identities with NO privileged DB call.
for (const bad of ['0042', '0', '+42', '42.0', '4e1', '42junk', ' 42', '',
  '9223372036854775808', '-9223372036854775809']) {
  clear()
  assert.equal((await query(bad)).status, 400, 'invalid owner refused: ' + bad)
  assert.equal(lookup.length + decrypts.length + gmailReads.length + writes.length, 0)
}
clear()
assert.equal((await query(null)).status, 400)
assert.equal(lookup.length, 0)
// Existing safe positive/negative owner paths continue to read only their own mailbox.
for (const good of ['42', '-42']) {
  clear()
  const result = await query(good)
  assert.equal(result.status, 200)
  assert.equal(result.body.email_count, 1)
  assert.deepEqual(lookup, [good])
  assert.equal(writes.length, 0)
}
// Credential refresh remains constrained to EXACT verified owner and is inert.
clear()
rows.set('42', user('42', 'expired-access', 'owned-refresh'))
const refreshed = await query('42')
assert.equal(refreshed.status, 200)
assert.equal(refreshed.body.refreshed, true)
assert.deepEqual(refreshes, ['owned-refresh'])
assert.deepEqual(gmailReads, ['expired-access', 'renewed-access'])
assert.deepEqual(writes.map(w => w.owner), ['42'], 'refresh write is exact same owner TEXT')
assert.equal((writes[0].value as any).gmail_access_token, 'encrypted:renewed-access')
console.log('preview test-Gmail owner precision: inert actual-route isolation/auth/refresh cases passed')
