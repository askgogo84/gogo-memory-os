// OAuth browser binding (CALENDAR-OAUTH-OWNER-01, follow-ups F1/F2, 24 Oct).
//
// Problem: a signed OAuth state proves WHICH AskGogo account started the flow, but not WHO finishes it. An attacker
// could open their own connect link, copy the resulting Google URL and send it to a victim; if the victim consented,
// the victim's Google token was saved to the attacker's account (OAuth CSRF), and a state could be replayed for its
// whole lifetime.
//
// Fix: the connect route sets a random nonce in an HttpOnly, Secure, SameSite=Lax cookie scoped to the callback path
// and puts only its SHA-256 hash in the signed state. The callback accepts the state only when the same browser
// presents the matching nonce, then clears the cookie, so each state completes once, in the browser that started it.
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export const OAUTH_BIND_COOKIE = 'gogo_oauth_bind'
const MAX_AGE_SECONDS = 15 * 60

export function newOauthBinding() {
  const nonce = randomBytes(24).toString('base64url')
  return { nonce, hash: bindingHash(nonce) }
}

export function bindingHash(nonce: string) {
  return createHash('sha256').update(`gogo-oauth-bind.v1.${nonce}`).digest('base64url')
}

/** True only when the browser's cookie nonce hashes to the value signed into the state. */
export function bindingMatches(cookieNonce: string | undefined | null, signedHash: string | undefined | null) {
  if (!cookieNonce || !signedHash || typeof signedHash !== 'string') return false
  const a = Buffer.from(bindingHash(String(cookieNonce)))
  const b = Buffer.from(signedHash)
  return a.length === b.length && timingSafeEqual(a, b)
}

type CookieJar = { set: (name: string, value: string, opts: Record<string, unknown>) => unknown }

/** The cookie is sent to every /api callback path that may finish a Google flow (calendar and gmail). */
export function setBindingCookie(cookies: CookieJar, nonce: string) {
  cookies.set(OAUTH_BIND_COOKIE, nonce, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api', maxAge: MAX_AGE_SECONDS })
}

export function clearBindingCookie(cookies: CookieJar) {
  cookies.set(OAUTH_BIND_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/api', maxAge: 0 })
}
