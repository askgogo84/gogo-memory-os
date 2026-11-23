// Inert actual-function regression for signed-64-bit Gmail/consent owner binding.
// No provider requests, real Gmail tokens, messages, account edits, or production DB traffic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const file = readFileSync('lib/agent/open-loops.ts', 'utf8')
const start = file.indexOf('export async function gmailAccessForOwner(')
const end = file.indexOf('\nasync function readGmailAttention(', start)
assert.ok(start > 0 && end > start, 'source function must exist')
const actual = file.slice(start, end)
assert.doesNotMatch(actual, /String\(telegramId\?\?''\)\.trim\(/, 'noncanonical owners cannot be trimmed before authorization')
assert.doesNotMatch(actual, /(?:Number|parseInt)\(telegramId\)/, 'never round incoming Gmail owner')
const js = ts.transpileModule(actual, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

type Scenario = {
  owner: unknown
  userOwner?: unknown
  consentOwner?: unknown
  userExists?: boolean
  consentExists?: boolean
  consentEnabled?: boolean
  userError?: string
  consentError?: string
}
async function exercise(s: Scenario) {
  const reads: Array<{ table: string; key: unknown }> = []
  let decrypts = 0
  let providerCalls = 0
  const db = {
    from(table: string) {
      assert.ok(table === 'users' || table === 'user_consent_settings', 'only owner and consent tables')
      let key: unknown
      let projectAsText = false
      function returnedOwner(override: unknown) {
        if (override !== undefined) return override
        // PostgREST emits a quoted BIGINT only when the projection casts to text.
        const exact = String(s.owner)
        return JSON.parse(projectAsText ? JSON.stringify(exact) : exact)
      }
      return {
        select(cols: string) {
          assert.match(cols, /telegram_id/)
          projectAsText = cols.split(',').map(col => col.trim()).includes('telegram_id::text')
          return this
        },
        eq(column: string, value: unknown) {
          assert.equal(column, 'telegram_id')
          key = value
          reads.push({ table, key })
          return this
        },
        async maybeSingle() {
          if (table === 'users') return {
            data: s.userExists === false ? null : {
              telegram_id: returnedOwner(s.userOwner),
              gmail_connected: true,
              gmail_email: 'Owner@Example.Test',
              gmail_refresh_token: null,
              gmail_access_token: 'synthetic-local-access',
            },
            error: s.userError ? { message: s.userError } : null,
          }
          return {
            data: s.consentExists === false ? null : {
              telegram_id: returnedOwner(s.consentOwner),
              gmail_enabled: s.consentEnabled !== false,
            },
            error: s.consentError ? { message: s.consentError } : null,
          }
        },
      }
    },
  }
  const exported: Record<string, any> = {}
  runInNewContext(js, {
    exports: exported, module: { exports: exported },
    supabaseAdmin: db, BigInt, Number, String, Promise,
    decryptGoogleToken(input: unknown) {
      // The real implementation checks the optional refresh token first.
      if(input == null) return ''
      decrypts++
      assert.equal(input, 'synthetic-local-access')
      return String(input)
    },
    async refreshGmailAccessToken() {
      providerCalls++
      throw new Error('fixture forbids Gmail provider traffic')
    },
  }, { filename: 'actual-gmail-access-owner.fixture.js' })
  const lookup = exported.gmailAccessForOwner as (owner: unknown) => Promise<any>
  assert.equal(typeof lookup, 'function')
  let result: any, error: any
  try { result = await lookup(s.owner) } catch (e) { error = e }
  assert.equal(providerCalls, 0, 'no provider traffic permitted')
  return { result, error, reads, decrypts }
}

assert.equal(Number('9007199254740992'), Number('9007199254740993'), 'fixture reproduces JS rounding alias')
for (const owner of [
  '42', '-42', '9007199254740992', '9007199254740993',
  '-9007199254740993', '-9223372036854775808', '9223372036854775807',
]) {
  const x = await exercise({ owner })
  assert.equal(x.error, undefined, 'valid exact signed owner')
  assert.equal(x.result.accessToken, 'synthetic-local-access')
  assert.equal(x.result.ownEmail, 'owner@example.test')
  const key = Number.isSafeInteger(Number(owner)) ? Number(owner) : owner
  assert.deepEqual(x.reads, [
    { table: 'users', key }, { table: 'user_consent_settings', key },
  ], 'both privileged reads bind the same exact owner')
  assert.equal(x.decrypts, 1, 'only verified owner and consent yield local token')
}
for (const owner of [42, -42]) {
  const x = await exercise({ owner })
  assert.equal(x.result.accessToken, 'synthetic-local-access', 'safe numeric legacy owner works')
  assert.deepEqual(x.reads.map(r => r.key), [owner, owner])
}
for (const owner of [
  '', '0', '-0', '00', '-01', '+42', '0042', ' 42', '42 ', '\t42',
  '42tail', '42.0', '4e2', '9223372036854775808', '-9223372036854775809',
  '999999999999999999999999', 0, 2.5, Number.MAX_SAFE_INTEGER + 1,
  Number('9007199254740993'), NaN, Infinity, null, undefined, {},
]) {
  const x = await exercise({ owner })
  assert.match(String(x.error), /open_loop_gmail_owner_invalid/, 'invalid owner is rejected')
  assert.equal(x.reads.length, 0, 'invalid owner must have zero private reads')
  assert.equal(x.decrypts, 0, 'invalid owner must not reach tokens')
}
for (const owner of ['9007199254740993', '-9223372036854775808']) {
  const x = await exercise({ owner, userOwner: '9007199254740992' })
  assert.equal(x.result?.reason, 'disconnected', 'cross-owner user row cannot expose Gmail')
  assert.equal(x.decrypts, 0)
  const y = await exercise({ owner, consentOwner: '9007199254740992' })
  assert.equal(y.result?.reason, 'disabled', 'cross-owner consent cannot authorize Gmail')
  assert.equal(y.decrypts, 0)
}
{
  const owner = '9007199254740992'
  const userRounded = await exercise({ owner, userOwner: Number('9007199254740993') })
  assert.equal(userRounded.result?.reason, 'disconnected', 'imprecise DB number cannot impersonate exact owner')
  assert.equal(userRounded.decrypts, 0)
  const consentRounded = await exercise({ owner, consentOwner: Number('9007199254740993') })
  assert.equal(consentRounded.result?.reason, 'disabled', 'imprecise consent number is denied')
  assert.equal(consentRounded.decrypts, 0)
}
for (const opts of [
  { consentEnabled: false }, { consentExists: false },
  { consentOwner: null }, { userOwner: null }, { userExists: false },
]) {
  const x = await exercise({ owner: '42', ...opts })
  assert.equal(x.decrypts, 0, 'no Gmail token unless exact owner and positive consent')
}
for (const opts of [{ userError: 'synthetic error' }, { consentError: 'synthetic error' }]) {
  const x = await exercise({ owner: '-42', ...opts })
  assert.ok(x.error, 'database errors do not grant Gmail access')
  assert.equal(x.decrypts, 0)
}
console.log('PASS actual Gmail access owner: exact signed-64-bit DB keys, row binding, fail-closed malformed/rounded identities and affirmative consent')