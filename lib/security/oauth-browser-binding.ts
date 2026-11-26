// OAuth browser binding for the Google Calendar and Gmail connect flows (ports old PR #850 onto main).
//
// Problem: a signed OAuth state proves WHICH AskGogo account started the flow, not WHO finishes it. Someone could open
// their own connect link, copy the Google consent URL it redirects to and send it to another person; if that person
// consented, their Google token was saved to the first account (OAuth login CSRF), and a state could be replayed in
// any browser for its whole lifetime.
//
// Fix: the start route (the page the WhatsApp / dashboard link opens) sets a short-lived HttpOnly, Secure,
// SameSite=Lax cookie holding a random nonce plus an HMAC of that nonce tied to the exact OAuth state it issued. The
// callback refuses the state unless the browser presents a cookie whose HMAC matches that state. Callback responses
// clear the browser cookie. Google authorizes the code exchange and enforces single use of its authorization code.
// SameSite=Lax is required (not Strict): the callback is a top-level GET navigation coming from accounts.google.com.
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

export type OauthBindingFlow = 'calendar' | 'gmail'

// One cookie per callback, scoped to that callback's path, so Calendar and Gmail can be connected in parallel tabs.
const FLOWS: Record<OauthBindingFlow, { cookie: string; path: string }> = {
  calendar: { cookie: 'gogo_oauth_bind_cal', path: '/api/calendar/callback' },
  gmail: { cookie: 'gogo_oauth_bind_gmail', path: '/api/gmail/callback' },
}
// Matches the 10 minute OAuth state TTL in google-calendar.ts / google-gmail.ts.
export const OAUTH_BINDING_MAX_AGE_SECONDS = 10 * 60

export function oauthBindingCookieName(flow: OauthBindingFlow) {
  return FLOWS[flow].cookie
}

function bindingSecret(flow: OauthBindingFlow) {
  const gmailSecret = process.env.GMAIL_OAUTH_STATE_SECRET || process.env.CRON_SECRET || ''
  return flow === 'calendar' ? process.env.CALENDAR_OAUTH_STATE_SECRET || gmailSecret : gmailSecret
}

function bindingMac(flow: OauthBindingFlow, nonce: string, state: string): string | null {
  const secret = bindingSecret(flow)
  if (!secret) return null
  return createHmac('sha256', secret).update(`gogo-oauth-bind.v1|${flow}|${nonce}|${state}`).digest('base64url')
}

/** Cookie value for a freshly issued state: "v1.<nonce>.<hmac(nonce, state)>". Null when no secret is configured. */
export function issueOauthBinding(flow: OauthBindingFlow, state: string): string | null {
  if (!state) return null
  const nonce = randomBytes(18).toString('base64url')
  const mac = bindingMac(flow, nonce, state)
  return mac ? `v1.${nonce}.${mac}` : null
}

/** True only when this browser's cookie was issued for exactly this state. Fails closed on anything else. */
export function oauthBindingMatches(flow: OauthBindingFlow, state: string, cookieValue: string | undefined | null): boolean {
  if (!state || typeof cookieValue !== 'string' || !cookieValue) return false
  const parts = cookieValue.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) return false
  const expected = bindingMac(flow, parts[1], state)
  if (!expected) return false
  const a = Buffer.from(parts[2]), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Reads the binding cookie from a request; tolerant of request shapes without a cookie jar. */
export function readOauthBindingCookie(req: { cookies?: { get?: (name: string) => { value?: string } | undefined } }, flow: OauthBindingFlow) {
  try { return req?.cookies?.get?.(FLOWS[flow].cookie)?.value } catch { return undefined }
}

type CookieJar = { set: (name: string, value: string, opts: Record<string, unknown>) => unknown }
type WithCookies = { cookies?: CookieJar; headers?: Headers }

function cookieOptions(flow: OauthBindingFlow, maxAge: number) {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: FLOWS[flow].path, maxAge }
}

/**
 * Start route helper: binds the state inside `authUrl` to this browser. Returns false (caller answers 503) when the
 * state or binding cannot be produced, so an unbound Google URL is never handed out.
 */
export function setOauthBindingCookie(res: WithCookies, flow: OauthBindingFlow, authUrl: string): boolean {
  let state = ''
  try { state = new URL(authUrl).searchParams.get('state') || '' } catch { return false }
  const value = issueOauthBinding(flow, state)
  if (!value || !res?.cookies) return false
  res.cookies.set(FLOWS[flow].cookie, value, cookieOptions(flow, OAUTH_BINDING_MAX_AGE_SECONDS))
  res.headers?.set('Cache-Control', 'no-store')
  return true
}

/** Clear the browser's cookie on the callback response and keep the response out of caches. */
export function clearOauthBindingCookie<T extends WithCookies>(res: T, flow: OauthBindingFlow): T {
  res?.cookies?.set?.(FLOWS[flow].cookie, '', cookieOptions(flow, 0))
  res.headers?.set('Cache-Control', 'no-store')
  return res
}
