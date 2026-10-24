/**
 * Review-only containment for inbound Twilio PDF/ticket media.
 * The credential-bearing hop must stay on the exact Twilio account media API.
 * A documented Twilio CDN redirect is fetched only once, WITHOUT Basic auth.
 *
 * Hostname checks do NOT pin DNS/IPs. Release requires separate security review
 * and a harmless Twilio media compatibility test; do not silently broaden hosts.
 */
export const TWILIO_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

const mediaPath = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/(?:MM|SM)[0-9a-fA-F]{32}\/Media\/ME[0-9a-fA-F]{32}$/
const redirects = new Set([301, 302, 303, 307, 308])

function accountMediaUrl(mediaUrl: string, accountSid: string): URL {
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) throw new Error('Invalid Twilio account identity')
  let url: URL
  try { url = new URL(mediaUrl) } catch { throw new Error('Invalid Twilio media URL') }
  if (url.origin !== 'https://api.twilio.com' || url.username || url.password || url.search || url.hash) {
    throw new Error('Twilio media URL is outside the authorized API origin')
  }
  const match = mediaPath.exec(url.pathname)
  if (!match || match[1] !== accountSid) throw new Error('Twilio media URL does not belong to the current account')
  return url
}

function verifiedCdnLocation(value: string | null): URL {
  if (!value || value.length > 8192) throw new Error('Invalid Twilio media CDN redirect')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Invalid Twilio media CDN redirect') }
  if (url.origin !== 'https://mms.twiliocdn.com' || url.username || url.password || url.hash || !url.pathname.startsWith('/')) {
    throw new Error('Twilio media redirect left approved CDN origin')
  }
  return url
}

async function boundedBody(res: Response): Promise<Buffer> {
  if (!res.ok || redirects.has(res.status)) throw new Error('Twilio media download failed')
  const lengthHeader = res.headers.get('content-length')
  if (lengthHeader !== null) {
    if (!/^\d+$/.test(lengthHeader) || !Number.isSafeInteger(Number(lengthHeader)) || Number(lengthHeader) > TWILIO_DOCUMENT_MAX_BYTES) {
      throw new Error('Twilio media exceeds size limit')
    }
  }
  // No unbounded arrayBuffer() fallback for an unknown/possibly forged server reply.
  if (!res.body) throw new Error('Twilio media body stream unavailable')
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
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
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, received)
  } finally {
    reader.releaseLock()
  }
}

export async function fetchTwilioBoundDocumentMedia(
  mediaUrl: string,
  accountSid: string,
  authToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<Buffer> {
  const api = accountMediaUrl(mediaUrl, accountSid) // Validate BEFORE constructing Basic credentials.
  if (!authToken) throw new Error('Twilio media credentials missing')
  const fetchImpl = options.fetchImpl || fetch
  const apiResponse = await fetchImpl(api.href, {
    headers: { Authorization: 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64') },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  })
  if (!redirects.has(apiResponse.status)) return boundedBody(apiResponse)

  const cdn = verifiedCdnLocation(apiResponse.headers.get('location'))
  const cdnResponse = await fetchImpl(cdn.href, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
    // Intentionally NO Authorization or bearer/account identifiers on the CDN hop.
  })
  return boundedBody(cdnResponse) // Reject all second-hop redirects, including to private IPs.
}
