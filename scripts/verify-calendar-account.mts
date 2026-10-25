import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 18:14: "Which calendar I am connected to" said "already connected" without naming the account.
// Run: npx tsx scripts/verify-calendar-account.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
// Synthetic signature secret used only for local token verification, never provider auth.
process.env.CALENDAR_OAUTH_STATE_SECRET = 'synthetic-calendar-legacy-entry-test-secret'
const cal = await import('../lib/services/google-calendar')
const real = globalThis.fetch
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), {status})) as typeof fetch
try {
  globalThis.fetch = reply(200, {summary: 'someone@example.com'})
  assert.equal(await cal.fetchPrimaryCalendarAccount('t'), 'someone@example.com')
  globalThis.fetch = reply(200, {summary: 'Work stuff'})
  assert.equal(await cal.fetchPrimaryCalendarAccount('t'), null, 'a renamed calendar is not shown as an account')
  globalThis.fetch = reply(401, {error: 'x'})
  assert.equal(await cal.fetchPrimaryCalendarAccount('t'), null)
  globalThis.fetch = (async () => { throw new Error('net') }) as typeof fetch
  assert.equal(await cal.fetchPrimaryCalendarAccount('t'), null)
} finally { globalThis.fetch = real }
const pm = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
assert.match(pm, /describeCalendarAccounts\(await getAllCalendarAccountAccess\(resolvedUser\.telegramId\)/)
assert.match(pm, /it adds to the ones above, it does not replace them/)

// P1: a public legacy numeric calendar deep-link used to create signed OAuth
// state for ANY supplied owner. Signatures must be checked BEFORE getAuthUrl.
const { calendarOwnerForLegacyEntry } = await import('../lib/services/calendar-legacy-entry')
const ownerId = -123456789
const legitimate = cal.buildCalendarConnectUrl(ownerId)
assert.ok(legitimate, 'a configured connect state secret generates signed links')
const signedToken = new URL(legitimate).searchParams.get('token')!
assert.ok(signedToken.startsWith('c1.'), 'canonical short connect bearer token')
assert.equal(calendarOwnerForLegacyEntry(new URLSearchParams({ token: signedToken })), ownerId, 'only signed own-owner token accepted')
assert.equal(calendarOwnerForLegacyEntry(new URLSearchParams({ id: String(ownerId) })), null, 'unsigned raw id cannot mint signed OAuth state')
assert.equal(calendarOwnerForLegacyEntry(new URLSearchParams({ id: '987654321', token: signedToken })), ownerId, 'untrusted id never overrides signed token owner')
assert.equal(calendarOwnerForLegacyEntry(new URLSearchParams({ id: '987654321' })), null, 'unrelated numeric id fails closed')
assert.equal(calendarOwnerForLegacyEntry(new URLSearchParams({ token: 'c1.987654321.bad.bad.sig' })), null, 'forged bearer token rejected')
assert.equal(calendarOwnerForLegacyEntry(new URLSearchParams({ token: signedToken.slice(0, -1) + (signedToken.endsWith('A') ? 'B' : 'A') })), null, 'tampered signature rejected')
assert.equal(calendarOwnerForLegacyEntry(new URLSearchParams({ token: signedToken, id: 'not-an-id' })), ownerId, 'id parameter has no authority')

const origNow = Date.now
try {
  Date.now = () => origNow() + 16 * 60_000
  assert.equal(calendarOwnerForLegacyEntry(new URLSearchParams({ token: signedToken })), null, 'expired connect token rejected')
} finally {
  Date.now = origNow
}
const roundedOwnerLink = cal.buildCalendarConnectUrl(Number('9007199254740993'))
assert.ok(roundedOwnerLink)
const roundedToken = new URL(roundedOwnerLink).searchParams.get('token')!
assert.equal(calendarOwnerForLegacyEntry(new URLSearchParams({ token: roundedToken })), null, 'unsafe 64-bit numeric owner must fail closed')

const route = readFileSync(new URL('../app/calendar/route.ts', import.meta.url), 'utf8')
assert.match(route, /calendarOwnerForLegacyEntry\(new URL\(req\.url\)\.searchParams\)/, 'legacy route validates bearer ownership')
assert.match(route, /if \(telegramId === null\)/, 'invalid token returns before OAuth state mint')
assert.match(route, /getAuthUrl\(telegramId\)/, 'only verified signed owner reaches OAuth state mint')
assert.doesNotMatch(route, /\.get\(['"]id['"]\)/, 'the route must not trust a raw caller ID')

console.log('Calendar: account is named and legacy OAuth entry rejects forged, expired, and unsafe owner identity')
