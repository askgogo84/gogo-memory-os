/**
 * REVIEW-ONLY: private Vault document upload Twilio media transport.
 * A webhook media URL is untrusted even when its caller has Twilio credentials.
 * Validate exact configured account + HTTPS API media resource BEFORE Basic auth.
 * Permit one exact HTTPS Twilio media CDN redirect WITHOUT credentials.
 *
 * This protects origin/redirect/size boundaries, not DNS rebinding. Provider
 * URL compatibility and independent review are release gates for this draft.
 */
export const TWILIO_VAULT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

const mediaResource = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/((?:MM|SM)[0-9a-fA-F]{32})\/Media\/(ME[0-9a-fA-F]{32})$/
const redirectStatuses = new Set([301, 302, 303, 307, 308])
const documentMimeTypes = new Set([
  'application/pdf',
  'application/octet-stream',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'text/plain', 'text/csv',
])

function verifiedApiMediaUrl(raw: string, accountSid: string): URL {
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) throw new Error('Document media account unavailable')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Invalid document media URL') }
  if (url.origin !== 'https://api.twilio.com' || url.username || url.password || url.search || url.hash) {
    throw new Error('Document media origin is not allowed')
  }
  const match = mediaResource.exec(url.pathname)
  if (!match || match[1] !== accountSid) throw new Error('Document media account or resource mismatch')
  return url
}

function verifiedCdnRedirect(location: string | null): URL {
  if (!location || location.length > 8192) throw new Error('Invalid Twilio document CDN redirect')
  let url: URL
  try { url = new URL(location) } catch { throw new Error('Invalid Twilio document CDN redirect') }
  if (url.origin !== 'https://mms.twiliocdn.com'
    || url.username || url.password || url.hash || url.pathname === '/') {
    throw new Error('Twilio document CDN origin is not allowed')
  }
  return url
}

async function boundedDocumentBuffer(response: Response): Promise<Buffer> {
  if (!response.ok || response.status !== 200) throw new Error('Twilio document media HTTP failure')
  const mime = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (!documentMimeTypes.has(mime)) throw new Error('Unsupported Twilio document media type')
  const headerSize = response.headers.get('content-length')
  if (headerSize != null && (!/^\d+$/.test(headerSize.trim())
    || !Number.isSafeInteger(Number(headerSize))
    || Number(headerSize) > TWILIO_VAULT_DOCUMENT_MAX_BYTES)) {
    throw new Error('Twilio document media exceeds size limit')
  }
  if (!response.body) throw new Error('Twilio document media body unavailable')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > TWILIO_VAULT_DOCUMENT_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('Twilio document media exceeds size limit')
      }
      chunks.push(Buffer.from(value))
    }
    if (size === 0) throw new Error('Twilio document media empty')
    return Buffer.concat(chunks, size)
  } finally {
    reader.releaseLock()
  }
}

/**
 * Uses only an injected synthetic transport in tests. In production, the
 * first request's Basic credentials never leave api.twilio.com; redirects
 * cannot inherit Authorization or silently follow to a third destination.
 * Throws static error messages only; never include user URLs or credentials.
 */
export async function fetchTwilioVaultDocumentMedia(args: {
  mediaUrl: string
  accountSid?: string | null
  authToken?: string | null
  fetchImpl?: typeof fetch
}): Promise<Buffer> {
  const sid = args.accountSid || ''
  const api = verifiedApiMediaUrl(args.mediaUrl, sid) // BEFORE Basic header construction.
  if (!args.authToken) throw new Error('Document media credentials unavailable')
  const fetchImpl = args.fetchImpl || fetch
  const header = 'Basic ' + Buffer.from(sid + ':' + args.authToken).toString('base64')
  const response = await fetchImpl(api.href, {
    headers: { Authorization: header },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  if (!redirectStatuses.has(response.status)) return boundedDocumentBuffer(response)
  const cdn = verifiedCdnRedirect(response.headers.get('location'))
  const cdnResponse = await fetchImpl(cdn.href, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    // NEVER forward the credentialed headers to the signed media CDN.
  })
  return boundedDocumentBuffer(cdnResponse) // 2nd redirect is rejected.
}
