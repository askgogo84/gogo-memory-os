import { createHash, createHmac, randomBytes } from 'node:crypto'

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const scope = 'ask:read'
export const enabled = () => process.env.GOGO_TV_PAIRING === '1'

export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const newToken = () => 'gtv_' + randomBytes(32).toString('base64url')
export const newCode = (length = 16) => Array.from(randomBytes(length), byte => alphabet[byte & 31]).join('')
export const newQrCode = () => randomBytes(16).toString('base64url')
export const newPollProof = () => 'gtp_' + randomBytes(32).toString('base64url')
export function pairingCode(value: unknown, length = 16) {
  if (typeof value !== 'string' || value.length > 32) return null
  const code = value.toUpperCase().replace(/[ -]/g, '')
  return code.length === length && /^[0-9A-HJKMNP-TV-Z]+$/.test(code) ? code : null
}

export function tokenHash(request: Request) {
  const token = /^Bearer (gtv_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1]
  return token ? hash(token) : null
}

export function pollHash(request: Request) {
  const proof = /^Bearer (gtp_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1]
  return proof ? hash(proof) : null
}

export function shortCodeHash(code: string) {
  const key = process.env.GOGO_TV_RATE_KEY
  return key && key.length >= 32 ? createHmac('sha256', key).update('tv-code:' + code).digest('hex') : null
}

export function sourceHash(request: Request) {
  const key = process.env.GOGO_TV_RATE_KEY
  if (!key || key.length < 32) return null
  const address = process.env.VERCEL
    ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
    : process.env.GOGO_TV_LOCAL_TEST === '1' ? 'local-test' : undefined
  return address ? createHmac('sha256', key).update(address).digest('hex') : null
}

export const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function boundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader()
  if (!reader) return null
  const result = new Uint8Array(limit)
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return result.slice(0, size)
      if (size + value.length > limit) {
        await reader.cancel()
        return null
      }
      result.set(value, size)
      size += value.length
    }
  } finally {
    reader.releaseLock()
  }
}

export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const bytes = await boundedBody(request, 4096)
    const value = bytes && JSON.parse(new TextDecoder().decode(bytes))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}
