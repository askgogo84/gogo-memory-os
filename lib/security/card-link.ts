// Signed links for per-user image cards (nutrition daily/weekly/report). 24 Oct sweep: the card routes returned any
// user's food logs for a telegram id in the path, and WhatsApp ids are derived from the phone number, so a stranger
// could read them. Links now carry ?t=<expiry>.<hmac> bound to the card kind and owner id. Web Crypto only, because
// the card routes run on the edge runtime.
const enc = new TextEncoder()
const TTL_SECONDS = 7 * 24 * 3600

function secret(env: Record<string, string | undefined> = process.env) {
  return String(env.CARD_LINK_SECRET || env.CRON_SECRET || '').trim()
}

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
  let s = ''
  for (const b of sig) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const payload = (kind: string, ownerId: string, exp: number) => `askgogo-card.v1.${kind}.${ownerId}.${exp}`

/** Token for ?t=. Returns null when no secret is configured (callers then send text instead of a card). */
export async function signCardToken(kind: string, ownerId: string | number, now = Date.now()): Promise<string | null> {
  const key = secret()
  if (!key || !/^-?[1-9]\d{0,15}$/.test(String(ownerId))) return null
  const exp = Math.floor(now / 1000) + TTL_SECONDS
  return `${exp}.${await hmac(key, payload(kind, String(ownerId), exp))}`
}

/** True only for an unexpired token signed for exactly this kind and owner. Fails closed without a secret. */
export async function verifyCardToken(kind: string, ownerId: string, token: string | null | undefined, now = Date.now()): Promise<boolean> {
  const key = secret()
  const m = String(token || '').match(/^([0-9]{9,11})\.([A-Za-z0-9_-]{43})$/)
  if (!key || !m || !/^-?[1-9]\d{0,15}$/.test(String(ownerId))) return false
  const exp = Number(m[1])
  if (!Number.isSafeInteger(exp) || exp * 1000 < now) return false
  const expected = await hmac(key, payload(kind, String(ownerId), exp))
  if (expected.length !== m[2].length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i)
  return diff === 0
}
