// Synthetic original-module regression: Calendar OAuth owner identifiers MUST NOT
// alias distinct persisted PostgreSQL BIGINT accounts through JS Number rounding.
// No external OAuth, token exchange, provider, database or customer data calls.
'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createHmac } = require('node:crypto')
const ts = require('typescript')

const SECRET = 'synthetic-calendar-state-owner-regression-secret'
const priorSecret = process.env.CALENDAR_OAUTH_STATE_SECRET
const priorClient = process.env.GOOGLE_CLIENT_ID
const priorFetch = globalThis.fetch
process.env.CALENDAR_OAUTH_STATE_SECRET = SECRET
process.env.GOOGLE_CLIENT_ID = 'synthetic-client-id'
globalThis.fetch = () => { throw new Error('NO_EXTERNAL_PROVIDER_OR_NETWORK_CALLS') }

const original = readFileSync('lib/services/google-calendar.ts', 'utf8')
assert.match(original, /export function buildCalendarConnectUrl/)
assert.match(original, /export function verifyCalendarConnectToken/)
assert.match(original, /export function consumeCalendarOauthState/)
assert.match(original, /export function getAuthUrl/)
const js = ts.transpileModule(original, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleStub = { exports: {} }
new Function('require', 'module', 'exports', js)(
  name => {
    if (name === 'crypto' || name === 'node:crypto') return require('node:crypto')
    if (name === '@/lib/security/google-token-crypto') return {
      decryptGoogleToken() { throw new Error('NO_REAL_TOKEN_ACCESS') },
    }
    throw new Error('Unexpected original module import: ' + name)
  },
  moduleStub, moduleStub.exports,
)
const calendar = moduleStub.exports
const MAX = Number.MAX_SAFE_INTEGER
const unsafe = MAX + 1
let checks = 0
function check(name, fn) { fn(); checks++; console.log('PASS ' + name) }
function connect(id) {
  const link = calendar.buildCalendarConnectUrl(id)
  assert.ok(link, 'safe ID produces a signed connect link')
  return new URL(link).searchParams.get('token') || ''
}
function oauth(id) {
  const link = calendar.getAuthUrl(id)
  const url = new URL(link)
  assert.equal(url.host, 'accounts.google.com')
  return url.searchParams.get('state') || ''
}
function fakeCompactSigned(tg, expiresInSeconds = 600) {
  const exp = Math.floor(Date.now() / 1000 + expiresInSeconds).toString(36)
  const payload = tg + '.' + exp + '.synthetic-nonce'
  const signature = createHmac('sha256', SECRET)
    .update('calendar_connect.c1.' + payload).digest('base64url').slice(0, 22)
  return 'c1.' + payload + '.' + signature
}
function fakeJsonSigned(tg, purpose = 'calendar_oauth', expiresInMs = 600000) {
  const encoded = Buffer.from(JSON.stringify({
    tg, purpose, exp: Date.now() + expiresInMs, nonce: 'synthetic-nonce',
  })).toString('base64url')
  const signature = createHmac('sha256', SECRET).update(encoded).digest('base64url')
  return encoded + '.' + signature
}
try {
  check('JavaScript can conflate two unrelated persisted BIGINT owner strings', () => {
    assert.equal(Number('9007199254740992'), Number('9007199254740993'))
    assert.equal(Number.isSafeInteger(unsafe), false)
  })
  check('ordinary positive Calendar connect stays signed and correctly bound', () => {
    const token = connect(123456789)
    assert.equal(calendar.verifyCalendarConnectToken(token), 123456789)
    assert.equal(calendar.verifyCalendarConnectToken(token + 'tampered'), null)
  })
  check('existing negative WhatsApp owner stays supported for Calendar connect', () => {
    const token = connect(-987654321)
    assert.equal(calendar.verifyCalendarConnectToken(token), -987654321)
  })
  check('highest safely representable numeric BIGINT remains supported', () => {
    assert.equal(calendar.verifyCalendarConnectToken(connect(MAX)), MAX)
    assert.equal(calendar.verifyCalendarConnectToken(connect(-MAX)), -MAX)
  })
  for (const id of [0, 1.5, -1.5, Number.NaN, Infinity, -Infinity, unsafe, -unsafe]) {
    check('unsafe connect owner rejected without generating a signed URL: ' + String(id), () => {
      assert.equal(calendar.buildCalendarConnectUrl(id), null)
    })
  }
  check('independently valid HMAC cannot legitimize unsafe compact owner 9007199254740992', () => {
    assert.equal(calendar.verifyCalendarConnectToken(fakeCompactSigned('9007199254740992')), null)
  })
  check('independently valid HMAC cannot legitimize rounded distinct compact owner 9007199254740993', () => {
    assert.equal(calendar.verifyCalendarConnectToken(fakeCompactSigned('9007199254740993')), null)
  })
  check('negative unsafe compact owner rejected', () => {
    assert.equal(calendar.verifyCalendarConnectToken(fakeCompactSigned('-9007199254740992')), null)
  })
  check('signed noncanonical IDs rejected instead of silently normalizing owner', () => {
    for (const id of ['000123', '-000123', '+123', '1e3', '0', '-0']) {
      assert.equal(calendar.verifyCalendarConnectToken(fakeCompactSigned(id)), null)
    }
  })
  check('signed normal and negative compact tokens preserve established behavior', () => {
    assert.equal(calendar.verifyCalendarConnectToken(fakeCompactSigned('123')), 123)
    assert.equal(calendar.verifyCalendarConnectToken(fakeCompactSigned('-123')), -123)
  })
  check('expired compact token and HMAC tamper remain rejected', () => {
    assert.equal(calendar.verifyCalendarConnectToken(fakeCompactSigned('123', -10)), null)
    assert.equal(calendar.verifyCalendarConnectToken(fakeCompactSigned('123') + 'X'), null)
  })
  check('ordinary positive OAuth token safely verifies the same owner', () => {
    const state = oauth(123456789)
    assert.equal(calendar.consumeCalendarOauthState(state), 123456789)
    assert.equal(calendar.consumeCalendarOauthState(state + 'tampered'), null)
  })
  check('existing negative WhatsApp owner safely round trips OAuth', () => {
    assert.equal(calendar.consumeCalendarOauthState(oauth(-987654321)), -987654321)
  })
  check('max safe owner OAuth remains supported', () => {
    assert.equal(calendar.consumeCalendarOauthState(oauth(MAX)), MAX)
  })
  for (const id of [0, 1.5, Number.NaN, Infinity, unsafe, -unsafe]) {
    check('unsafe OAuth owner rejected before signing: ' + String(id), () => {
      assert.throws(() => calendar.getAuthUrl(id), /calendar_oauth_owner_invalid/)
    })
  }
  check('even a validly signed JSON OAuth state with unsafe numeric owner is denied', () => {
    assert.equal(calendar.consumeCalendarOauthState(fakeJsonSigned(unsafe)), null)
    assert.equal(calendar.consumeCalendarOauthState(fakeJsonSigned(-unsafe)), null)
  })
  check('legacy calendar-connect JSON state requires safe owner too', () => {
    assert.equal(calendar.verifyCalendarConnectToken(fakeJsonSigned(unsafe, 'calendar_connect')), null)
    assert.equal(calendar.verifyCalendarConnectToken(fakeJsonSigned(-123, 'calendar_connect')), -123)
  })
  check('signed string owners and fractional owners cannot impersonate valid numeric owner', () => {
    assert.equal(calendar.consumeCalendarOauthState(fakeJsonSigned('123')), null)
    assert.equal(calendar.consumeCalendarOauthState(fakeJsonSigned(123.25)), null)
  })
  check('expired signed OAuth state and wrong purpose remain rejected', () => {
    assert.equal(calendar.consumeCalendarOauthState(fakeJsonSigned(123, 'calendar_oauth', -100)), null)
    assert.equal(calendar.consumeCalendarOauthState(fakeJsonSigned(123, 'calendar_connect')), null)
  })
  console.log('CALENDAR_OAUTH_OWNER_LITERAL: ' + checks + ' original-module inert checks PASS')
} finally {
  if (priorSecret === undefined) delete process.env.CALENDAR_OAUTH_STATE_SECRET
  else process.env.CALENDAR_OAUTH_STATE_SECRET = priorSecret
  if (priorClient === undefined) delete process.env.GOOGLE_CLIENT_ID
  else process.env.GOOGLE_CLIENT_ID = priorClient
  globalThis.fetch = priorFetch
}
