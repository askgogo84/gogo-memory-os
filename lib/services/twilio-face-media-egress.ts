/**
 * Fail-closed Twilio image download for inbound face cropping.
 *
 * Credentialed traffic is restricted to the exact HTTPS Twilio API account media
 * resource. A single approved Twilio CDN redirect is followed without Basic auth.
 * This does not pin DNS/IPs; independent review and benign Twilio compatibility
 * proof are mandatory before deployment.
 */
export const TWILIO_FACE_MAX_BYTES = 12 * 1024 * 1024

const accountPattern = /^AC[0-9a-fA-F]{32}$/
const mediaPath = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/(?:MM|SM)[0-9a-fA-F]{32}\/Media\/ME[0-9a-fA-F]{32}$/
const redirectStatuses = new Set([301, 302, 303, 307, 308])

function checkedApiUrl(mediaUrl: string, accountSid: string): URL {
  if (!accountPattern.test(accountSid)) throw new Error('Invalid Twilio media account')
  let url: URL
  try { url = new URL(mediaUrl) } catch { throw new Error('Invalid Twilio media URL') }
  if (url.origin !== 'https://api.twilio.com' || url.username || url.password || url.search || url.hash) {
    throw new Error('Media URL outside authorized Twilio origin')
  }
  const match = mediaPath.exec(url.pathname)
  if (!match || match[1] !== accountSid) throw new Error('Media URL outside authorized Twilio account')
  return url
}

function checkedCdnUrl(location: string | null): URL {
  if (!location || location.length > 8192) throw new Error('Unsafe Twilio media redirect')
  let url: URL
  try { url = new URL(location) } catch { throw new Error('Unsafe Twilio media redirect') }
  if (url.origin !== 'https://mms.twiliocdn.com' || url.username || url.password || url.hash || !url.pathname.startsWith('/')) {
    throw new Error('Twilio media redirect left authorized CDN origin')
  }
  return url
}

async function readBoundedImage(response: Response): Promise<{ buffer: Buffer; contentType: string }> {
  if (!response.ok || redirectStatuses.has(response.status)) throw new Error('Twilio media download failed')
  const contentType = response.headers.get('content-type') || ''
  if (!/^image\/(?:jpeg|png|webp|gif|heic|heif|bmp|tiff)(?:;|$)/i.test(contentType)) {
    throw new Error('Twilio media is not a supported image')
  }
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > TWILIO_FACE_MAX_BYTES)) {
    throw new Error('Twilio face image exceeds size limit')
  }
  if (!response.body) throw new Error('Twilio face image has no readable stream')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > TWILIO_FACE_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('Twilio face image exceeds size limit')
      }
      chunks.push(Buffer.from(value))
    }
    return { buffer: Buffer.concat(chunks, size), contentType }
  } finally {
    reader.releaseLock()
  }
}

export async function downloadTwilioFaceMedia(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ buffer: Buffer; contentType: string }> {
  const api = checkedApiUrl(mediaUrl, accountSid) // Before creating Basic credentials.
  if (!authToken) throw new Error('Twilio media authentication missing')
  const fetchImpl = options.fetchImpl || fetch
  const first = await fetchImpl(api.href, {
    headers: { Authorization: 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64') },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  })
  if (!redirectStatuses.has(first.status)) return readBoundedImage(first)

  const cdn = checkedCdnUrl(first.headers.get('location'))
  const second = await fetchImpl(cdn.href, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
    // No Basic Authorization header or auth token on this hop.
  })
  return readBoundedImage(second) // Also blocks a second redirect.
}
