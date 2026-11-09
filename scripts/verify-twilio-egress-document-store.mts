// P1 VAULT_DOCUMENT_SSRF + asset-memory PDF transport: private documents cannot leak Twilio Basic auth to
// user-supplied hosts/redirects, or download unlimited bytes (ported from #931/#863, adapted to the shared
// Twilio CDN rule in lib/services/twilio-cdn.ts from #1401). Synthetic in-memory transport only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const docTransport = await import('../lib/services/twilio-document-store-egress.ts')
const helperSrc = readFileSync('lib/services/twilio-document-store-egress.ts', 'utf8')
assert.match(helperSrc, /isTwilioMediaCdnUrl\(url\)/, 'CDN hop must use the shared Twilio CDN rule')
assert.match(helperSrc, /logRejectedTwilioRedirect\('document-store'/, 'rejected redirects must be logged (host only)')
const configuredSid = 'AC' + 'a'.repeat(32)
const otherSid = 'AC' + 'd'.repeat(32)
const messageSid = 'MM' + 'b'.repeat(32)
const mediaSid = 'ME' + 'c'.repeat(32)
const validMediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${configuredSid}/Messages/${messageSid}/Media/${mediaSid}`
const syntheticToken = 'synthetic-test-token'
const authExpected = 'Basic ' + Buffer.from(configuredSid + ':' + syntheticToken).toString('base64')
const validBody = '%PDF-1.7 synthetic only'
const pdfResponse = () => new Response(validBody, { status: 200, headers: { 'Content-Type': 'application/pdf' } })
const calls: { url: string; init: RequestInit | undefined }[] = []
const successfulFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(url), init })
  return pdfResponse()
}) as typeof fetch
const fetched = await docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken, fetchImpl: successfulFetch,
})
assert.equal(fetched.toString(), validBody, 'expected genuine synthetic document bytes')
assert.equal(calls.length, 1)
assert.equal(calls[0].url, validMediaUrl)
assert.equal(calls[0].init?.redirect, 'manual', 'never implicitly follow first-hop redirects')
assert.equal((calls[0].init?.headers as Record<string, string>)?.Authorization, authExpected)

// No malformed host, wrong account or lookalike path may perform ANY network fetch.
for (const url of [
  validMediaUrl.replace('https:', 'http:'),
  validMediaUrl.replace('api.twilio.com', '169.254.169.254'),
  validMediaUrl.replace('api.twilio.com', 'api.twilio.com.attacker.example'),
  validMediaUrl.replace('api.twilio.com', 'attacker@api.twilio.com'),
  validMediaUrl.replace('api.twilio.com', 'api.twilio.com:8443'),
  validMediaUrl.replace(configuredSid, otherSid),
  validMediaUrl.replace('/Media/', '/Media/%2F'),
  validMediaUrl + '?redirect=https://evil.example',
  validMediaUrl + '#private',
  'https://example.com/2010-04-01/Accounts/' + configuredSid,
  'https://mms.twiliocdn.com/unauthenticated-first-hop',
]) {
  const before = calls.length
  await assert.rejects(
    docTransport.fetchTwilioVaultDocumentMedia({ mediaUrl: url, accountSid: configuredSid, authToken: syntheticToken, fetchImpl: successfulFetch }),
    /Document media|Invalid document media/,
  )
  assert.equal(calls.length, before, 'rejected URL must not fetch or transmit Basic auth: ' + url)
}

calls.length = 0
await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: '', fetchImpl: successfulFetch,
}), /credentials unavailable/)
await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: '', authToken: syntheticToken, fetchImpl: successfulFetch,
}), /account unavailable/)
assert.equal(calls.length, 0, 'missing credentials fail before network activity')

for (const signedCdn of [
  'https://mms.twiliocdn.com/private/media?token=synthetic-signature',
  'https://media.us1.twiliocdn.com/private/media?token=synthetic-signature',
  'https://s3-external-1.amazonaws.com/media.twiliocdn.com/' + configuredSid + '/fixture',
]) {
  calls.length = 0
  const goodRedirect = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (calls.length === 1) return new Response(null, { status: 302, headers: { Location: signedCdn } })
    return pdfResponse()
  }) as typeof fetch
  assert.equal((await docTransport.fetchTwilioVaultDocumentMedia({
    mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken, fetchImpl: goodRedirect,
  })).toString(), validBody)
  assert.deepEqual(calls.map(c => c.url), [validMediaUrl, signedCdn])
  assert.equal(calls[0].init?.redirect, 'manual')
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, authExpected)
  assert.equal(calls[1].init?.redirect, 'manual')
  assert.equal(calls[1].init?.headers, undefined, 'Twilio Basic MUST NOT appear on CDN hop')
}

// An off-host CDN and any second redirect are refused rather than followed; rejects are logged by host only.
const rejectedLogs: string[] = []
const originalError = console.error
console.error = (...args: unknown[]) => { rejectedLogs.push(args.map(String).join(' ')) }
const badLocations = [
  'http://mms.twiliocdn.com/x', 'https://mms.twiliocdn.com.evil.test/steal', 'https://127.0.0.1/private',
  'https://user@mms.twiliocdn.com/x', 'https://user:pass@mms.twiliocdn.com/x', 'https://mms.twiliocdn.com:8443/x',
  'https://mms.twiliocdn.com/', 'https://evil.example/upload',
]
try {
  for (const location of badLocations) {
    let hit = 0
    await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
      mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken,
      fetchImpl: (async () => { hit++; return new Response(null, { status: 302, headers: { Location: location } }) }) as typeof fetch,
    }), /CDN/)
    assert.equal(hit, 1, 'do not contact rejected CDN origin: ' + location)
  }
} finally {
  console.error = originalError
}
assert.equal(rejectedLogs.length, badLocations.length, 'every rejected redirect is logged')
assert.ok(rejectedLogs.every(l => l.startsWith('TWILIO_MEDIA_REDIRECT_REJECTED:') && l.includes('"where":"document-store"')))
assert.ok(rejectedLogs.every(l => !l.includes('/steal') && !l.includes('pass') && !l.includes(syntheticToken)), 'log carries the host only')

let hops = 0
await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken,
  fetchImpl: (async () => { hops++; return new Response(null, { status: 302, headers: { Location: 'https://mms.twiliocdn.com/x' } }) }) as typeof fetch,
}), /HTTP failure/)
assert.equal(hops, 2, 'no third hop may be attempted')

await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken,
  fetchImpl: (async () => new Response('<html>wrong content</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })) as typeof fetch,
}), /Unsupported Twilio document media type/)
await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken,
  fetchImpl: (async () => new Response('tiny', {
    status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(docTransport.TWILIO_VAULT_DOCUMENT_MAX_BYTES + 1) },
  })) as typeof fetch,
}), /exceeds size limit/)
await assert.rejects(docTransport.fetchTwilioVaultDocumentMedia({
  mediaUrl: validMediaUrl, accountSid: configuredSid, authToken: syntheticToken,
  fetchImpl: (async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(docTransport.TWILIO_VAULT_DOCUMENT_MAX_BYTES + 1))
      controller.close()
    },
  }), { status: 200, headers: { 'Content-Type': 'application/pdf' } })) as typeof fetch,
}), /exceeds size limit/, 'streaming cap is effective even with no Content-Length')

// Wiring regression: doc-store must keep insert-before-upload idempotency, and must never use the caller
// FileRef as destination or fetch/arrayBuffer authority.
const documentStoreSource = readFileSync('lib/services/document-store.ts', 'utf8')
assert.match(documentStoreSource, /fetchTwilioVaultDocumentMedia\(/)
assert.match(documentStoreSource, /file\.accountSid !== configuredSid/)
assert.match(documentStoreSource, /file\.authToken !== configuredToken/)
assert.doesNotMatch(documentStoreSource, /fetch\(file\.mediaUrl/)
assert.doesNotMatch(documentStoreSource, /Authorization\s*:/)
assert.doesNotMatch(documentStoreSource, /await res\.arrayBuffer\(/)
assert.ok(documentStoreSource.indexOf(".from('documents')\n    .insert(") > 0)
assert.ok(documentStoreSource.indexOf(".from('documents')\n    .insert(") <
  documentStoreSource.indexOf('await uploadToBucket(params.telegramId, params.file)'),
  'document row must claim source message before any upload (no blind retry)')
const assetSource = readFileSync('lib/services/asset-memory.ts', 'utf8')
assert.doesNotMatch(assetSource, /Authorization\s*:/, 'asset-memory must not build Twilio Basic auth itself')
assert.match(assetSource, /fetchTwilioVaultDocumentMedia\(/)
console.log('Vault document transport P1: account/origin bound; no Basic on CDN; bad hosts, redirects, MIME and oversized bodies fail closed')

// Asset-memory PDF transport through the REAL fetchTwilioBase64 entry point (global fetch spy, env-bound account).
const A = await import('../lib/services/asset-memory')
const assetToken = 'fixture-only-token'
const oldSid = process.env.TWILIO_ACCOUNT_SID
const oldToken = process.env.TWILIO_AUTH_TOKEN
const oldFetch = globalThis.fetch
type Attempt = { url: string; authorization: string | null; redirect?: RequestRedirect }
let attempts: Attempt[] = []
function setAssetTransport(reply: (url: string) => Response | Promise<Response>) {
  attempts = []
  globalThis.fetch = (async (url: any, init: any) => {
    attempts.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization'), redirect: init?.redirect })
    return reply(String(url))
  }) as typeof fetch
}
process.env.TWILIO_ACCOUNT_SID = configuredSid
process.env.TWILIO_AUTH_TOKEN = assetToken
const assetBasic = 'Basic ' + Buffer.from(configuredSid + ':' + assetToken).toString('base64')
try {
  setAssetTransport(() => { throw new Error('Hostile media URL caused network fetch') })
  for (const hostile of [
    'http://169.254.169.254/latest/meta-data/',
    validMediaUrl.replace('https:', 'http:'),
    validMediaUrl.replace('api.twilio.com/', 'api.twilio.com.evil.test/'),
    validMediaUrl.replace('api.twilio.com/', 'attacker:pass@api.twilio.com/'),
    validMediaUrl.replace('api.twilio.com/', 'api.twilio.com:8443/'),
    validMediaUrl.replace(configuredSid, otherSid),
    validMediaUrl + '?next=https://169.254.169.254/',
    'https://mms.twiliocdn.com/asset/path',
  ]) {
    await assert.rejects(A.fetchTwilioBase64(hostile, 'application/pdf'), /Document media|Invalid document media/)
  }
  assert.equal(attempts.length, 0, 'untrusted source never reaches network')
  setAssetTransport(() => new Response('%PDF-fixture', { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
  const first = await A.fetchTwilioBase64(validMediaUrl, 'application/pdf')
  assert.equal(Buffer.from(first.b64, 'base64').toString('utf8'), '%PDF-fixture')
  assert.equal(first.isPdf, true)
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].authorization, assetBasic, 'Basic only on exact Twilio account origin')
  assert.equal(attempts[0].redirect, 'manual', 'never follow redirect with Basic auth')
  const cdn = 'https://mms.twiliocdn.com/safe-document/asset?sig=fixture'
  setAssetTransport(url => url === validMediaUrl
    ? new Response(null, { status: 302, headers: { location: cdn } })
    : new Response('%PDF-cdn-fixture', { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
  const redirected = await A.fetchTwilioBase64(validMediaUrl, 'application/pdf')
  assert.equal(Buffer.from(redirected.b64, 'base64').toString('utf8'), '%PDF-cdn-fixture')
  assert.equal(attempts.length, 2)
  assert.equal(attempts[1].authorization, null, 'never send SID/token on the CDN hop')
  assert.ok(attempts.every(x => x.redirect === 'manual'))
  console.error = () => {}
  setAssetTransport(() => new Response(null, { status: 302, headers: { location: 'https://mms.twiliocdn.com.evil.test/steal' } }))
  await assert.rejects(A.fetchTwilioBase64(validMediaUrl, 'application/pdf'), /CDN/)
  assert.equal(attempts.length, 1, 'malicious redirect must not trigger second fetch')
  console.error = originalError
  setAssetTransport(() => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(11 * 1024 * 1024))
      controller.enqueue(new Uint8Array(11 * 1024 * 1024))
      controller.close()
    },
  }), { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
  await assert.rejects(A.fetchTwilioBase64(validMediaUrl, 'application/pdf'), /exceeds size limit/)
  delete process.env.TWILIO_AUTH_TOKEN
  setAssetTransport(() => { throw new Error('missing credentials should never fetch') })
  await assert.rejects(A.fetchTwilioBase64(validMediaUrl, 'application/pdf'), /credentials unavailable/)
  assert.equal(attempts.length, 0)
  console.log('Asset PDF Twilio auth egress: hostile URL/redirect, 20MiB streaming cap, missing token rejected; exact account and auth-stripped CDN accepted (synthetic only)')
} finally {
  console.error = originalError
  globalThis.fetch = oldFetch
  if (oldSid === undefined) delete process.env.TWILIO_ACCOUNT_SID
  else process.env.TWILIO_ACCOUNT_SID = oldSid
  if (oldToken === undefined) delete process.env.TWILIO_AUTH_TOKEN
  else process.env.TWILIO_AUTH_TOKEN = oldToken
}
