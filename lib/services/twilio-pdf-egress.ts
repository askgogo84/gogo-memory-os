/**
 * Fail-closed, size-bounded transport for inbound WhatsApp PDF and ticket media
 * (pdf-reader.ts / pdf-reader-whatsapp.ts). Form-supplied MediaUrl0 is NOT a trusted
 * credential destination.
 *
 * Mirrors lib/services/twilio-image-note-egress.ts: Basic auth is built only for the
 * configured account's exact HTTPS api.twilio.com Media resource, redirects are manual,
 * and one Twilio media CDN hop (lib/services/twilio-cdn.ts) is followed WITHOUT
 * credentials. Origin checks are not DNS/IP pinning.
 */
import { isTwilioMediaCdnUrl, logRejectedTwilioRedirect } from './twilio-cdn'
import { META_DOCUMENT_TYPES, fetchMetaMedia, isMetaMediaRef } from '@/lib/channels/whatsapp-provider/meta-media'
export const TWILIO_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

const accountSidPattern = /^AC[0-9a-fA-F]{32}$/
const mediaPathPattern = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/(?:MM|SM)[0-9a-fA-F]{32}\/Media\/ME[0-9a-fA-F]{32}$/
const redirectCodes = new Set([301, 302, 303, 307, 308])

function exactTwilioMediaUrl(mediaUrl: string, accountSid: string): URL {
  if (!accountSidPattern.test(accountSid)) throw new Error('Invalid Twilio account identity')
  let url: URL
  try { url = new URL(mediaUrl) } catch { throw new Error('Invalid Twilio media URL') }
  if (url.origin !== 'https://api.twilio.com' || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Twilio media URL is outside the authorized API origin')
  }
  const match = mediaPathPattern.exec(url.pathname)
  if (!match || match[1] !== accountSid) throw new Error('Twilio media URL does not belong to the current account')
  return url
}

function exactTwilioCdnRedirect(location: string | null, previous: URL): URL {
  if (!location || location.length > 8192) throw new Error('Invalid Twilio media CDN redirect')
  let url: URL
  try { url = new URL(location, previous) } catch { throw new Error('Invalid Twilio media CDN redirect') }
  if (!isTwilioMediaCdnUrl(url)) {
    logRejectedTwilioRedirect('pdf-ticket', location)
    throw new Error('Twilio media redirect left approved CDN origin')
  }
  // Signed CDN query strings are allowed. No other host, scheme, or hop is.
  return url
}

async function readBoundedBody(res: Response): Promise<Buffer> {
  if (!res.ok || res.status !== 200) throw new Error('Twilio media download failed')
  const length = res.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length.trim())
      || !Number.isSafeInteger(Number(length)) || Number(length) > TWILIO_DOCUMENT_MAX_BYTES)) {
    throw new Error('Twilio media exceeds size limit')
  }
  // No unbounded arrayBuffer() fallback for an unknown/possibly forged server reply.
  if (!res.body) throw new Error('Twilio media body stream unavailable')
  const reader = res.body.getReader()
  const parts: Buffer[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > TWILIO_DOCUMENT_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('Twilio media exceeds size limit')
      }
      parts.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  if (!received) throw new Error('Twilio media empty')
  return Buffer.concat(parts, received)
}

/**
 * Validate the exact configured account's HTTPS REST media object BEFORE
 * constructing Basic credentials. The single permitted CDN redirect is always
 * anonymous and never follows redirects implicitly. No URL/secret logging.
 */
export async function fetchTwilioBoundDocumentMedia(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<Buffer> {
  // A Meta Cloud API media reference: fetched from Meta with the same size bound (see meta-media.ts). Images are
  // allowed because ticket photos are read through this helper too.
  if (isMetaMediaRef(mediaUrl)) {
    const media = await fetchMetaMedia(mediaUrl, { maxBytes: TWILIO_DOCUMENT_MAX_BYTES, allowedTypes: [...META_DOCUMENT_TYPES, 'image/jpeg', 'image/png', 'image/webp'] }, { fetchImpl: options.fetchImpl })
    if (!media) throw new Error('Meta media download failed')
    return Buffer.from(media.arrayBuffer)
  }
  const api = exactTwilioMediaUrl(mediaUrl, accountSid)
  if (!authToken) throw new Error('Twilio media credentials missing')
  const fetchImpl = options.fetchImpl || fetch
  const first = await fetchImpl(api.href, {
    headers: { Authorization: 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64') },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  if (!redirectCodes.has(first.status)) return readBoundedBody(first)
  const cdn = exactTwilioCdnRedirect(first.headers.get('location'), api)
  const second = await fetchImpl(cdn.href, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    // Intentionally no Authorization on CDN, even if the API was credentialed.
  })
  return readBoundedBody(second) // Rejects a second redirect and HTTP errors.
}
