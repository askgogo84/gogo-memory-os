/**
 * Fail-closed, size-bounded transport for WhatsApp image notes and receipt
 * readers. Form-supplied MediaUrl0 is NOT a trusted credential destination.
 *
 * This is an isolated REVIEW-ONLY containment; genuine Twilio CDN response
 * formats and image UX still need owner-approved provider compatibility review.
 * Origin checks are not DNS/IP pinning.
 */
export const TWILIO_IMAGE_NOTE_MAX_BYTES = 18 * 1024 * 1024

const accountSidPattern = /^AC[0-9a-fA-F]{32}$/
const mediaPathPattern = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/(?:MM|SM)[0-9a-fA-F]{32}\/Media\/ME[0-9a-fA-F]{32}$/
const redirectCodes = new Set([301, 302, 303, 307, 308])
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function exactTwilioMediaUrl(mediaUrl: string, accountSid: string): URL {
  if (!accountSidPattern.test(accountSid)) throw new Error('twilio_image_account_invalid')
  let url: URL
  try { url = new URL(mediaUrl) } catch { throw new Error('twilio_image_url_invalid') }
  if (url.origin !== 'https://api.twilio.com' || url.username || url.password || url.search || url.hash) {
    throw new Error('twilio_image_url_not_authorized')
  }
  const match = mediaPathPattern.exec(url.pathname)
  if (!match || match[1] !== accountSid) throw new Error('twilio_image_account_mismatch')
  return url
}

function exactTwilioCdnRedirect(location: string | null, previous: URL): URL {
  if (!location || location.length > 8192) throw new Error('twilio_image_redirect_invalid')
  let url: URL
  try { url = new URL(location, previous) } catch { throw new Error('twilio_image_redirect_invalid') }
  if (url.origin !== 'https://mms.twiliocdn.com' || url.username || url.password || url.hash || url.pathname === '/') {
    throw new Error('twilio_image_redirect_not_authorized')
  }
  // Signed CDN query strings are allowed. No other host, scheme, or hop is.
  return url
}

async function readBoundedImage(res: Response): Promise<{ bytes: Buffer; contentType: string }> {
  if (!res.ok || res.status !== 200) throw new Error('twilio_image_download_failed')
  const contentType = String(res.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (!imageTypes.has(contentType)) throw new Error('twilio_image_type_rejected')
  const length = res.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length.trim())
      || !Number.isSafeInteger(Number(length)) || Number(length) > TWILIO_IMAGE_NOTE_MAX_BYTES)) {
    throw new Error('twilio_image_too_large')
  }
  if (!res.body) throw new Error('twilio_image_stream_missing')
  const reader = res.body.getReader()
  const parts: Buffer[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > TWILIO_IMAGE_NOTE_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('twilio_image_too_large')
      }
      parts.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  if (!received) throw new Error('twilio_image_empty')
  return { bytes: Buffer.concat(parts, received), contentType }
}

/**
 * Validate the exact configured account's HTTPS REST media object BEFORE
 * constructing Basic credentials. The single permitted CDN redirect is always
 * anonymous and never follows redirects implicitly. No URL/secret logging.
 */
export async function fetchTwilioImageNote(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ bytes: Buffer; contentType: string }> {
  const api = exactTwilioMediaUrl(mediaUrl, accountSid)
  if (!authToken) throw new Error('twilio_image_credentials_missing')
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
