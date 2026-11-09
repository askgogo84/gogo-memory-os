// Synthetic original-function regression: do not call OAuth, Gmail, Supabase or customer accounts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const oldSecret = process.env.GMAIL_OAUTH_STATE_SECRET
const fixtureSecret = 'fixture-only-gmail-oauth-owner-signing-secret'
process.env.GMAIL_OAUTH_STATE_SECRET = fixtureSecret
try {
  const source = fs.readFileSync('lib/services/google-gmail.ts', 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const m = { exports: {} }
  vm.runInNewContext(compiled, {
    exports: m.exports, module: m, require, process, Buffer, URLSearchParams,
    console, setTimeout, clearTimeout, AbortSignal, fetch: () => { throw Error('network not allowed') },
  }, { filename: 'lib/services/google-gmail.ts' })
  const oauth = m.exports
  function signed(tg, purpose, exp = Date.now() + 60_000) {
    const encoded = Buffer.from(JSON.stringify({ tg, purpose, exp, nonce: 'synthetic-owner-nonce-12345' })).toString('base64url')
    return encoded + '.' + createHmac('sha256', fixtureSecret).update(encoded).digest('base64url')
  }
  function linkToken(url) { return new URL(url).searchParams.get('token') }
  function authState(url) { return new URL(url).searchParams.get('state') }

  // A legitimate negative WhatsApp owner must remain supported.
  const owner = -123456789
  assert.equal(oauth.verifyGmailConnectToken(linkToken(oauth.buildGmailConnectUrl(owner))), owner)
  assert.equal(oauth.verifyGmailSendConnectToken(linkToken(oauth.buildGmailSendConnectUrl(owner))), owner)
  assert.equal(oauth.consumeGmailOauthState(authState(oauth.getGmailAuthUrl(owner))), owner)
  assert.equal(oauth.consumeGmailSendOauthState(authState(oauth.getGmailSendAuthUrl(owner))), owner)

  // Two distinct database BIGINT owners collapse into the same JavaScript number.
  const a = Number('9007199254740992')
  const b = Number('9007199254740993')
  assert.equal(a, b, 'fixture requires a real 64-bit collision')
  for (const invalid of [a, b, -a, 0, -0, 3.5, NaN, Infinity, -Infinity]) {
    assert.equal(oauth.buildGmailConnectUrl(invalid), null, 'read link must reject unsafe/fractional/zero ID')
    assert.equal(oauth.buildGmailSendConnectUrl(invalid), null, 'send link must reject unsafe/fractional/zero ID')
    assert.equal(oauth.getGmailAuthUrl(invalid), null, 'read OAuth state must reject unsafe ID')
    assert.equal(oauth.getGmailSendAuthUrl(invalid), null, 'send OAuth state must reject unsafe ID')
  }
  // An attacker cannot inject these without the signing secret. These fixtures
  // cover malformed internal issuers/legacy already-signed states, not exploitation.
  for (const invalid of [a, -a, 3.5, 0, '9007199254740993', null]) {
    assert.equal(oauth.verifyGmailConnectToken(signed(invalid, 'connect')), null)
    assert.equal(oauth.verifyGmailSendConnectToken(signed(invalid, 'send_connect')), null)
    assert.equal(oauth.consumeGmailOauthState(signed(invalid, 'oauth')), null)
    assert.equal(oauth.consumeGmailSendOauthState(signed(invalid, 'send_oauth')), null)
  }
  assert.equal(oauth.consumeGmailOauthState(signed(owner, 'oauth')), owner)
  assert.equal(oauth.consumeGmailSendOauthState(signed(owner, 'send_oauth')), owner)
  assert.equal(oauth.verifyGmailConnectToken(signed(owner, 'connect')), owner)
  assert.equal(oauth.verifyGmailSendConnectToken(signed(owner, 'send_connect')), owner)
  assert.equal(oauth.consumeGmailOauthState(signed(owner, 'send_oauth')), null, 'wrong purpose fails closed')
  assert.equal(oauth.consumeGmailSendOauthState(signed(owner, 'oauth')), null, 'wrong purpose fails closed')
  assert.equal(oauth.consumeGmailOauthState(signed(owner, 'oauth', Date.now() - 1)), null, 'expired state fails closed')
  console.log('PASS: literal Gmail OAuth issue/verify functions reject unsafe 64-bit owners; safe negative read/send flow and signed purpose/expiry preserved.')
} finally {
  if (oldSecret === undefined) delete process.env.GMAIL_OAUTH_STATE_SECRET
  else process.env.GMAIL_OAUTH_STATE_SECRET = oldSecret
}
