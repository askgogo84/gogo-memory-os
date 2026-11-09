/**
 * Review-only fail-closed downloader for WhatsApp social-preview images.
 * Do not pass Twilio Basic credentials to user-controlled origins/redirects.
 * No DNS/IP pinning: security review and benign Twilio URL compatibility proof
 * are prerequisites for any production rollout.
 */
export const TWILIO_SOCIAL_PREVIEW_MAX_BYTES = 12 * 1024 * 1024

const accountSidPattern = /^AC[0-9a-fA-F]{32}$/
const mediaPathPattern = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/(?:MM|SM)[0-9a-fA-F]{32}\/Media\/ME[0-9a-fA-F]{32}$/
const redirects = new Set([301, 302, 303, 307, 308])
const mimePattern = /^image\/(?:jpeg|png|webp|gif|heic|heif|bmp|tiff)$/

function checkedTwilioUrl(raw: string, accountSid: string): URL {
  if (!accountSidPattern.test(accountSid)) throw new Error('Twilio account SID not valid')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Twilio media URL not valid') }
  if (url.origin !== 'https://api.twilio.com' || url.username || url.password || url.search || url.hash) {
    throw new Error('Twilio media URL not an approved HTTPS API origin')
  }
  const match = mediaPathPattern.exec(url.pathname)
  if (!match || match[1] !== accountSid) throw new Error('Twilio media URL not associated with configured account')
  return url
}

function checkedCdnRedirect(location: string | null): URL {
  if (!location || location.length > 8192) throw new Error('Invalid Twilio CDN redirect')
  let url: URL
  try { url = new URL(location) } catch { throw new Error('Invalid Twilio CDN redirect') }
  if (url.origin !== 'https://mms.twiliocdn.com' || url.username || url.password || url.hash || url.pathname === '/') {
    throw new Error('Twilio media redirected outside approved HTTPS CDN')
  }
  return url
}

async function readBoundedImage(response: Response): Promise<{ buffer: Buffer; contentType: string }> {
  if (!response.ok || redirects.has(response.status)) throw new Error('Twilio media request was not successful')
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!mimePattern.test(contentType)) throw new Error('Twilio social-preview media was not an image')
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > TWILIO_SOCIAL_PREVIEW_MAX_BYTES)) {
    throw new Error('Twilio social-preview image exceeded byte limit')
  }
  if (!response.body) throw new Error('Twilio social-preview image has no readable stream')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      if (bytes > TWILIO_SOCIAL_PREVIEW_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('Twilio social-preview image exceeded byte limit')
      }
      chunks.push(Buffer.from(value))
    }
    return { buffer: Buffer.concat(chunks, bytes), contentType }
  } finally {
    reader.releaseLock()
  }
}

export async function downloadTwilioSocialPreviewImage(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ buffer: Buffer; contentType: string }> {
  const apiUrl = checkedTwilioUrl(mediaUrl, accountSid) // Authenticate URL before Basic is constructed.
  if (!authToken) throw new Error('Twilio media credentials missing')
  const fetchImpl = options.fetchImpl || fetch
  const first = await fetchImpl(apiUrl.href, {
    headers: { Authorization: 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64') },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  })
  if (!redirects.has(first.status)) return readBoundedImage(first)
  const cdnUrl = checkedCdnRedirect(first.headers.get('location'))
  const second = await fetchImpl(cdnUrl.href, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
    // Intentionally no Authorization on CDN; second redirects are rejected.
  })
  return readBoundedImage(second)
}
