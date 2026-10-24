/**
 * Fail-closed inbound Twilio nutrition image downloader.
 * Credentialed traffic may only reach the exact HTTPS Twilio account media API.
 * One HTTPS mms.twiliocdn.com redirect is permitted without Basic credentials.
 * DNS/IP pinning and real provider URL compatibility require security review.
 */
export const NUTRITION_IMAGE_MAX_BYTES = 12 * 1024 * 1024

const sidPattern = /^AC[0-9a-fA-F]{32}$/
const mediaPathPattern = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/(?:MM|SM)[0-9a-fA-F]{32}\/Media\/ME[0-9a-fA-F]{32}$/
const redirectStatuses = new Set([301, 302, 303, 307, 308])

function validateTwilioApi(mediaUrl: string, accountSid: string): URL {
  if (!sidPattern.test(accountSid)) throw new Error('Invalid Twilio nutrition account')
  let url: URL
  try { url = new URL(mediaUrl) } catch { throw new Error('Invalid Twilio nutrition image URL') }
  if (url.origin !== 'https://api.twilio.com' || url.username || url.password || url.search || url.hash) {
    throw new Error('Twilio nutrition media URL is not an authorized API origin')
  }
  const match = mediaPathPattern.exec(url.pathname)
  if (!match || match[1] !== accountSid) throw new Error('Twilio nutrition media URL does not match account')
  return url
}

function validateTwilioCdn(location: string | null): URL {
  if (!location || location.length > 8192) throw new Error('Unsafe Twilio nutrition media redirect')
  let url: URL
  try { url = new URL(location) } catch { throw new Error('Unsafe Twilio nutrition media redirect') }
  if (url.origin !== 'https://mms.twiliocdn.com' || url.username || url.password || url.hash || url.pathname === '/') {
    throw new Error('Twilio nutrition media redirect escaped permitted CDN')
  }
  return url
}

async function readBoundedImage(response: Response): Promise<{ data: Buffer; contentType: string }> {
  if (!response.ok || redirectStatuses.has(response.status)) throw new Error('Twilio nutrition image download failed')
  const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (!/^(?:image\/jpeg|image\/png|image\/webp|image\/gif)$/.test(contentType)) {
    throw new Error('Unsupported Twilio nutrition image content type')
  }
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > NUTRITION_IMAGE_MAX_BYTES)) {
    throw new Error('Twilio nutrition image exceeds size limit')
  }
  if (!response.body) throw new Error('Twilio nutrition image response has no readable stream')
  const reader = response.body.getReader()
  const pieces: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > NUTRITION_IMAGE_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('Twilio nutrition image exceeds size limit')
      }
      pieces.push(Buffer.from(value))
    }
    return { data: Buffer.concat(pieces, total), contentType }
  } finally {
    reader.releaseLock()
  }
}

export async function downloadTwilioNutritionImage(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ data: Buffer; contentType: string }> {
  // Validate untrusted webhook MediaUrl before even constructing the Basic header.
  const api = validateTwilioApi(mediaUrl, accountSid)
  if (!authToken) throw new Error('Twilio nutrition credentials unavailable')
  const fetchImpl = options.fetchImpl || fetch
  const first = await fetchImpl(api.href, {
    headers: { Authorization: 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64') },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  if (!redirectStatuses.has(first.status)) return readBoundedImage(first)
  const cdn = validateTwilioCdn(first.headers.get('location'))
  // Never forward the Authorization header (or token) to the CDN.
  const second = await fetchImpl(cdn.href, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  return readBoundedImage(second) // Rejects a second redirect.
}
