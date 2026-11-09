import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isBookingOrEventLinkText, shouldTreatMediaAsLinkPreview } from '../lib/services/whatsapp-preview-routing'

const exactBookMyShowForward = "Hey there, we're watching Mirzapur: The Movie (A). Find ticket details and other benefits, here https://bmsurl.co/BMSTNY/5Mjc6DKmzL"

assert.equal(isBookingOrEventLinkText(exactBookMyShowForward), true)
assert.equal(shouldTreatMediaAsLinkPreview({ bodyText: exactBookMyShowForward, mediaType: 'image/jpeg', numMedia: 1, mediaUrl: 'https://api.twilio.com/example-preview-thumbnail' }), true, 'BookMyShow link thumbnail must be treated as preview media, not a user document')
assert.equal(shouldTreatMediaAsLinkPreview({ bodyText: 'My passport photo', mediaType: 'image/jpeg', numMedia: 1, mediaUrl: 'https://api.twilio.com/real-user-image' }), false, 'real user images must remain real images')
assert.equal(shouldTreatMediaAsLinkPreview({ bodyText: 'Dinner photo https://example.com/restaurant', mediaType: 'image/jpeg', numMedia: 1, mediaUrl: 'https://api.twilio.com/real-food-photo' }), false, 'a user photo with an incidental URL must not be suppressed')
assert.equal(shouldTreatMediaAsLinkPreview({ bodyText: 'Booking Details - BookMyShow https://in.bookmyshow.com/events/example', mediaType: 'image/png', numMedia: 1, mediaUrl: 'https://api.twilio.com/preview' }), true)

const route = fs.readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.match(route, /shouldTreatMediaAsLinkPreview/)
assert.match(route, /previewThumbnailOnly/)
assert.match(route, /isImageContentType\(firstMediaType\) && !previewThumbnailOnly/)
assert.match(route, /WHATSAPP_LINK_PREVIEW_MEDIA_IGNORED/)

const featureRouter = fs.readFileSync('lib/feature-intents.ts', 'utf8')
const queue = fs.readFileSync('lib/agent/booking-queue.ts', 'utf8')
assert.match(featureRouter, /queueBookingClosure/)
assert.match(featureRouter, /isBookingOrEventLinkText/)
assert.match(queue, /registerLifeEvent/)
assert.match(queue, /eventType:\s*'event'/)
assert.match(queue, /source:\s*'whatsapp_booking_link'/)
assert.match(queue, /I’m handling this booking now/)
assert.match(queue, /action_key:\s*'booking-closure'/)

console.log('✅ WhatsApp booking/link preview routing regression passed')

const association=fs.readFileSync('lib/agent/contextual-association.ts','utf8')
assert.match(route,/contextualizeSavedItemReply/,'WhatsApp preview/image ingestion must use the shared long-memory association layer')
assert.match(route,/kind:'media'/,'social preview cards must associate against durable context')
assert.match(route,/kind:'image_note'/,'generic image notes must associate against durable context')
assert.match(association,/includeSemantic:true,maxFacts:10/,'association lookup stays bounded')
assert.match(association,/f\.score>=0\.58&&f\.confidence>=0\.55/,'weak memories are filtered')
assert.match(association,/return exactly NONE/,'weak associations stay silent')
assert.match(association,/Do not introduce any named entity unless it appears in the supplied context/,'unrelated entity leakage remains forbidden')
console.log('✅ Cross-surface Contextual Long Memory ingestion regression passed')


/** P1: face-crop media must never forward Twilio Basic auth to an untrusted media URL. */
const { downloadTwilioFaceMedia, TWILIO_FACE_MAX_BYTES } =
  await import('../lib/services/twilio-face-media-egress')
const faceAccount = 'AC' + '1'.repeat(32)
const faceMessage = 'MM' + '2'.repeat(32)
const faceMedia = 'ME' + '3'.repeat(32)
const faceUrl = `https://api.twilio.com/2010-04-01/Accounts/${faceAccount}/Messages/${faceMessage}/Media/${faceMedia}`
const faceToken = 'inert-test-only-token'
const badFaceUrls = [
  'http://169.254.169.254/latest/meta-data/',
  'http://127.0.0.1/private',
  'https://api.twilio.com.evil.example/steal',
  'https://api.twilio.com@evil.example/steal',
  faceUrl.replace('https:', 'http:'),
  faceUrl.replace('api.twilio.com', 'api.twilio.com:8080'),
  faceUrl.replace(faceAccount, 'AC' + '4'.repeat(32)),
  faceUrl + '?url=http://127.0.0.1',
  faceUrl + '#token',
  faceUrl.replace('/Media/' + faceMedia, '/Media/other'),
]
let leakedFaceCalls = 0
const noFaceNetwork = (async () => {
  leakedFaceCalls++
  throw new Error('untrusted network was called')
}) as typeof fetch
for (const target of badFaceUrls) {
  await assert.rejects(downloadTwilioFaceMedia(target, faceAccount, faceToken, { fetchImpl: noFaceNetwork }))
}
await assert.rejects(downloadTwilioFaceMedia(faceUrl, faceAccount, '', { fetchImpl: noFaceNetwork }))
assert.equal(leakedFaceCalls, 0, 'reject hostile/unauthenticated face media before network')

const faceHandler = fs.readFileSync('lib/services/face-crop.ts', 'utf8')
assert.match(faceHandler, /return downloadTwilioFaceMedia\(mediaUrl, sid, token\)/)
assert.doesNotMatch(faceHandler, /fetch\(mediaUrl|arrayBuffer\(\)/)

const faceBytes = Buffer.from('synthetic face test image bytes')
const faceFirstCalls: Array<{ url: string; auth: string | null; redirect: RequestRedirect | undefined }> = []
const face200 = (async (url: any, init?: RequestInit) => {
  faceFirstCalls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), redirect: init?.redirect })
  return new Response(faceBytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
}) as typeof fetch
assert.deepEqual((await downloadTwilioFaceMedia(faceUrl, faceAccount, faceToken, { fetchImpl: face200 })).buffer, faceBytes)
assert.equal(faceFirstCalls.length, 1)
assert.equal(faceFirstCalls[0].url, faceUrl)
assert.equal(faceFirstCalls[0].redirect, 'manual')
assert.equal(faceFirstCalls[0].auth, 'Basic ' + Buffer.from(faceAccount + ':' + faceToken).toString('base64'))

const faceCdn = 'https://mms.twiliocdn.com/inert-fixture.jpg?signature=not-real'
const faceRedirectCalls: Array<{ url: string; auth: string | null; redirect: RequestRedirect | undefined }> = []
const face302 = (async (url: any, init?: RequestInit) => {
  faceRedirectCalls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), redirect: init?.redirect })
  return faceRedirectCalls.length === 1
    ? new Response(null, { status: 302, headers: { location: faceCdn } })
    : new Response(faceBytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
}) as typeof fetch
assert.deepEqual((await downloadTwilioFaceMedia(faceUrl, faceAccount, faceToken, { fetchImpl: face302 })).buffer, faceBytes)
assert.equal(faceRedirectCalls.length, 2)
assert.equal(faceRedirectCalls[1].url, faceCdn)
assert.equal(faceRedirectCalls[1].auth, null, 'no Twilio Basic credentials on second hop')
assert.equal(faceRedirectCalls[1].redirect, 'manual')

for (const target of [
  'http://169.254.169.254/latest/meta-data/',
  'https://evil.example/steal',
  'https://mms.twiliocdn.com.evil.example/steal',
  'https://mms.twiliocdn.com@evil.example/steal',
  'http://mms.twiliocdn.com/not-https',
  'https://mms.twiliocdn.com:8443/not-approved',
]) {
  let calls = 0
  const poisoned = (async () => {
    calls++
    return new Response(null, { status: 302, headers: { location: target } })
  }) as typeof fetch
  await assert.rejects(downloadTwilioFaceMedia(faceUrl, faceAccount, faceToken, { fetchImpl: poisoned }))
  assert.equal(calls, 1, 'bad redirect URL cannot cause a second request')
}
let hopCount = 0
const secondRedirect = (async () => {
  hopCount++
  return new Response(null, { status: 302, headers: { location: faceCdn } })
}) as typeof fetch
await assert.rejects(downloadTwilioFaceMedia(faceUrl, faceAccount, faceToken, { fetchImpl: secondRedirect }))
assert.equal(hopCount, 2, 'second redirect cannot cause third-hop SSRF')

const oversizedFaceHeader = (async () => new Response('X', {
  status: 200,
  headers: { 'content-type': 'image/jpeg', 'content-length': String(TWILIO_FACE_MAX_BYTES + 1) },
})) as typeof fetch
await assert.rejects(downloadTwilioFaceMedia(faceUrl, faceAccount, faceToken, { fetchImpl: oversizedFaceHeader }), /size limit/)
const oversizedFaceStream = (async () => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(TWILIO_FACE_MAX_BYTES))
    controller.enqueue(new Uint8Array(1))
    controller.close()
  },
}), { status: 200, headers: { 'content-type': 'image/jpeg' } })) as typeof fetch
await assert.rejects(downloadTwilioFaceMedia(faceUrl, faceAccount, faceToken, { fetchImpl: oversizedFaceStream }), /size limit/)
const textResponse = (async () => new Response('not an image', {
  status: 200, headers: { 'content-type': 'text/html' },
})) as typeof fetch
await assert.rejects(downloadTwilioFaceMedia(faceUrl, faceAccount, faceToken, { fetchImpl: textResponse }), /supported image/)
console.log('✅ Face-crop Twilio image credential/SSRF boundary regression passed')
