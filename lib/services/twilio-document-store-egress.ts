/**
 * Fail-closed, size-bounded transport for private Vault document uploads
 * (document-store.ts) and asset-memory PDF classification (asset-memory.ts).
 * A webhook media URL is NOT a trusted credential destination.
 *
 * Mirrors lib/services/twilio-image-note-egress.ts: Basic auth is built only for the
 * configured account's exact HTTPS api.twilio.com Media resource, redirects are manual,
 * and one Twilio media CDN hop (lib/services/twilio-cdn.ts) is followed WITHOUT
 * credentials. Origin checks are not DNS/IP pinning.
 */
import { isTwilioMediaCdnUrl, logRejectedTwilioRedirect } from './twilio-cdn'
import { fetchMetaMedia, isMetaMediaRef } from '@/lib/channels/whatsapp-provider/meta-media'
export const TWILIO_VAULT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

const accountSidPattern = /^AC[0-9a-fA-F]{32}$/
const mediaPathPattern = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/(?:MM|SM)[0-9a-fA-F]{32}\/Media\/ME[0-9a-fA-F]{32}$/
const redirectCodes = new Set([301, 302, 303, 307, 308])
const documentTypes = new Set([
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

function exactTwilioMediaUrl(mediaUrl: string, accountSid: string): URL {
  if (!accountSidPattern.test(accountSid)) throw new Error('Document media account unavailable')
  let url: URL
  try { url = new URL(mediaUrl) } catch { throw new Error('Invalid document media URL') }
  if (url.origin !== 'https://api.twilio.com' || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Document media origin is not allowed')
  }
  const match = mediaPathPattern.exec(url.pathname)
  if (!match || match[1] !== accountSid) throw new Error('Document media account or resource mismatch')
  return url
}

function exactTwilioCdnRedirect(location: string | null, previous: URL): URL {
  if (!location || location.length > 8192) throw new Error('Invalid Twilio document CDN redirect')
  let url: URL
  try { url = new URL(location, previous) } catch { throw new Error('Invalid Twilio document CDN redirect') }
  if (!isTwilioMediaCdnUrl(url)) {
    logRejectedTwilioRedirect('document-store', location)
    throw new Error('Twilio document CDN origin is not allowed')
  }
  // Signed CDN query strings are allowed. No other host, scheme, or hop is.
  return url
}

async function readBoundedDocument(res: Response): Promise<Buffer> {
  if (!res.ok || res.status !== 200) throw new Error('Twilio document media HTTP failure')
  const contentType = String(res.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (!documentTypes.has(contentType)) throw new Error('Unsupported Twilio document media type')
  const length = res.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length.trim())
      || !Number.isSafeInteger(Number(length)) || Number(length) > TWILIO_VAULT_DOCUMENT_MAX_BYTES)) {
    throw new Error('Twilio document media exceeds size limit')
  }
  if (!res.body) throw new Error('Twilio document media body unavailable')
  const reader = res.body.getReader()
  const parts: Buffer[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > TWILIO_VAULT_DOCUMENT_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('Twilio document media exceeds size limit')
      }
      parts.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  if (!received) throw new Error('Twilio document media empty')
  return Buffer.concat(parts, received)
}

/**
 * Validate the exact configured account's HTTPS REST media object BEFORE
 * constructing Basic credentials. The single permitted CDN redirect is always
 * anonymous and never follows redirects implicitly. No URL/secret logging.
 */
export async function fetchTwilioVaultDocumentMedia(args: {
  mediaUrl: string
  accountSid?: string | null
  authToken?: string | null
  fetchImpl?: typeof fetch
}): Promise<Buffer> {
  // A Meta Cloud API media reference: fetched from Meta with the same size and type bounds (see meta-media.ts).
  if (isMetaMediaRef(args.mediaUrl)) {
    const media = await fetchMetaMedia(args.mediaUrl, { maxBytes: TWILIO_VAULT_DOCUMENT_MAX_BYTES, allowedTypes: documentTypes }, { fetchImpl: args.fetchImpl })
    if (!media) throw new Error('Meta document media unavailable')
    return Buffer.from(media.arrayBuffer)
  }
  const accountSid = args.accountSid || ''
  const api = exactTwilioMediaUrl(args.mediaUrl, accountSid)
  if (!args.authToken) throw new Error('Document media credentials unavailable')
  const fetchImpl = args.fetchImpl || fetch
  const first = await fetchImpl(api.href, {
    headers: { Authorization: 'Basic ' + Buffer.from(accountSid + ':' + args.authToken).toString('base64') },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  if (!redirectCodes.has(first.status)) return readBoundedDocument(first)
  const cdn = exactTwilioCdnRedirect(first.headers.get('location'), api)
  const second = await fetchImpl(cdn.href, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    // Intentionally no Authorization on CDN, even if the API was credentialed.
  })
  return readBoundedDocument(second) // Rejects a second redirect, HTTP errors and unexpected types.
}
