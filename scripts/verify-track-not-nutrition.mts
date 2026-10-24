import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 21:29: "Track divya flight.. where is it now?" was answered with "I log meals rather than look up
// calorie counts" because detectIntent sent every message starting with "track " to the meal logger.
// Run: npx tsx scripts/verify-track-not-nutrition.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'
const d: any = await import('../lib/bot/detect-intent')
const type = (t: string) => d.detectIntent(t).type
for (const t of ['Track divya flight.. where is it now?', 'Track Divya flight', 'track my order', 'log in', 'log my weight', 'track the delivery']) {
  assert.notEqual(type(t), 'nutrition_log', `"${t}" is not a meal`)
  assert.notEqual(type(t), 'nutrition_query', `"${t}" is not a meal`)
}
for (const t of ['log 2 rotis and dal', 'track my lunch', 'track this', 'log this', 'log breakfast: poha', 'track 2 idlis', 'had 2 rotis with dal']) {
  assert.equal(type(t), 'nutrition_log', `"${t}" is still a meal log`)
}
assert.equal(type('track KL879'), 'web_search', 'a concrete flight code is not a meal either')

const pulse = readFileSync(new URL('../lib/agent/autonomy-pulse.ts', import.meta.url), 'utf8')
assert.match(pulse, /decodeHtmlEntities\(\[/, 'the proactive pulse decodes HTML entities before sending')
const ws: any = await import('../lib/agent/google-workspace-read')
assert.equal(ws.decodeHtmlEntities("company&#39;s accounts &amp; filing"), "company's accounts & filing")

// Synthetic/no-network P1 credential-egress regression for the nutrition-image entry.
const nutritionCode = readFileSync(new URL('../lib/bot/services/nutrition-analyzer.ts', import.meta.url), 'utf8')
assert.match(nutritionCode, /downloadTwilioNutritionImage\(params\.mediaUrl, sid, tok\)/, 'nutrition images must enter the guarded Twilio downloader')
assert.doesNotMatch(nutritionCode, /fetch\(params\.mediaUrl/, 'never fetch an untrusted nutrition media URL directly with Basic auth')
const { downloadTwilioNutritionImage, NUTRITION_IMAGE_MAX_BYTES } = await import('../lib/bot/services/twilio-nutrition-image')
const nutritionSid = 'AC' + 'a'.repeat(32)
const nutritionOtherSid = 'AC' + 'd'.repeat(32)
const nutritionMediaUrl = 'https://api.twilio.com/2010-04-01/Accounts/' + nutritionSid
  + '/Messages/MM' + 'b'.repeat(32) + '/Media/ME' + 'c'.repeat(32)
const imageFixture = () => new Response(Uint8Array.from([255, 216, 255]), { headers: { 'content-type': 'image/jpeg; charset=binary' } })
const captured: Array<{ url: string; redirect?: RequestRedirect; authorization?: string }> = []
const directFetch = (async (url: string | URL, init: RequestInit) => {
  captured.push({
    url: String(url),
    redirect: init.redirect,
    authorization: new Headers(init.headers).get('Authorization') || undefined,
  })
  return imageFixture()
}) as typeof fetch
for (const hostile of [
  'http://169.254.169.254/latest/meta-data',
  'https://127.0.0.1/secret',
  'https://api.twilio.com.evil.example/steal',
  'https://api.twilio.com@evil.example/steal',
  'https://mms.twiliocdn.com/unauthenticated-first-hop',
  nutritionMediaUrl.replace('https:', 'http:'),
  nutritionMediaUrl.replace(nutritionSid, nutritionOtherSid),
  nutritionMediaUrl + '?secret=sneaky',
  nutritionMediaUrl + '#fragment',
  'https://api.twilio.com/2010-04-01/Accounts/' + nutritionSid + '/Messages/MM' + 'b'.repeat(32) + '/Media/ME' + 'e'.repeat(10),
]) {
  await assert.rejects(
    () => downloadTwilioNutritionImage(hostile, nutritionSid, 'fixture-secret', { fetchImpl: directFetch }),
    /Twilio nutrition|Invalid Twilio/,
    'reject hostile nutrition URL before constructing or dispatching Basic auth'
  )
}
assert.equal(captured.length, 0, 'all hostile URLs must cause ZERO network requests')
await assert.rejects(
  () => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, '', { fetchImpl: directFetch }),
  /credentials unavailable/
)
assert.equal(captured.length, 0)
const direct = await downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', { fetchImpl: directFetch })
assert.equal(direct.contentType, 'image/jpeg')
assert.equal(direct.data.length, 3)
assert.equal(captured.length, 1)
assert.equal(captured[0].url, nutritionMediaUrl)
assert.equal(captured[0].redirect, 'manual')
assert.equal(captured[0].authorization, 'Basic ' + Buffer.from(nutritionSid + ':fixture-secret').toString('base64'))

// Redirects must be one-hop, pinned to Twilio CDN origin, and NEVER carry Basic credentials.
captured.length = 0
const cdnUrl = 'https://mms.twiliocdn.com/signed-fixture?signature=synthetic'
const cdnFetch = (async (url: string | URL, init: RequestInit) => {
  captured.push({ url: String(url), redirect: init.redirect, authorization: new Headers(init.headers).get('Authorization') || undefined })
  return captured.length === 1
    ? new Response(null, { status: 302, headers: { Location: cdnUrl } })
    : imageFixture()
}) as typeof fetch
const cdn = await downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', { fetchImpl: cdnFetch })
assert.equal(cdn.data.length, 3)
assert.equal(captured.length, 2)
assert.equal(captured[1].url, cdnUrl)
assert.equal(captured[0].redirect, 'manual')
assert.equal(captured[1].redirect, 'manual')
assert.ok(captured[0].authorization?.startsWith('Basic '))
assert.equal(captured[1].authorization, undefined, 'CDN second hop must not receive SID/token')
for (const badLocation of [
  'http://169.254.169.254/creds',
  'https://mms.twiliocdn.com.evil.example/steal',
  'https://mms.twiliocdn.com@evil.example/steal',
  'https://mms.twiliocdn.com/',
]) {
  let hops = 0
  await assert.rejects(
    () => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', {
      fetchImpl: (async () => {
        hops++
        return new Response(null, { status: 302, headers: { Location: badLocation } })
      }) as typeof fetch,
    }),
    /Twilio nutrition/
  )
  assert.equal(hops, 1, 'disallowed redirect must never be fetched')
}
let hops = 0
await assert.rejects(
  () => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', {
    fetchImpl: (async () => {
      hops++
      return new Response(null, { status: 302, headers: { Location: cdnUrl } })
    }) as typeof fetch,
  }),
  /download failed/,
  'a second redirect must never be followed'
)
assert.equal(hops, 2)
for (const oversized of [
  new Response(Uint8Array.of(1), { headers: { 'content-type': 'image/jpeg', 'content-length': String(NUTRITION_IMAGE_MAX_BYTES + 1) } }),
  new Response(new Uint8Array(NUTRITION_IMAGE_MAX_BYTES + 1), { headers: { 'content-type': 'image/jpeg' } }),
]) {
  await assert.rejects(
    () => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', {
      fetchImpl: (async () => oversized) as typeof fetch,
    }),
    /size limit/
  )
}
await assert.rejects(
  () => downloadTwilioNutritionImage(nutritionMediaUrl, nutritionSid, 'fixture-secret', {
    fetchImpl: (async () => new Response(Uint8Array.of(1), { headers: { 'content-type': 'application/pdf' } })) as typeof fetch,
  }),
  /content type/
)
console.log('nutrition Twilio: no untrusted Basic/SSRF egress, signed CDN auth stripped, manual redirects and bounded image streams')

console.log('"track <non-food>" is not a meal log; proactive pulse never shows raw HTML entities')
