// OAuth browser binding (port of old PR #850). Offline: Google and Supabase are faked through fetch; no network.
// Run: npx tsx scripts/verify-oauth-browser-binding.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
const setCookie = (res: Response, name: string) => {
  const raw = (res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || '']).find(c => c.startsWith(`${name}=`)) || ''
  const m = raw.match(new RegExp(`^${name}=([^;]*)`))
  return { raw, value: m ? decodeURIComponent(m[1]) : null }
}
const stateOf = (res: Response) => new URL(res.headers.get('location') || 'https://x.invalid').searchParams.get('state') || ''

let googleTokenCalls = 0
const writes: string[] = []
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input)
  if (url.startsWith('https://oauth2.googleapis.com/token')) { googleTokenCalls++; return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/gmail.send' })) }
  if (url.includes('googleapis.com')) return new Response(JSON.stringify({ id: 'synthetic@example.com', email: 'synthetic@example.com', items: [{ id: 'synthetic@example.com', primary: true }] }))
  if (url.startsWith('https://synthetic.supabase.co/rest/v1/')) {
    const method = init?.method || 'GET'
    if (method !== 'GET') writes.push(`${method} ${decodeURIComponent(new URL(url).search)}`)
    return new Response(method === 'GET' ? 'null' : '[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}) as any

const OWNER = -111111111
const CAL = B.oauthBindingCookieName('calendar'), GM = B.oauthBindingCookieName('gmail')

// 1. Helper: a cookie binds exactly one state, in one flow.
{
  const state = new URL(cal.getAuthUrl(OWNER)).searchParams.get('state')!
  const other = new URL(cal.getAuthUrl(OWNER)).searchParams.get('state')!
  const c = B.issueOauthBinding('calendar', state)!
  assert.ok(B.oauthBindingMatches('calendar', state, c), 'issued cookie matches its state')
  assert.ok(!B.oauthBindingMatches('calendar', other, c), 'cookie for another state is refused')
  assert.ok(!B.oauthBindingMatches('gmail', state, c), 'cookie for another flow is refused')
  assert.ok(!B.oauthBindingMatches('calendar', state, undefined) && !B.oauthBindingMatches('calendar', state, ''), 'no cookie refused')
  assert.ok(!B.oauthBindingMatches('calendar', state, c.replace(/.$/, ch => ch === 'A' ? 'B' : 'A')), 'tampered mac refused')
  assert.ok(!B.oauthBindingMatches('calendar', state, `${c}.x`), 'extra segment refused')
}

// 2. Every start route sets an HttpOnly, Secure, SameSite=Lax, short-lived cookie bound to the state it hands to Google.
const starts = [
  ['calendar connect', calConnect, '/api/calendar/connect', (id: number) => cal.buildCalendarConnectUrl(id), CAL, 'calendar', '/api/calendar/callback'],
  ['calendar legacy', calLegacy, '/calendar', (id: number) => cal.buildCalendarConnectUrl(id), CAL, 'calendar', '/api/calendar/callback'],
  ['gmail read', gmConnect, '/api/gmail/connect', (id: number) => gm.buildGmailConnectUrl(id), GM, 'gmail', '/api/gmail/callback'],
  ['gmail send', gmSendConnect, '/api/gmail/send/connect', (id: number) => gm.buildGmailSendConnectUrl(id), GM, 'gmail', '/api/gmail/callback'],
] as const
async function start(i: number) {
  const [, handler, path, build, cookie] = starts[i]
  const token = new URL(build(OWNER)!).searchParams.get('token')!
  const res = await handler.GET(req(`${path}?token=${encodeURIComponent(token)}`))
  return { res, cookie: setCookie(res, cookie), state: stateOf(res) }
}
for (let i = 0; i < starts.length; i++) {
  const [name, , , , , flow, path] = starts[i]
  const { res, cookie, state } = await start(i)
  assert.ok(res.status >= 300 && res.status < 400, `${name}: redirects to Google`)
  assert.match(res.headers.get('location') || '', /^https:\/\/accounts\.google\.com\//, `${name}: Google consent URL`)
  assert.ok(cookie.value, `${name}: binding cookie set`)
  assert.match(cookie.raw, /HttpOnly/i, `${name}: HttpOnly`)
  assert.match(cookie.raw, /Secure/i, `${name}: Secure`)
  assert.match(cookie.raw, /SameSite=lax/i, `${name}: SameSite=Lax`)
  assert.match(cookie.raw, new RegExp(`Path=${path.replace(/\//g, '\\/')}(;|$)`, 'i'), `${name}: scoped to its callback`)
  const maxAge = Number((cookie.raw.match(/Max-Age=(\d+)/i) || [])[1])
  assert.ok(maxAge > 0 && maxAge <= 15 * 60, `${name}: short TTL`)
  assert.ok(B.oauthBindingMatches(flow, state, cookie.value), `${name}: cookie bound to the issued state`)
}
// A connect link without a valid token sets no cookie.
{
  const res = await calConnect.GET(req('/api/calendar/connect?token=c1.1.2.3.bad'))
  assert.equal(res.status, 401)
  assert.equal(setCookie(res, CAL).value, null)
}

// 3. Callbacks: no cookie -> refused; wrong cookie -> refused; matching cookie -> proceeds; cookie cleared after use.
const callbacks = [
  ['calendar', 0, calCallback, '/api/calendar/callback', CAL, 303],
  ['gmail read', 2, gmCallback, '/api/gmail/callback', GM, 200],
  ['gmail send', 3, gmCallback, '/api/gmail/callback', GM, 200],
] as const
for (const [name, startIdx, cb, path, cookieName, okStatus] of callbacks) {
  const a = await start(startIdx)
  const b = await start(startIdx) // a second browser starting its own flow gets a different valid cookie
  const url = `${path}?code=c&state=${encodeURIComponent(a.state)}`

  writes.length = 0; googleTokenCalls = 0
  const none = await cb.GET(req(url))
  assert.equal(none.status, 400, `${name}: callback without cookie is refused`)
  assert.equal(googleTokenCalls, 0, `${name}: no code exchange without cookie`)
  assert.equal(writes.length, 0, `${name}: nothing saved without cookie`)
  assert.match(setCookie(none, cookieName).raw, /Max-Age=0/i, `${name}: cookie cleared on refusal`)

  for (const [label, value] of [
    ['other browser cookie', b.cookie.value!],
    ['forged cookie', 'v1.forged.forged'],
    ['other flow cookie', B.issueOauthBinding(cookieName === CAL ? 'gmail' : 'calendar', a.state)!],
  ] as const) {
    writes.length = 0; googleTokenCalls = 0
    const wrong = await cb.GET(req(url, `${cookieName}=${encodeURIComponent(value)}`))
    assert.equal(wrong.status, 400, `${name}: ${label} is refused`)
    assert.equal(googleTokenCalls, 0, `${name}: ${label}: no code exchange`)
    assert.equal(writes.length, 0, `${name}: ${label}: nothing saved`)
  }

  writes.length = 0; googleTokenCalls = 0
  const ok = await cb.GET(req(url, `${cookieName}=${encodeURIComponent(a.cookie.value!)}`))
  assert.equal(ok.status, okStatus, `${name}: matching cookie proceeds`)
  assert.equal(googleTokenCalls, 1, `${name}: code exchanged once`)
  assert.ok(writes.some(w => w.includes(`telegram_id=eq.${OWNER}`)), `${name}: saved to the state owner`)
  const cleared = setCookie(ok, cookieName)
  assert.match(cleared.raw, /Max-Age=0/i, `${name}: cookie cleared after use`)
  assert.equal(cleared.value, '', `${name}: cleared value is empty`)
}

// 4. Every connect goes through a bound start route: no raw getAuthUrl fallback in the bot, no /calendar?id= rewriter.
{
  const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(pm, /getAuthUrl\(/, 'bot never sends a raw Google OAuth URL')
  assert.doesNotMatch(pm, /buildCalendarConnectUrl\([^)]*\)\s*\|\|/, 'no fallback after the signed connect link')
  const fr = readFileSync(new URL('../lib/bot/format-response.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(fr, /calendar\?id=/, 'no /calendar?id= rewriter')
  const { formatOutgoingText } = await import('../lib/bot/format-response')
  const raw = cal.getAuthUrl(OWNER)
  assert.ok(formatOutgoingText('whatsapp' as any, `Link: ${raw}`).includes(raw), 'Google URLs are not rewritten to /calendar?id=')
  for (const f of ['../app/api/calendar/connect/route.ts', '../app/calendar/route.ts', '../app/api/gmail/connect/route.ts', '../app/api/gmail/send/connect/route.ts']) {
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /setOauthBindingCookie\(res/, `${f}: binds before redirecting`)
  }
  // The links the bot and dashboard send open the start route itself (where the cookie is set).
  assert.match(cal.buildCalendarConnectUrl(OWNER)!, /^https:\/\/app\.askgogo\.in\/api\/calendar\/connect\?token=/)
  assert.match(gm.buildGmailConnectUrl(OWNER)!, /^https:\/\/app\.askgogo\.in\/api\/gmail\/connect\?token=/)
  assert.match(gm.buildGmailSendConnectUrl(OWNER)!, /^https:\/\/app\.askgogo\.in\/api\/gmail\/send\/connect\?token=/)
}
console.log('OAuth browser binding: Calendar and Gmail connect finish only in the starting browser, once')
