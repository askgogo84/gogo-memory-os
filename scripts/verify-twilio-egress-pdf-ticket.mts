// P1: real PDF/ticket handler entry points must refuse untrusted media before constructing Twilio Basic auth
// or making any network/provider call (ported from #934/#855, adapted to the shared Twilio CDN rule in
// lib/services/twilio-cdn.ts from #1401). All positive CDN tests use an injected, inert fetch.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

for (const file of ['lib/services/pdf-reader.ts', 'lib/services/pdf-reader-whatsapp.ts']) {
  const src = readFileSync(file, 'utf8')
  assert.doesNotMatch(src, /Authorization\s*:/, file + ' must not build Twilio Basic auth itself')
  assert.doesNotMatch(src, /fetch\(mediaUrl/, file + ' must not fetch an untrusted MediaUrl directly')
  assert.match(src, /fetchTwilioBoundDocumentMedia\(/, file + ' must use the bound Twilio transport')
}
const helperSrc = readFileSync('lib/services/twilio-pdf-egress.ts', 'utf8')
assert.match(helperSrc, /isTwilioMediaCdnUrl\(url\)/, 'CDN hop must use the shared Twilio CDN rule')
assert.match(helperSrc, /logRejectedTwilioRedirect\('pdf-ticket'/, 'rejected redirects must be logged (host only)')

const { fetchTwilioBoundDocumentMedia, TWILIO_DOCUMENT_MAX_BYTES } = await import('../lib/services/twilio-pdf-egress')
const { parsePdfTicket: parseCoreTicket, parseImageTicket } = await import('../lib/services/pdf-reader')
const { parsePdfTicket: parseWhatsAppTicket } = await import('../lib/services/pdf-reader-whatsapp')
const testAccount = 'AC' + '1'.repeat(32)
const testMessage = 'MM' + '2'.repeat(32)
const testMedia = 'ME' + '3'.repeat(32)
const validTwilioMedia = `https://api.twilio.com/2010-04-01/Accounts/${testAccount}/Messages/${testMessage}/Media/${testMedia}`
const testSecret = 'inert-secret-not-real'
const privateUrls = [
  'http://169.254.169.254/latest/meta-data/',
  'http://127.0.0.1/admin',
  'https://api.twilio.com.evil.example/steal',
  'https://api.twilio.com@evil.example/steal',
  'https://mms.twiliocdn.com/unauthenticated-first-hop',
  validTwilioMedia.replace('https:', 'http:'),
  validTwilioMedia.replace('api.twilio.com', 'api.twilio.com:8443'),
  validTwilioMedia.replace('api.twilio.com', 'user:pass@api.twilio.com'),
  validTwilioMedia.replace(testAccount, 'AC' + '4'.repeat(32)),
  validTwilioMedia + '?redirect=https://127.0.0.1',
  validTwilioMedia + '#fragment',
  validTwilioMedia.replace('/Media/' + testMedia, '/Media/invalid'),
]
let unauthorizedCalls = 0
const neverFetch = (async () => { unauthorizedCalls++; throw new Error('network reached') }) as typeof fetch
for (const url of privateUrls) {
  await assert.rejects(fetchTwilioBoundDocumentMedia(url, testAccount, testSecret, { fetchImpl: neverFetch }), /Twilio/)
}
await assert.rejects(fetchTwilioBoundDocumentMedia(validTwilioMedia, testAccount, '', { fetchImpl: neverFetch }), /credentials missing/)
await assert.rejects(fetchTwilioBoundDocumentMedia(validTwilioMedia, 'not-a-sid', testSecret, { fetchImpl: neverFetch }), /account identity/)
assert.equal(unauthorizedCalls, 0, 'bad media URL must be rejected before network or Basic credentials')

const originalMediaFetch = globalThis.fetch
globalThis.fetch = neverFetch
try {
  await assert.rejects(parseCoreTicket('http://169.254.169.254/', testAccount, testSecret))
  await assert.rejects(parseWhatsAppTicket('http://169.254.169.254/', testAccount, testSecret))
  await assert.rejects(parseImageTicket('http://169.254.169.254/', testAccount, testSecret))
  await assert.rejects(parseImageTicket(validTwilioMedia.replace(testAccount, 'AC' + '4'.repeat(32)), testAccount, testSecret))
  assert.equal(unauthorizedCalls, 0, 'all real ticket entry points must enforce the shared boundary')
} finally {
  globalThis.fetch = originalMediaFetch
}

const pdfFixture = Buffer.from('%PDF-1.4\nsynthetic only', 'utf8')
const apiCalls: Array<{ url: string; auth: string | null; redirect: RequestRedirect | undefined }> = []
const apiFetch = (async (url: any, init?: RequestInit) => {
  apiCalls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), redirect: init?.redirect })
  return new Response(pdfFixture, { status: 200 })
}) as typeof fetch
assert.deepEqual(await fetchTwilioBoundDocumentMedia(validTwilioMedia, testAccount, testSecret, { fetchImpl: apiFetch }), pdfFixture)
assert.equal(apiCalls.length, 1)
assert.equal(apiCalls[0].url, validTwilioMedia)
assert.equal(apiCalls[0].redirect, 'manual')
assert.equal(apiCalls[0].auth, 'Basic ' + Buffer.from(testAccount + ':' + testSecret).toString('base64'))

for (const validCdn of [
  'https://mms.twiliocdn.com/synthetic-fixture.pdf?token=public-test',
  'https://media.us1.twiliocdn.com/synthetic-fixture.pdf?token=public-test',
  'https://s3-external-1.amazonaws.com/media.twiliocdn.com/' + testAccount + '/fixture',
]) {
  const seen: Array<{ url: string; auth: string | null; redirect: RequestRedirect | undefined }> = []
  const redirected = (async (url: any, init?: RequestInit) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), redirect: init?.redirect })
    return seen.length === 1
      ? new Response(null, { status: 302, headers: { location: validCdn } })
      : new Response(pdfFixture, { status: 200 })
  }) as typeof fetch
  assert.deepEqual(await fetchTwilioBoundDocumentMedia(validTwilioMedia, testAccount, testSecret, { fetchImpl: redirected }), pdfFixture)
  assert.equal(seen.length, 2)
  assert.equal(seen[1].url, validCdn)
  assert.equal(seen[1].auth, null, 'Basic must not follow a Twilio CDN redirect')
  assert.equal(seen[1].redirect, 'manual')
}

const rejectedLogs: string[] = []
const originalError = console.error
console.error = (...args: unknown[]) => { rejectedLogs.push(args.map(String).join(' ')) }
const badTargets = [
  'http://169.254.169.254/latest/meta-data/',
  'https://evil.example/upload',
  'https://mms.twiliocdn.com.evil.example/steal',
  'https://mms.twiliocdn.com@evil.example/steal',
  'https://user:pass@mms.twiliocdn.com/steal',
  'http://mms.twiliocdn.com/untrusted',
  'https://mms.twiliocdn.com:8080/untrusted',
  'https://mms.twiliocdn.com/',
]
try {
  for (const target of badTargets) {
    let calls = 0
    const poisoned = (async () => { calls++; return new Response(null, { status: 302, headers: { location: target } }) }) as typeof fetch
    await assert.rejects(fetchTwilioBoundDocumentMedia(validTwilioMedia, testAccount, testSecret, { fetchImpl: poisoned }), /CDN/)
    assert.equal(calls, 1, 'unsafe redirect must not be contacted: ' + target)
  }
} finally {
  console.error = originalError
}
assert.equal(rejectedLogs.length, badTargets.length, 'every rejected redirect is logged')
assert.ok(rejectedLogs.every(l => l.startsWith('TWILIO_MEDIA_REDIRECT_REJECTED:') && l.includes('"where":"pdf-ticket"')))
assert.ok(rejectedLogs.every(l => !l.includes('/steal') && !l.includes('pass') && !l.includes(testSecret)), 'log carries the host only')

let secondHopCount = 0
const doubleRedirect = (async () => {
  secondHopCount++
  return new Response(null, { status: 302, headers: { location: 'https://mms.twiliocdn.com/x.pdf' } })
}) as typeof fetch
await assert.rejects(fetchTwilioBoundDocumentMedia(validTwilioMedia, testAccount, testSecret, { fetchImpl: doubleRedirect }), /download failed/)
assert.equal(secondHopCount, 2, 'a second redirect cannot cause third-hop SSRF')
await assert.rejects(fetchTwilioBoundDocumentMedia(validTwilioMedia, testAccount, testSecret, {
  fetchImpl: (async () => new Response('denied', { status: 401 })) as typeof fetch,
}), /download failed/)
const tooLargeDeclared = (async () => new Response('X', {
  status: 200,
  headers: { 'content-length': String(TWILIO_DOCUMENT_MAX_BYTES + 1) },
})) as typeof fetch
await assert.rejects(fetchTwilioBoundDocumentMedia(validTwilioMedia, testAccount, testSecret, { fetchImpl: tooLargeDeclared }), /size limit/)
const oversizedStream = (async () => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(TWILIO_DOCUMENT_MAX_BYTES))
    controller.enqueue(new Uint8Array(1))
    controller.close()
  },
}))) as typeof fetch
await assert.rejects(fetchTwilioBoundDocumentMedia(validTwilioMedia, testAccount, testSecret, { fetchImpl: oversizedStream }), /size limit/)
console.log('PDF/ticket Twilio: no untrusted Basic/SSRF egress, shared CDN rule with auth stripped, manual one-hop redirects and 20 MiB streamed bound')
