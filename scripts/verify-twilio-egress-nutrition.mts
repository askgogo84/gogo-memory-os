// Synthetic/no-network P1 credential-egress regression for the nutrition-photo entry (ported from #860,
// adapted to the shared Twilio CDN rule in lib/services/twilio-cdn.ts from #1401).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const nutritionCode = readFileSync(new URL('../lib/bot/services/nutrition-analyzer.ts', import.meta.url), 'utf8')
assert.match(nutritionCode, /downloadTwilioNutritionImage\(params\.mediaUrl, sid, tok\)/, 'nutrition images must enter the guarded Twilio downloader')
assert.doesNotMatch(nutritionCode, /fetch\(params\.mediaUrl/, 'never fetch an untrusted nutrition media URL directly with Basic auth')
assert.doesNotMatch(nutritionCode, /Basic /, 'nutrition analyzer must not build Basic auth itself')
const helperCode = readFileSync(new URL('../lib/bot/services/twilio-nutrition-image.ts', import.meta.url), 'utf8')
assert.match(helperCode, /isTwilioMediaCdnUrl\(url\)/, 'CDN hop must use the shared Twilio CDN rule')
assert.match(helperCode, /logRejectedTwilioRedirect\('nutrition'/, 'rejected redirects must be logged (host only)')

const { downloadTwilioNutritionImage, NUTRITION_IMAGE_MAX_BYTES } = await import('../lib/bot/services/twilio-nutrition-image')
const nutritionSid = 'AC' + 'a'.repeat(32)
const nutritionOtherSid = 'AC' + 'd'.repeat(32)
const nutritionMediaUrl = 'https://api.twilio.com/2010-04-01/Accounts/' + nutritionSid
  + '/Messages/MM' + 'b'.repeat(32) + '/Media/ME' + 'c'.repeat(32)
const imageFixture = () => new Response(Uint8Array.from([255, 216, 255]), { headers: { 'content-type': 'image/jpeg; charset=binary' } })
const captured: Array<{ url: string; redirect?: RequestRedirect; authorization?: string }> = []
const directFetch = (async (url: string | URL, init: RequestInit) => {
  captured.push({ url: String(url), redirect: init.redirect, authorization: new Headers(init.headers).get('Authorization') || undefined })
  return imageFixture()
}) as typeof fetch
for (const hostile of [
  'http://169.254.169.254/latest/meta-data',
  'https://127.0.0.1/secret',
  'https://api.twilio.com.evil.example/steal',
  'https://api.twilio.com@evil.example/steal',
  'https://mms.twiliocdn.com/unauthenticated-first-hop',
  nutritionMediaUrl.replace('https:', 'http:'),
  nutritionMediaUrl.replace('api.twilio.com', 'api.twilio.com:8443'),
  nutritionMediaUrl.replace(nutritionSid, nutritionOtherSid),
  nutritionMediaUrl + '?secret=sneaky',
  nutritionMediaUrl + '#fragment',
  'https://api.twilio.com/2010-04-01/Accounts/' + nutritionSid + '/Messages/MM' + 'b'.repeat(32) + '/Media/ME' + 'e'.repeat(10),
]) {
  await assert.rejects(
    () => downloadTwilioNutritionImage(hostile, nutritionSid, 'fixture-secret', { fetchImpl: directFetch }),
    /Twilio nutrition|Invalid Twilio/,
    'reject hostile nutrition URL before constructing or dispatching Basic auth: ' + hostile,
  )
}
assert.equal(captured.length, 0, 'all hostile URLs must cause ZERO network requests')
await assert.rejects(() => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, '', { fetchImpl: directFetch }), /credentials unavailable/)
await assert.rejects(() => downloadTwilioNutritionImage(nutritionMediaUrl, 'not-a-sid', 'fixture-secret', { fetchImpl: directFetch }), /Invalid Twilio nutrition account/)
assert.equal(captured.length, 0)
const direct = await downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', { fetchImpl: directFetch })
assert.equal(direct.contentType, 'image/jpeg')
assert.equal(direct.data.length, 3)
assert.equal(captured.length, 1)
assert.equal(captured[0].url, nutritionMediaUrl)
assert.equal(captured[0].redirect, 'manual')
assert.equal(captured[0].authorization, 'Basic ' + Buffer.from(nutritionSid + ':fixture-secret').toString('base64'))

// Redirects: one hop, only to a shared-rule Twilio CDN URL, and NEVER carrying Basic credentials.
for (const cdnUrl of [
  'https://mms.twiliocdn.com/signed-fixture?signature=synthetic',
  'https://media.us1.twiliocdn.com/signed-fixture?signature=synthetic',
  'https://s3-external-1.amazonaws.com/media.twiliocdn.com/' + nutritionSid + '/fixture',
]) {
  captured.length = 0
  const cdnFetch = (async (url: string | URL, init: RequestInit) => {
    captured.push({ url: String(url), redirect: init.redirect, authorization: new Headers(init.headers).get('Authorization') || undefined })
    return captured.length === 1 ? new Response(null, { status: 302, headers: { Location: cdnUrl } }) : imageFixture()
  }) as typeof fetch
  const cdn = await downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', { fetchImpl: cdnFetch })
  assert.equal(cdn.data.length, 3)
  assert.equal(captured.length, 2)
  assert.equal(captured[1].url, cdnUrl)
  assert.equal(captured[0].redirect, 'manual')
  assert.equal(captured[1].redirect, 'manual')
  assert.ok(captured[0].authorization?.startsWith('Basic '))
  assert.equal(captured[1].authorization, undefined, 'CDN second hop must not receive SID/token')
}

const rejectedLogs: string[] = []
const originalError = console.error
console.error = (...args: unknown[]) => { rejectedLogs.push(args.map(String).join(' ')) }
try {
  for (const badLocation of [
    'http://169.254.169.254/creds',
    'https://mms.twiliocdn.com.evil.example/steal',
    'https://mms.twiliocdn.com@evil.example/steal',
    'https://user:pass@mms.twiliocdn.com/steal',
    'http://mms.twiliocdn.com/plain-http',
    'https://mms.twiliocdn.com:8443/port',
    'https://mms.twiliocdn.com/',
    'https://evil.example/upload',
  ]) {
    let hops = 0
    await assert.rejects(
      () => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', {
        fetchImpl: (async () => { hops++; return new Response(null, { status: 302, headers: { Location: badLocation } }) }) as typeof fetch,
      }),
      /Twilio nutrition/,
    )
    assert.equal(hops, 1, 'disallowed redirect must never be fetched: ' + badLocation)
  }
} finally {
  console.error = originalError
}
assert.equal(rejectedLogs.length, 8, 'every rejected redirect is logged')
assert.ok(rejectedLogs.every(l => l.startsWith('TWILIO_MEDIA_REDIRECT_REJECTED:') && l.includes('"where":"nutrition"')))
assert.ok(rejectedLogs.every(l => !l.includes('/steal') && !l.includes('pass') && !l.includes('fixture-secret')), 'log carries the host only')

let hops = 0
await assert.rejects(
  () => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', {
    fetchImpl: (async () => { hops++; return new Response(null, { status: 302, headers: { Location: 'https://mms.twiliocdn.com/x' } }) }) as typeof fetch,
  }),
  /download failed/,
  'a second redirect must never be followed',
)
assert.equal(hops, 2)
for (const oversized of [
  new Response(Uint8Array.of(1), { headers: { 'content-type': 'image/jpeg', 'content-length': String(NUTRITION_IMAGE_MAX_BYTES + 1) } }),
  new Response(new Uint8Array(NUTRITION_IMAGE_MAX_BYTES + 1), { headers: { 'content-type': 'image/jpeg' } }),
]) {
  await assert.rejects(
    () => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', { fetchImpl: (async () => oversized) as typeof fetch }),
    /size limit/,
  )
}
await assert.rejects(
  () => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', {
    fetchImpl: (async () => new Response(Uint8Array.of(1), { headers: { 'content-type': 'application/pdf' } })) as typeof fetch,
  }),
  /content type/,
)
await assert.rejects(
  () => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', {
    fetchImpl: (async () => new Response('nope', { status: 403, headers: { 'content-type': 'image/jpeg' } })) as typeof fetch,
  }),
  /download failed/,
)
console.log('nutrition Twilio: no untrusted Basic/SSRF egress, shared CDN rule with auth stripped, manual redirects and bounded image streams')
