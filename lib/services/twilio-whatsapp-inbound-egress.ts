/**
 * Fail-closed media downloader for the three direct image/audio download sites
 * in the inbound WhatsApp webhook. Never send Twilio Basic credentials to a
 * URL merely because it arrived in webhook form metadata.
 *
 * This is a scoped security draft, not a claim that provider URL formats or
 * production UX have been independently accepted. Real credentials/media are
 * deliberately not needed by the injected synthetic regression tests.
 */
export const TWILIO_WHATSAPP_IMAGE_MAX_BYTES = 12 * 1024 * 1024
export const TWILIO_WHATSAPP_AUDIO_MAX_BYTES = 20 * 1024 * 1024

const accountSidPattern = /^AC[0-9a-fA-F]{32}$/
const messageSidPattern = /^(?:MM|SM)[0-9a-fA-F]{32}$/
const mediaSidPattern = /^ME[0-9a-fA-F]{32}$/
const mediaPathPattern = /^\/2010-04-01\/Accounts\/(AC[0-9a-fA-F]{32})\/Messages\/((?:MM|SM)[0-9a-fA-F]{32})\/Media\/(ME[0-9a-fA-F]{32})$/
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const audioTypes = new Set([
  'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac',
  'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/webm',
  'audio/amr', 'audio/x-m4a', 'application/ogg', 'video/mp4',
])

export type InboundTwilioMediaKind = 'image' | 'audio'
export type InboundTwilioMedia = { arrayBuffer: ArrayBuffer; contentType: string }

function validApiMediaUrl(mediaUrl: string, accountSid: string): URL | null {
  if (!accountSidPattern.test(accountSid) || typeof mediaUrl !== 'string') return null
  try {
    const url = new URL(mediaUrl)
    if (url.origin !== 'https://api.twilio.com'
      || url.username || url.password || url.search || url.hash) return null
    const match = url.pathname.match(mediaPathPattern)
    if (!match || match[1] !== accountSid
      || !messageSidPattern.test(match[2])
      || !mediaSidPattern.test(match[3])) return null
    return url
  } catch {
    return null
  }
}

function validCdnRedirect(location: string, previous: URL): URL | null {
  try {
    const url = new URL(location, previous)
    if (url.origin !== 'https://mms.twiliocdn.com'
      || url.username || url.password || url.hash || url.pathname === '/') return null
    return url
  } catch {
    return null
  }
}

function expectedContentType(value: string | null, kind: InboundTwilioMediaKind): string | null {
  const mime = String(value || '').split(';', 1)[0].trim().toLowerCase()
  return (kind === 'image' ? imageTypes : audioTypes).has(mime) ? mime : null
}

async function readBoundedBody(res: Response, limit: number): Promise<ArrayBuffer | null> {
  const length = res.headers.get('content-length')
  if (length != null && (!/^\d+$/.test(length.trim()) || Number(length) > limit)) return null
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let count = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      count += value.byteLength
      if (count > limit) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
    if (!count) return null
    const complete = new Uint8Array(count)
    let offset = 0
    for (const part of chunks) {
      complete.set(part, offset)
      offset += part.byteLength
    }
    return complete.buffer as ArrayBuffer
  } finally {
    reader.releaseLock()
  }
}

/**
 * First request goes ONLY to the exact Twilio REST API media object and has
 * Basic auth. The single allowed 302/3xx hop goes ONLY to Twilio's exact CDN
 * and is explicitly made WITHOUT an Authorization header. No implicit hops.
 * Failures return null; no URL or credentials are logged.
 */
export async function downloadTwilioWhatsappInboundMedia(args: {
  mediaUrl: string
  accountSid?: string | null
  authToken?: string | null
  kind: InboundTwilioMediaKind
  fetchImpl?: typeof fetch
}): Promise<InboundTwilioMedia | null> {
  const accountSid = args.accountSid || ''
  const token = args.authToken || ''
  const first = validApiMediaUrl(args.mediaUrl, accountSid)
  if (!first || !token || (args.kind !== 'image' && args.kind !== 'audio')) return null

  const limit = args.kind === 'image'
    ? TWILIO_WHATSAPP_IMAGE_MAX_BYTES : TWILIO_WHATSAPP_AUDIO_MAX_BYTES
  const fetchImpl = args.fetchImpl || fetch
  try {
    const basic = Buffer.from(`${accountSid}:${token}`).toString('base64')
    let res = await fetchImpl(first.toString(), {
      headers: { Authorization: `Basic ${basic}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location')
      const cdn = location && validCdnRedirect(location, first)
      if (!cdn) return null
      res = await fetchImpl(cdn.toString(), {
        // Never forward SID/token to the CDN, even if the API URL redirects.
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
    }
    if (!res.ok || res.status !== 200) return null // includes a second redirect
    const contentType = expectedContentType(res.headers.get('content-type'), args.kind)
    if (!contentType) return null
    const arrayBuffer = await readBoundedBody(res, limit)
    return arrayBuffer ? { arrayBuffer, contentType } : null
  } catch {
    // Includes malformed bodies, aborted fetches, closed streams, and network failures.
    return null
  }
}
