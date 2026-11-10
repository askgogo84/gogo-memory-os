// Inbound media on Meta Cloud API. A media message carries an id, not a URL: the id is resolved with the bearer token
// to a short-lived download URL on Meta's own host, which is then fetched with the same token. Fail closed:
// the token is sent only to graph.facebook.com and to Meta's media host, redirects are never followed, the size is
// bounded while streaming, and the content type must be on the caller's allowlist. Returns null on any doubt.
import { metaGraphBase } from './meta'
import { signatureEnforcementMode } from '@/lib/security/webhook-signature'

const REF_PREFIX = 'meta-media://'
/** The value carried in the pipeline's media URL field for a Meta media id. Not a fetchable URL on purpose. */
export function metaMediaRef(mediaId: string): string {
  const id = String(mediaId || '').trim()
  if (!/^\d{5,32}$/.test(id)) throw new Error('invalid_meta_media_id')
  return REF_PREFIX + id
}
export function metaMediaIdFromRef(ref: unknown): string | null {
  const value = String(ref ?? '')
  if (!value.startsWith(REF_PREFIX)) return null
  const id = value.slice(REF_PREFIX.length)
  return /^\d{5,32}$/.test(id) ? id : null
}
export const isMetaMediaRef = (ref: unknown) => metaMediaIdFromRef(ref) !== null

/** Meta's media download host. Anything else is rejected and its host name logged, so a new form is visible. */
export function isMetaMediaDownloadUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return false
  return url.hostname.toLowerCase() === 'lookaside.fbsbx.com' && url.pathname.length > 1
}

export type MetaMedia = { arrayBuffer: ArrayBuffer; contentType: string }
type Env = Record<string, string | undefined>
type Deps = { fetchImpl?: typeof fetch; env?: Env }
const mimeOf = (value: unknown) => String(value || '').split(';', 1)[0].trim().toLowerCase()

async function readBounded(res: Response, limit: number): Promise<ArrayBuffer | null> {
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
      if (count > limit) { await reader.cancel().catch(() => {}); return null }
      chunks.push(value)
    }
  } catch { return null }
  if (!count) return null
  const out = new Uint8Array(count)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out.buffer
}

/** Downloads one inbound media item. `allowedTypes` are bare MIME types (lower case). */
export async function fetchMetaMedia(ref: string, options: { maxBytes: number; allowedTypes: Iterable<string> }, deps: Deps = {}): Promise<MetaMedia | null> {
  const id = metaMediaIdFromRef(ref)
  const env = deps.env || (((globalThis as any).process?.env || {}) as Env)
  const token = (env.GOGO_META_WA_TOKEN || '').trim(), phoneId = (env.GOGO_META_WA_PHONE_ID || '').trim()
  // A media id is not a per-sender secret: the only thing tying it to a sender is that the reference was built from
  // a Meta-signed message and carried through the pipeline's signature gate. So nothing is fetched unless that gate
  // is strict, and the lookup is scoped to our own phone number id.
  if (signatureEnforcementMode(env) !== 'strict' || !/^\d{5,20}$/.test(phoneId)) return null
  const allowed = new Set([...options.allowedTypes].map(mimeOf))
  if (!id || !token || !Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0 || !allowed.size) return null
  const doFetch = deps.fetchImpl || fetch
  const headers = { Authorization: `Bearer ${token}` }
  try {
    const meta = await doFetch(`${metaGraphBase(env)}/${id}?phone_number_id=${phoneId}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (meta.status !== 200) { console.error('META_MEDIA_LOOKUP_FAILED:', JSON.stringify({ status: meta.status })); return null }
    const info: any = await meta.json().catch(() => null)
    const declared = mimeOf(info?.mime_type)
    if (!info || !allowed.has(declared)) return null
    if (info.file_size != null && (!Number.isSafeInteger(Number(info.file_size)) || Number(info.file_size) > options.maxBytes)) return null
    let url: URL
    try { url = new URL(String(info.url || '')) } catch { return null }
    if (!isMetaMediaDownloadUrl(url)) { console.error('META_MEDIA_HOST_REJECTED:', JSON.stringify({ host: url.hostname || 'none' })); return null }
    const res = await doFetch(url.toString(), { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    if (res.status !== 200) { console.error('META_MEDIA_DOWNLOAD_FAILED:', JSON.stringify({ status: res.status })); return null }
    const served = mimeOf(res.headers.get('content-type'))
    // The served type must also be allowed; Meta sometimes serves a generic type, in which case the declared one stands.
    const contentType = served && served !== 'application/octet-stream' && served !== 'binary/octet-stream' ? served : declared
    if (!allowed.has(contentType)) return null
    const arrayBuffer = await readBounded(res, options.maxBytes)
    return arrayBuffer ? { arrayBuffer, contentType } : null
  } catch { return null }
}

/** Document types accepted for reading (tickets, statements, office files). */
export const META_DOCUMENT_TYPES = [
  'application/pdf', 'application/octet-stream', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
]
