// Inbound media on Meta Cloud API: the downloader fails closed, and every media helper routes a Meta reference to it.
// Offline: fake fetch only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchMetaMedia, isMetaMediaDownloadUrl, isMetaMediaRef, metaMediaIdFromRef, metaMediaRef } from '../lib/channels/whatsapp-provider/meta-media.ts'
import { downloadTwilioWhatsappInboundMedia } from '../lib/services/twilio-whatsapp-inbound-egress.ts'
import { fetchTwilioBoundDocumentMedia } from '../lib/services/twilio-pdf-egress.ts'
import { fetchTwilioImageNote } from '../lib/services/twilio-image-note-egress.ts'

let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++ }
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++ }
const env = { GOGO_META_WA_TOKEN: 'fixture-token', GOGO_META_WA_PHONE_ID: '123456789012345' }
const REF = metaMediaRef('1234567890123')
const GOOD = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1&ext=2&hash=abc'

// 1. References and hosts.
eq(REF, 'meta-media://1234567890123', 'reference form')
eq(metaMediaIdFromRef(REF), '1234567890123', 'id round-trips as a string')
for (const bad of ['meta-media://abc', 'meta-media://12', 'meta-media://1234567890123/../x', 'https://graph.facebook.com/1234567890123', 'META-MEDIA://1234567890123', '', null]) ok(!isMetaMediaRef(bad), `not a reference: ${String(bad)}`)
assert.throws(() => metaMediaRef('12ab'), /invalid_meta_media_id/); checks++
ok(isMetaMediaDownloadUrl(new URL(GOOD)), "Meta's media host is accepted")
for (const bad of ['http://lookaside.fbsbx.com/a', 'https://lookaside.fbsbx.com.evil.example/a', 'https://evil.example/lookaside.fbsbx.com', 'https://user:pw@lookaside.fbsbx.com/a', 'https://lookaside.fbsbx.com:8443/a', 'https://lookaside.fbsbx.com/', 'https://169.254.169.254/latest', 'https://graph.facebook.com/a'])
  ok(!isMetaMediaDownloadUrl(new URL(bad)), `rejected download URL: ${bad}`)

// 2. Downloader.
type Call = { url: string; auth: string | null; redirect: string | undefined }
function fake(routes: Record<string, () => Response>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization || null, redirect: init?.redirect })
    const hit = Object.keys(routes).find(k => String(url).startsWith(k))
    return hit ? routes[hit]() : new Response('no', { status: 404 })
  }) as typeof fetch
  return { calls, fetchImpl }
}
const lookup = (o: Record<string, unknown>) => () => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
const bytes = (n: number, type: string, extra: Record<string, string> = {}) => () => new Response(new Uint8Array(n).fill(7), { status: 200, headers: { 'content-type': type, ...extra } })
const opts = { maxBytes: 1000, allowedTypes: ['audio/ogg', 'image/jpeg'] }

{
  const f = fake({ 'https://graph.facebook.com/v21.0/1234567890123': lookup({ url: GOOD, mime_type: 'audio/ogg; codecs=opus', file_size: 500 }), 'https://lookaside.fbsbx.com/': bytes(500, 'audio/ogg') })
  const media = await fetchMetaMedia(REF, opts, { env, fetchImpl: f.fetchImpl })
  eq([media?.arrayBuffer.byteLength, media?.contentType], [500, 'audio/ogg'], 'a voice note downloads')
  eq(f.calls.map(c => new URL(c.url).hostname), ['graph.facebook.com', 'lookaside.fbsbx.com'], 'exactly two requests, to Meta only')
  ok(f.calls.every(c => c.auth === 'Bearer fixture-token' && c.redirect === 'manual'), 'bearer token on both, redirects never followed')
  ok(f.calls.every(c => !c.url.includes('fixture-token')), 'the token is never in a URL')
}
const refuse = async (label: string, routes: Record<string, () => Response>, expectCalls: number, o = opts, e: Record<string, string> = env, ref = REF) => {
  const f = fake(routes)
  eq(await fetchMetaMedia(ref, o, { env: e, fetchImpl: f.fetchImpl }), null, label)
  eq(f.calls.length, expectCalls, `${label}: ${expectCalls} request(s) made`)
}
const G = 'https://graph.facebook.com/v21.0/1234567890123', L = 'https://lookaside.fbsbx.com/'
await refuse('a URL on another host is never fetched', { [G]: lookup({ url: 'https://evil.example/a.ogg', mime_type: 'audio/ogg' }) }, 1)
await refuse('an internal address is never fetched', { [G]: lookup({ url: 'https://169.254.169.254/latest/meta-data', mime_type: 'audio/ogg' }) }, 1)
await refuse('a declared type off the allowlist stops before download', { [G]: lookup({ url: GOOD, mime_type: 'application/x-msdownload' }) }, 1)
await refuse('a declared size over the limit stops before download', { [G]: lookup({ url: GOOD, mime_type: 'audio/ogg', file_size: 5000 }) }, 1)
await refuse('a redirect from the lookup is not followed', { [G]: () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }) }, 1)
await refuse('a redirect from the download is not followed', { [G]: lookup({ url: GOOD, mime_type: 'audio/ogg' }), [L]: () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }) }, 2)
await refuse('a body over the limit is refused while streaming', { [G]: lookup({ url: GOOD, mime_type: 'audio/ogg' }), [L]: bytes(5000, 'audio/ogg') }, 2)
await refuse('a lying content-length over the limit is refused', { [G]: lookup({ url: GOOD, mime_type: 'audio/ogg' }), [L]: bytes(10, 'audio/ogg', { 'content-length': '999999' }) }, 2)
await refuse('a served type off the allowlist is refused', { [G]: lookup({ url: GOOD, mime_type: 'audio/ogg' }), [L]: bytes(10, 'text/html') }, 2)
await refuse('an empty body is refused', { [G]: lookup({ url: GOOD, mime_type: 'audio/ogg' }), [L]: bytes(0, 'audio/ogg') }, 2)
await refuse('no token means no request at all', { [G]: lookup({ url: GOOD, mime_type: 'audio/ogg' }) }, 0, opts, {})
await refuse('a value that is not a reference makes no request', { [G]: lookup({ url: GOOD, mime_type: 'audio/ogg' }) }, 0, opts, env, 'https://graph.facebook.com/v21.0/1234567890123')
await refuse('an empty allowlist makes no request', {}, 0, { maxBytes: 1000, allowedTypes: [] })
{
  const f = fake({ [G]: lookup({ url: GOOD, mime_type: 'image/jpeg' }), [L]: bytes(10, 'application/octet-stream') })
  eq((await fetchMetaMedia(REF, opts, { env, fetchImpl: f.fetchImpl }))?.contentType, 'image/jpeg', 'a generic served type falls back to the declared, allowed type')
}

// 3. Helpers: a Meta reference goes to Meta with that helper's own bounds, and never to Twilio.
const routes = (mime: string, n = 64) => ({ [G]: lookup({ url: GOOD, mime_type: mime }), [L]: bytes(n, mime) })
const prev = { ...process.env }; Object.assign(process.env, env)
try {
  let f = fake(routes('audio/ogg'))
  const audio = await downloadTwilioWhatsappInboundMedia({ mediaUrl: REF, accountSid: 'AC' + 'a'.repeat(32), authToken: 'twilio-secret', kind: 'audio', fetchImpl: f.fetchImpl })
  eq(audio?.contentType, 'audio/ogg', 'inbound audio helper accepts a Meta reference')
  ok(f.calls.every(c => !/twilio/.test(c.url) && !/Basic/.test(String(c.auth))), 'no Twilio request and no Twilio credential on the Meta path')
  f = fake(routes('audio/ogg'))
  eq(await downloadTwilioWhatsappInboundMedia({ mediaUrl: REF, accountSid: 'AC' + 'a'.repeat(32), authToken: 'twilio-secret', kind: 'image', fetchImpl: f.fetchImpl }), null, 'an audio file is refused where an image is expected')
  f = fake(routes('application/pdf'))
  eq((await fetchTwilioBoundDocumentMedia(REF, 'AC' + 'a'.repeat(32), 'twilio-secret', { fetchImpl: f.fetchImpl })).byteLength, 64, 'document helper accepts a Meta reference')
  f = fake(routes('text/html'))
  await assert.rejects(fetchTwilioImageNote(REF, 'AC' + 'a'.repeat(32), 'twilio-secret', { fetchImpl: f.fetchImpl }), /meta_image_unavailable/); checks++
  // The Twilio path is unchanged: a non-Twilio https URL is still refused before any request.
  f = fake({})
  eq(await downloadTwilioWhatsappInboundMedia({ mediaUrl: 'https://evil.example/a.ogg', accountSid: 'AC' + 'a'.repeat(32), authToken: 'twilio-secret', kind: 'audio', fetchImpl: f.fetchImpl }), null, 'an arbitrary URL is still refused')
  eq(f.calls.length, 0, 'and nothing is requested for it')
} finally { for (const k of Object.keys(env)) delete process.env[k]; Object.assign(process.env, prev) }

// 4. Every media helper has the Meta branch as the first statement of its download function.
const helpers: [string, string][] = [
  ['lib/services/twilio-document-store-egress.ts', 'fetchTwilioVaultDocumentMedia'], ['lib/services/twilio-face-media-egress.ts', 'downloadTwilioFaceMedia'],
  ['lib/services/twilio-image-note-egress.ts', 'fetchTwilioImageNote'], ['lib/services/twilio-pdf-egress.ts', 'fetchTwilioBoundDocumentMedia'],
  ['lib/services/twilio-whatsapp-inbound-egress.ts', 'downloadTwilioWhatsappInboundMedia'], ['lib/services/twilio-media-memory-thumbnail.ts', 'downloadTwilioMemoryThumbnail'],
  ['lib/services/twilio-social-preview-image.ts', 'downloadTwilioSocialPreviewImage'], ['lib/bot/services/twilio-nutrition-image.ts', 'downloadTwilioNutritionImage'],
  ['lib/services/voice-transcription.ts', 'downloadTrustedTwilioVoiceNote'],
]
for (const [file, fn] of helpers) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
  const at = src.search(new RegExp(`async function ${fn}\\(`))
  const body = src.slice(at, at + 1400)
  ok(at >= 0 && /if \(isMetaMediaRef\((?:args\.)?mediaUrl\)\) \{/.test(body), `${fn} routes a Meta reference`)
  ok(body.indexOf('isMetaMediaRef(') < body.search(/Basic/), `${fn}: the Meta branch comes before any Twilio credential is built`)
  ok(/maxBytes: [A-Z_]+(?:,| \?| :)|maxBytes: args\.kind/.test(body), `${fn} passes its own byte limit`)
}
const downloader = readFileSync(new URL('../lib/channels/whatsapp-provider/meta-media.ts', import.meta.url), 'utf8')
ok(!/console\.(?:log|error)\([^\n]*(?:token|url\.(?:href|pathname|search)|info\.url)/.test(downloader), 'the downloader logs only a status or a host name')

console.log(`WA_META_MEDIA_OK ${checks} checks`)
