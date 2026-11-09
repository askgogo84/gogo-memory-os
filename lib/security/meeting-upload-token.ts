import { createHmac, timingSafeEqual } from 'node:crypto'

// The meeting recorder (public/record.html) uploads audio for the WhatsApp number
// in its link. A phone in an unauthenticated multipart body is a TARGET, not proof
// of ownership: without a binding, anyone could make AskGogo message, transcribe
// for, and write notes into an arbitrary owner's account. The link Gogo sends the
// owner on WhatsApp therefore carries a short-lived HMAC token bound to that exact
// normalized number; the upload route verifies it before any side effect.
// Keyed from the already-provisioned CRON_SECRET with a domain label, so the token
// can never be replayed as a cron/internal credential. Fails closed when unset.

const TOKEN_TTL_SECONDS = 24 * 60 * 60
const DOMAIN = 'askgogo:meeting-upload:v1'

export function meetingUploadE164(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.startsWith('91') ? '+' + digits
    : digits.length === 10 ? '+91' + digits
    : '+' + digits
}

function signingKey(env: Record<string, string | undefined>): string {
  const secret = String(env.CRON_SECRET || '').trim()
  return secret ? `${DOMAIN}:${secret}` : ''
}

function mac(key: string, e164: string, exp: string): string {
  return createHmac('sha256', key).update(`${DOMAIN}\n${e164}\n${exp}`, 'utf8').digest('hex')
}

/** Token for a recorder link, or '' when no signing secret is configured. */
export function signMeetingUploadToken(
  phone: string,
  nowMs: number = Date.now(),
  env: Record<string, string | undefined> = process.env,
): string {
  const key = signingKey(env)
  const e164 = meetingUploadE164(phone)
  if (!key || !e164) return ''
  const exp = String(Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS)
  return `${exp}.${mac(key, e164, exp)}`
}

/** True only for an unexpired token minted for exactly this normalized number. */
export function verifyMeetingUploadToken(
  token: string | null | undefined,
  phone: string,
  nowMs: number = Date.now(),
  env: Record<string, string | undefined> = process.env,
): boolean {
  const key = signingKey(env)
  const e164 = meetingUploadE164(phone)
  const match = /^(\d{10,12})\.([a-f0-9]{64})$/.exec(String(token || ''))
  if (!key || !e164 || !match) return false
  const [, exp, supplied] = match
  const expSeconds = Number(exp)
  const nowSeconds = Math.floor(nowMs / 1000)
  if (!Number.isSafeInteger(expSeconds) || expSeconds < nowSeconds || expSeconds > nowSeconds + TOKEN_TTL_SECONDS) return false
  const expected = Buffer.from(mac(key, e164, exp), 'hex')
  const given = Buffer.from(supplied, 'hex')
  return expected.length === given.length && timingSafeEqual(expected, given)
}
