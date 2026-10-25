/**
 * Review-only containment of social media-memory Twilio thumbnail egress.
 * No caller-provided URL may receive Basic credentials without exact account,
 * origin and Twilio Messaging Media resource validation. A single CDN hop
 * is allowed without Authorization; redirects never follow implicitly.
 *
 * Benign provider-format compatibility and independent SSRF review remain
 * prerequisites for release. No DNS pinning is claimed.
 */
export const MEDIA_MEMORY_THUMBNAIL_MAX_BYTES = 12 * 1024 * 1024

export type ThumbnailImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

const mediaPath = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/(?:MM|SM)[0-9a-fA-F]{32}\/Media\/ME[0-9a-fA-F]{32}$/
const sidPattern = /^AC[0-9a-fA-F]{32}$/
const redirectStatuses = new Set([301, 302, 303, 307, 308])
const acceptedMimes = new Set<ThumbnailImageMime>(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function verifiedTwilioMediaUrl(raw: string, sid: string): URL | null {
  if (!sidPattern.test(sid) || typeof raw !== 'string' || raw.length > 4096) return null
  try {
    const u = new URL(raw)
    if (u.origin !== 'https://api.twilio.com' || u.username || u.password || u.search || u.hash) return null
    const m = mediaPath.exec(u.pathname)
    return m?.[1] === sid ? u : null
  } catch {
    return null
  }
}

function verifiedCdnLocation(raw: string | null): URL | null {
  if (!raw || raw.length > 8192) return null
  try {
    // Absolute HTTPS CDN locations only; relative URLs could re-authenticate.
    const u = new URL(raw)
    return u.origin === 'https://mms.twiliocdn.com'
      && !u.username && !u.password && !u.hash && u.pathname !== '/' ? u : null
  } catch {
    return null
  }
}

async function readImage(response: Response): Promise<{ base64: string; mediaType: ThumbnailImageMime } | null> {
  if (response.status !== 200 || !response.ok) return null
  const type = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase() as ThumbnailImageMime
  if (!acceptedMimes.has(type)) return null

  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))
    || Number(length) > MEDIA_MEMORY_THUMBNAIL_MAX_BYTES)) return null

  const reader = response.body?.getReader()
  if (!reader) return null
  let bytes = 0
  const parts: Buffer[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      if (bytes > MEDIA_MEMORY_THUMBNAIL_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        return null
      }
      parts.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  if (!bytes) return null
  return { base64: Buffer.concat(parts, bytes).toString('base64'), mediaType: type }
}

/**
 * The initial, Basic-authenticated request is restricted to Twilio's exact
 * configured-account media object. A single redirect may go ONLY to
 * mms.twiliocdn.com, without forwarding credentials.
 *
 * All expected rejection and failure paths return null, so the caller can
 * continue saving caption/notes/semantic memory without image vision.
 */
export async function downloadTwilioMemoryThumbnail(args: {
  mediaUrl: string
  accountSid: string
  authToken: string
  fetchImpl?: typeof fetch
}): Promise<{ base64: string; mediaType: ThumbnailImageMime } | null> {
  const apiUrl = verifiedTwilioMediaUrl(args.mediaUrl, args.accountSid)
  if (!apiUrl || !args.authToken) return null
  const fetchImpl = args.fetchImpl || fetch
  try {
    const basic = Buffer.from(args.accountSid + ':' + args.authToken).toString('base64')
    let res = await fetchImpl(apiUrl.href, {
      headers: { Authorization: 'Basic ' + basic },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    if (redirectStatuses.has(res.status)) {
      const cdn = verifiedCdnLocation(res.headers.get('location'))
      if (!cdn) return null
      res = await fetchImpl(cdn.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        // NO Authorization, even if the CDN redirects again.
      })
    }
    return await readImage(res)
  } catch {
    return null
  }
}
