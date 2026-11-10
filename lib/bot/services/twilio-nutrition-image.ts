/**
 * Fail-closed, size-bounded transport for WhatsApp nutrition (meal) photos.
 * Form-supplied MediaUrl0 is NOT a trusted credential destination.
 *
 * Mirrors lib/services/twilio-image-note-egress.ts: Basic auth is built only for the
 * configured account's exact HTTPS api.twilio.com Media resource, redirects are manual,
 * and one Twilio media CDN hop (lib/services/twilio-cdn.ts) is followed WITHOUT
 * credentials. Origin checks are not DNS/IP pinning.
 */
import { isTwilioMediaCdnUrl, logRejectedTwilioRedirect } from '@/lib/services/twilio-cdn'
import { fetchMetaMedia, isMetaMediaRef } from '@/lib/channels/whatsapp-provider/meta-media'
export const NUTRITION_IMAGE_MAX_BYTES = 12 * 1024 * 1024

const accountSidPattern = /^AC[0-9a-fA-F]{32}$/
const mediaPathPattern = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/(?:MM|SM)[0-9a-fA-F]{32}\/Media\/ME[0-9a-fA-F]{32}$/
const redirectCodes = new Set([301, 302, 303, 307, 308])
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function exactTwilioMediaUrl(mediaUrl: string, accountSid: string): URL {
  if (!accountSidPattern.test(accountSid)) throw new Error('Invalid Twilio nutrition account')
  let url: URL
  try { url = new URL(mediaUrl) } catch { throw new Error('Invalid Twilio nutrition image URL') }
  if (url.origin !== 'https://api.twilio.com' || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Twilio nutrition media URL is not an authorized API origin')
  }
  const match = mediaPathPattern.exec(url.pathname)
  if (!match || match[1] !== accountSid) throw new Error('Twilio nutrition media URL does not match account')
  return url
}

function exactTwilioCdnRedirect(location: string | null, previous: URL): URL {
  if (!location || location.length > 8192) throw new Error('Unsafe Twilio nutrition media redirect')
  let url: URL
  try { url = new URL(location, previous) } catch { throw new Error('Unsafe Twilio nutrition media redirect') }
  if (!isTwilioMediaCdnUrl(url)) {
    logRejectedTwilioRedirect('nutrition', location)
    throw new Error('Twilio nutrition media redirect escaped permitted CDN')
  }
  // Signed CDN query strings are allowed. No other host, scheme, or hop is.
  return url
}

async function readBoundedImage(res: Response): Promise<{ data: Buffer; contentType: string }> {
  if (!res.ok || res.status !== 200) throw new Error('Twilio nutrition image download failed')
  const contentType = String(res.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (!imageTypes.has(contentType)) throw new Error('Unsupported Twilio nutrition image content type')
  const length = res.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length.trim())
      || !Number.isSafeInteger(Number(length)) || Number(length) > NUTRITION_IMAGE_MAX_BYTES)) {
    throw new Error('Twilio nutrition image exceeds size limit')
  }
  if (!res.body) throw new Error('Twilio nutrition image response has no readable stream')
  const reader = res.body.getReader()
  const parts: Buffer[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > NUTRITION_IMAGE_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('Twilio nutrition image exceeds size limit')
      }
      parts.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  if (!received) throw new Error('Twilio nutrition image empty')
  return { data: Buffer.concat(parts, received), contentType }
}

/**
 * Validate the exact configured account's HTTPS REST media object BEFORE
 * constructing Basic credentials. The single permitted CDN redirect is always
 * anonymous and never follows redirects implicitly. No URL/secret logging.
 */
export async function downloadTwilioNutritionImage(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ data: Buffer; contentType: string }> {
  // A Meta Cloud API media reference: fetched from Meta with the same size and type bounds (see meta-media.ts).
  if (isMetaMediaRef(mediaUrl)) {
    const media = await fetchMetaMedia(mediaUrl, { maxBytes: NUTRITION_IMAGE_MAX_BYTES, allowedTypes: imageTypes }, { fetchImpl: options.fetchImpl })
    if (!media) throw new Error('Meta nutrition image unavailable')
    return { data: Buffer.from(media.arrayBuffer), contentType: media.contentType }
  }
  const api = exactTwilioMediaUrl(mediaUrl, accountSid)
  if (!authToken) throw new Error('Twilio nutrition credentials unavailable')
  const fetchImpl = options.fetchImpl || fetch
  const first = await fetchImpl(api.href, {
    headers: { Authorization: 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64') },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  if (!redirectCodes.has(first.status)) return readBoundedImage(first)
  const cdn = exactTwilioCdnRedirect(first.headers.get('location'), api)
  const second = await fetchImpl(cdn.href, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    // Intentionally no Authorization on CDN, even if the API was credentialed.
  })
  return readBoundedImage(second) // Rejects second redirect, errors and non-images.
}
