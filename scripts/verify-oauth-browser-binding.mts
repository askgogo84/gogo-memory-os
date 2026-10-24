// OAuth browser binding (CALENDAR-OAUTH-OWNER-01 follow-ups F1/F2, 24 Oct). Offline: Google and Supabase are mocked.
// Run: npx tsx scripts/verify-oauth-browser-binding.mts
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic'
process.env.CALENDAR_OAUTH_STATE_SECRET = 'synthetic-calendar-binding-secret'
process.env.GMAIL_OAUTH_STATE_SECRET = 'synthetic-gmail-binding-secret'
process.env.GOOGLE_CLIENT_ID = 'synthetic-client'
process.env.GOOGLE_CLIENT_SECRET = 'synthetic-secret'
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

const { NextRequest } = await import('next/server')
const cal = await import('../lib/services/google-calendar')
const gm = await import('../lib/services/google-gmail')
const B = await import('../lib/security/oauth-browser-binding')
const calConnect = await import('../app/api/calendar/connect/route')
const calLegacy = await import('../app/calendar/route')
const calCallback = await import('../app/api/calendar/callback/route')
const gmConnect = await import('../app/api/gmail/connect/route')
const gmSendConnect = await import('../app/api/gmail/send/connect/route')
const gmCallback = await import('../app/api/gmail/callback/route')

const req = (path: string, cookie?: string) => new NextRequest(new URL(path, 'https://app.askgogo.in'), cookie ? { headers: { cookie } } : undefined)
const bindCookie = (res: Response) => {
  const raw = res.headers.get('set-cookie') || ''
  const m = raw.match(new RegExp(`${B.OAUTH_BIND_COOKIE}=([^;]*)`))
  return { raw, value: m ? decodeURIComponent(m[1]) : null }
}
const stateOf = (res: Response) => new URL(res.headers.get('location') || 'https://x.invalid').searchParams.get('state') || ''

const writes: string[] = []
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input)
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/gmail.send' }))
  if (url.includes('googleapis.com')) return new Response(JSON.stringify({ id: 'synthetic@example.com', email: 'synthetic@example.com', items: [{ id: 'synthetic@example.com', primary: true }] }))
  if (url.startsWith('https://synthetic.supabase.co/rest/v1/')) {
    const method = init?.method || 'GET'
    if (method !== 'GET') writes.push(`${method} ${decodeURIComponent(new URL(url).search)}`)
    return new Response(method === 'GET' ? 'null' : '[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}) as any

const ATTACKER = -111111111, VICTIM = -222222222

// 1. Helper: the cookie nonce must hash to the signed value; anything else fails.
const b = B.newOauthBinding()
assert.ok(B.bindingMatches(b.nonce, b.hash))
assert.ok(!B.bindingMatches(B.newOauthBinding().nonce, b.hash), 'another browser nonce fails')
assert.ok(!B.bindingMatches(undefined, b.hash) && !B.bindingMatches(b.nonce, undefined) && !B.bindingMatches('', b.hash))

// 2. Calendar: connect sets an HttpOnly/Secure/SameSite=Lax cookie on /api and binds its hash into the state.
for (const [name, handler, path] of [['canonical', calConnect, '/api/calendar/connect'], ['legacy', calLegacy, '/calendar']] as const) {
  const token = new URL(cal.buildCalendarConnectUrl(ATTACKER)!).searchParams.get('token')!
  const res = await handler.GET(req(`${path}?token=${encodeURIComponent(token)}`))
  const c = bindCookie(res)
  assert.ok(c.value, `${name}: binding cookie set`)
  assert.match(c.raw, /HttpOnly/i); assert.match(c.raw, /Secure/i); assert.match(c.raw, /SameSite=lax/i); assert.match(c.raw, /Path=\/api/i)
  const state = stateOf(res)
  assert.equal(cal.consumeBoundCalendarOauthState(state, c.value), ATTACKER, `${name}: same browser accepted`)
  assert.equal(cal.consumeBoundCalendarOauthState(state, B.newOauthBinding().nonce), null, `${name}: other browser rejected`)
  assert.equal(cal.consumeBoundCalendarOauthState(state, undefined), null, `${name}: no cookie rejected`)
}

// 3. Calendar OAuth CSRF scenario: attacker starts the flow, victim finishes it in the victim's browser -> no write.
{
  const token = new URL(cal.buildCalendarConnectUrl(ATTACKER)!).searchParams.get('token')!
  const start = await calConnect.GET(req(`/api/calendar/connect?token=${encodeURIComponent(token)}`))
  const attackerCookie = bindCookie(start).value!
  const state = stateOf(start)
  writes.length = 0
  const victim = await calCallback.GET(req(`/api/calendar/callback?code=c&state=${encodeURIComponent(state)}`))
  assert.equal(victim.status, 400, 'victim browser (no cookie) cannot finish attacker flow')
  assert.equal(writes.length, 0, 'nothing written for the victim-browser attempt')
  const victimOther = await calCallback.GET(req(`/api/calendar/callback?code=c&state=${encodeURIComponent(state)}`, `${B.OAUTH_BIND_COOKIE}=${B.newOauthBinding().nonce}`))
  assert.equal(victimOther.status, 400, 'victim browser with its own binding cookie cannot finish attacker flow')
  // Same browser finishes: token saved only for the state owner; the cookie is cleared (single use).
  writes.length = 0
  const ok = await calCallback.GET(req(`/api/calendar/callback?code=c&state=${encodeURIComponent(state)}`, `${B.OAUTH_BIND_COOKIE}=${encodeURIComponent(attackerCookie)}`))
  assert.equal(ok.status, 303, 'starting browser completes')
  assert.ok(writes.some(w => w.includes(`telegram_id=eq.${ATTACKER}`)) && !writes.some(w => w.includes(String(VICTIM))), 'saved only to the state owner')
  assert.match(bindCookie(ok).raw, /Max-Age=0/i, 'binding cookie cleared after completion')
  // An unbound state (old format, no "b") is refused even with a cookie.
  const unbound = new URL(cal.getAuthUrl(ATTACKER)).searchParams.get('state')!
  assert.equal(cal.consumeBoundCalendarOauthState(unbound, attackerCookie), null, 'state without a binding hash is refused')
  // A state with trailing segments is refused (was ignored before).
  assert.equal(cal.consumeBoundCalendarOauthState(`${state}.junk`, attackerCookie), null, 'trailing state segments rejected')
}

// 4. Gmail read and send flows: same binding.
for (const [name, handler, path, build, purpose] of [
  ['gmail read', gmConnect, '/api/gmail/connect', gm.buildGmailConnectUrl, 'oauth'],
  ['gmail send', gmSendConnect, '/api/gmail/send/connect', gm.buildGmailSendConnectUrl, 'send_oauth'],
] as const) {
  const token = new URL(build(ATTACKER)!).searchParams.get('token')!
  const start = await handler.GET(req(`${path}?token=${encodeURIComponent(token)}`))
  const cookie = bindCookie(start).value!
  assert.ok(cookie, `${name}: binding cookie set`)
  const state = stateOf(start)
  assert.equal(gm.consumeBoundGmailOauthState(state, cookie, purpose), ATTACKER, `${name}: same browser accepted`)
  assert.equal(gm.consumeBoundGmailOauthState(state, B.newOauthBinding().nonce, purpose), null, `${name}: other browser rejected`)
  writes.length = 0
  const victim = await gmCallback.GET(req(`/api/gmail/callback?code=c&state=${encodeURIComponent(state)}`))
  assert.equal(victim.status, 400, `${name}: victim browser cannot finish attacker flow`)
  assert.equal(writes.length, 0, `${name}: nothing written for the victim-browser attempt`)
  assert.match(bindCookie(victim).raw, /Max-Age=0/i, `${name}: cookie cleared on failure too`)
  writes.length = 0
  const ok = await gmCallback.GET(req(`/api/gmail/callback?code=c&state=${encodeURIComponent(state)}`, `${B.OAUTH_BIND_COOKIE}=${encodeURIComponent(cookie)}`))
  assert.equal(ok.status, 200, `${name}: starting browser completes`)
  assert.ok(writes.some(w => w.includes(`telegram_id=eq.${ATTACKER}`)), `${name}: saved to the state owner`)
}

// 5. F4: strict owner parsing in the shared connect-token verifier.
assert.equal(cal.verifyCalendarConnectToken('c1.1e3.zzzzzz.nonce.sig'), null)
// 6. F3: the reminders debug dump no longer accepts the secret in the URL.
{
  const { readFileSync } = await import('node:fs')
  const dbg = readFileSync(new URL('../app/api/debug/reminders/route.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(dbg, /searchParams\.get\(['"]secret['"]\)/, 'debug dump ignores ?secret=')
  assert.match(dbg, /authorization/i)
  process.env.CRON_SECRET = 'synthetic-cron'
  const dbgRoute = await import('../app/api/debug/reminders/route')
  assert.equal((await dbgRoute.GET(new Request('https://app.askgogo.in/api/debug/reminders?secret=synthetic-cron'))).status, 401, '?secret= alone is refused')
}
console.log('OAuth browser binding: attacker-started flows cannot be finished in another browser; Calendar and Gmail, single use')
