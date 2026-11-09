// Synthetic original-route regression: execute the shipped OAuth GET with fake Google,
// Supabase, and NextResponse. No network, database, credentials, user data, or real OAuth.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const original = readFileSync('app/api/gmail/callback/route.ts', 'utf8')
const compiled = ts.transpileModule(original, {
  fileName: 'app/api/gmail/callback/route.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

async function callGet({ outcome = 'saved', state = 'on', saveError = false, consentError = null, stateError = false, sendUpgrade = false } = {}) {
  let consentSaveCalls = 0
  let consentReadCalls = 0
  let tokenSaves = 0
  const logs = []

  class FakeResponse {
    constructor(body, options = {}) {
      this.body = body
      this.status = options.status || 200
      this.headers = options.headers || {}
    }
    static json(object, options = {}) {
      return new FakeResponse(JSON.stringify(object), options)
    }
  }

  const mods = {
    'next/server': { NextResponse: FakeResponse },
    '@/lib/google-gmail': {
      consumeGmailSendOauthState: s => s === 'send' ? '101' : null,
      consumeGmailOauthState: s => s === 'read' ? '101' : null,
      exchangeGmailCode: async () => ({
        access_token: 'synthetic-access',
        refresh_token: 'synthetic-refresh',
        scope: 'https://www.googleapis.com/auth/gmail.send',
      }),
      getGoogleEmail: async () => 'test@example.invalid',
    },
    '@/lib/supabase-admin': {
      supabaseAdmin: {
        from: table => {
          assert.equal(table, 'users')
          return {
            // Main's second-account support (#1326) reads the current primary first.
            // No primary is connected here, so the original single-account path runs.
            select: () => ({
              eq: (key, value) => {
                assert.equal(key, 'telegram_id')
                assert.equal(String(value), '101')
                return { maybeSingle: async () => ({ data: null, error: null }) }
              },
            }),
            update: payload => {
              tokenSaves++
              assert.equal(payload.gmail_connected, true)
              return {
                eq: async (key, value) => {
                  assert.equal(key, 'telegram_id')
                  assert.equal(String(value), '101')
                  return { error: saveError ? { message: 'synthetic user update error' } : null }
                },
              }
            },
          }
        },
      },
    },
    '@/lib/security/google-token-crypto': {
      encryptGoogleToken: x => 'encrypted:' + x,
      hasGoogleTokenEncryptionKey: () => true,
    },
    '@/lib/agent/gmail-consent': {
      recordGmailConnectConsent: async id => {
        consentSaveCalls++
        assert.equal(String(id), '101')
        if (consentError) throw new Error('synthetic consent ' + consentError)
        return outcome
      },
      gmailConsentState: async id => {
        consentReadCalls++
        assert.equal(String(id), '101')
        if (stateError) throw new Error('synthetic verification read failure')
        return state
      },
    },
  }
  const sandbox = {
    exports: {}, module: { exports: {} },
    require: name => {
      assert.ok(Object.hasOwn(mods, name), 'unexpected import: ' + name)
      return mods[name]
    },
    URL, Date, String, Number, Error,
    console: { error: (...args) => logs.push(args.map(String).join(' ')) },
  }
  sandbox.module.exports = sandbox.exports
  vm.runInNewContext(compiled, sandbox, { filename: 'app/api/gmail/callback/route.ts', timeout: 1000 })
  assert.equal(typeof sandbox.exports.GET, 'function', 'original exported OAuth GET is invoked')
  const response = await sandbox.exports.GET({
    url: 'https://app.askgogo.in/api/gmail/callback?state=' + (sendUpgrade ? 'send' : 'read') + '&code=synthetic',
  })
  return { response, consentSaveCalls, consentReadCalls, tokenSaves, logs }
}

const green = await callGet()
assert.equal(green.response.status, 200)
assert.match(green.response.body, /Google Workspace is ready\./)
assert.match(green.response.body, /Gogo now has the read-only Google access you approved\./)
assert.equal(green.consentSaveCalls, 1)
assert.equal(green.consentReadCalls, 1)
assert.equal(green.tokenSaves, 1)

const previouslyApproved = await callGet({ outcome: 'already_on' })
assert.match(previouslyApproved.response.body, /Google Workspace is ready\./)

const sendYes = await callGet({ sendUpgrade: true })
assert.match(sendYes.response.body, /Gmail Send access you explicitly approved/)
assert.match(sendYes.response.body, /after the AskGogo approval boundary/)

const negativeCases = [
  ['explicit refusal', { outcome: 'kept_off', state: 'off' }],
  ['missing consent after save', { outcome: 'saved', state: 'missing' }],
  ['concurrent-off after save', { outcome: 'saved', state: 'off' }],
  ['consent write failed', { consentError: 'write' }],
  ['consent read failed', { consentError: 'read' }],
  ['post-write verification failed', { stateError: true }],
]
for (const [label, options] of negativeCases) {
  const x = await callGet(options)
  assert.equal(x.response.status, 200, label + ': Google token linkage may succeed')
  assert.match(x.response.body, /Google linked\. Gmail reading is paused\./, label)
  assert.match(x.response.body, /Gogo will not read or send Gmail until this is resolved\./, label)
  assert.match(x.response.body, /Review Email settings/, label)
  assert.doesNotMatch(x.response.body, /Google Workspace is ready\./, label)
  assert.doesNotMatch(x.response.body, /Gogo can read the approved Gmail/, label)
  assert.doesNotMatch(x.response.body, /Gogo now has the read-only Google access you approved\./, label)
  assert.equal(x.tokenSaves, 1, label + ': no re-saving or provider send')
}
const keptOff = await callGet({ outcome: 'kept_off', state: 'on' })
assert.equal(keptOff.consentReadCalls, 0, 'kept_off must not be transformed into consent')
assert.match(keptOff.response.body, /Gmail reading is paused/)
const sendOff = await callGet({ sendUpgrade: true, outcome: 'kept_off', state: 'off' })
assert.doesNotMatch(sendOff.response.body, /Gmail Send access you explicitly approved/)
assert.match(sendOff.response.body, /Gmail reading is paused/)
const failedTokens = await callGet({ saveError: true })
assert.equal(failedTokens.response.status, 500)
assert.equal(failedTokens.consentSaveCalls, 0, 'no consent can be recorded before token save')
assert.doesNotMatch(failedTokens.response.body, /Google Workspace is ready\./)
console.log('PASS: original Gmail callback GET cannot claim mailbox readiness on refused/missing/raced/failed consent; affirmative read/send still approval-bound')
