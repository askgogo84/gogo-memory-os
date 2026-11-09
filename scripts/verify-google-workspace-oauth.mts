import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

process.env.CRON_SECRET = process.env.CRON_SECRET || 'askgogo-google-workspace-test-secret'
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id'

const gmail = await import('../lib/services/google-gmail.ts')
const calendar = await import('../lib/services/google-calendar.ts')
const connectRoute = readFileSync(new URL('../app/api/gmail/connect/route.ts', import.meta.url), 'utf8')
const callbackRoute = readFileSync(new URL('../app/api/gmail/callback/route.ts', import.meta.url), 'utf8')
const calendarConnectRoute = readFileSync(new URL('../app/api/calendar/connect/route.ts', import.meta.url), 'utf8')
const calendarCallbackRoute = readFileSync(new URL('../app/api/calendar/callback/route.ts', import.meta.url), 'utf8')
const emailActions = readFileSync(new URL('../lib/bot/handlers/email-actions.ts', import.meta.url), 'utf8')

const telegramId = 123456789
const connectUrl = gmail.buildGmailConnectUrl(telegramId)
assert.ok(connectUrl)
const token = new URL(connectUrl!).searchParams.get('token') || ''
assert.equal(gmail.verifyGmailConnectToken(token), telegramId)
assert.equal(gmail.verifyGmailConnectToken(`${token}tampered`), null)

const authUrl = gmail.getGmailAuthUrl(telegramId)
assert.ok(authUrl)
const auth = new URL(authUrl!)
const scopes = String(auth.searchParams.get('scope') || '')
assert.match(scopes, /gmail\.readonly/)
assert.match(scopes, /contacts\.readonly/)
assert.match(scopes, /drive\.readonly/)
assert.match(scopes, /\bopenid\b/)
assert.match(scopes, /\bemail\b/)
assert.doesNotMatch(scopes, /\bprofile\b/)
assert.doesNotMatch(scopes, /gmail\.(?:send|modify|compose)/)
assert.equal(auth.searchParams.get('access_type'), 'offline')
assert.equal(auth.searchParams.get('include_granted_scopes'), 'true')

const oauthState = auth.searchParams.get('state') || ''
assert.equal(gmail.consumeGmailOauthState(oauthState), telegramId)
assert.equal(gmail.consumeGmailOauthState(`${oauthState}tampered`), null)

assert.match(connectRoute, /verifyGmailConnectToken/)
assert.match(connectRoute, /searchParams\.get\('token'\)/)
assert.doesNotMatch(connectRoute, /searchParams\.get\('telegramId'\)/)
assert.match(callbackRoute, /consumeGmailOauthState/)
assert.doesNotMatch(callbackRoute, /Number\(state\)/)
assert.match(callbackRoute, /Could not verify the connected Google account/)
assert.match(emailActions, /buildGmailConnectUrl/)
assert.doesNotMatch(emailActions, /gmail\/connect\?telegramId=/)
assert.match(emailActions, /read-only Gmail, Contacts and Drive/)

// Calendar uses the same identity discipline even though it retains a write scope
// for explicitly approved calendar changes. A caller cannot ask the public connect
// route to sign an arbitrary raw id, and callback identity is never Number(state).
const calendarLink = calendar.buildCalendarConnectUrl(telegramId)
assert.ok(calendarLink)
const calendarToken = new URL(calendarLink!).searchParams.get('token') || ''
assert.equal(calendar.verifyCalendarConnectToken(calendarToken), telegramId)
assert.equal(calendar.verifyCalendarConnectToken(`${calendarToken}tampered`), null)
const calendarAuth = new URL(calendar.getAuthUrl(telegramId))
assert.match(String(calendarAuth.searchParams.get('scope') || ''), /calendar\.events/)
const calendarState = calendarAuth.searchParams.get('state') || ''
assert.equal(calendar.consumeCalendarOauthState(calendarState), telegramId)
assert.equal(calendar.consumeCalendarOauthState(`${calendarState}tampered`), null)
assert.match(calendarConnectRoute, /verifyCalendarConnectToken/)
assert.match(calendarConnectRoute, /searchParams\.get\('token'\)/)
assert.doesNotMatch(calendarConnectRoute, /searchParams\.get\('id'\)/)
assert.match(calendarCallbackRoute, /consumeCalendarOauthState/)
assert.doesNotMatch(calendarCallbackRoute, /parseInt\(telegramId\)|Number\(state\)/)

// WhatsApp users carry a NEGATIVE telegram_id (resolve-user.ts generateNegativeTelegramId).
// Regression, 19 Sep 2026: a positive-only guard refused every WhatsApp user a Gmail/Calendar
// connect link, so the bot answered "connection is temporarily unavailable" instead.
const whatsappId = -876543210
const waGmail = gmail.buildGmailConnectUrl(whatsappId)
assert.ok(waGmail, 'WhatsApp (negative) id must get a Gmail connect link')
assert.equal(gmail.verifyGmailConnectToken(new URL(waGmail!).searchParams.get('token') || ''), whatsappId)
const waGmailState = new URL(gmail.getGmailAuthUrl(whatsappId)!).searchParams.get('state') || ''
assert.equal(gmail.consumeGmailOauthState(waGmailState), whatsappId)
const waCal = calendar.buildCalendarConnectUrl(whatsappId)
assert.ok(waCal, 'WhatsApp (negative) id must get a Calendar connect link')
assert.equal(calendar.verifyCalendarConnectToken(new URL(waCal!).searchParams.get('token') || ''), whatsappId)
const waCalState = new URL(calendar.getAuthUrl(whatsappId)).searchParams.get('state') || ''
assert.equal(calendar.consumeCalendarOauthState(waCalState), whatsappId)
// 0 and non-numbers stay refused.
assert.equal(gmail.buildGmailConnectUrl(0), null)
assert.equal(gmail.buildGmailConnectUrl(Number.NaN), null)
assert.equal(calendar.buildCalendarConnectUrl(0), null)


// Composio Google consent is owner-bound. Exercise the ACTUAL transpiled GET
// handler with inert session/provider mocks; no real OAuth, credentials or fetch.
const gmailConnectSource = readFileSync(new URL('../app/api/email/google/connect/route.ts', import.meta.url), 'utf8')
const gmailConnectJS = ts.transpileModule(gmailConnectSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
async function checkGmailConnect(session: unknown, configured = true) {
  const calls: number[] = []
  const locationUnavailable = 'https://app.askgogo.in/dashboard/settings/email?error=google_unavailable'
  const deps: Record<string, unknown> = {
    'next/server': { NextResponse: { redirect: (location: string) => ({ location: String(location), status: 307 }) } },
    '@/lib/dashboard/session': { getSession: async () => session },
    '@/lib/connectors/composio-gmail': {
      composioConfigured: () => configured,
      createGmailConnectLink: async (owner: number) => {
        calls.push(owner)
        return 'https://composio.fixture.invalid/consent?owner=' + owner
      },
    },
  }
  const exports: Record<string, any> = {}
  runInNewContext(gmailConnectJS, {
    exports,
    require: (name: string) => {
      assert.ok(Object.hasOwn(deps, name), 'unexpected route dependency: ' + name)
      return deps[name]
    },
    console: { error: () => undefined },
  }, { timeout: 1000 })
  const response = await exports.GET()
  return { location: String(response.location), calls, locationUnavailable }
}
for (const [raw, numeric] of [['123456789', 123456789], ['-876543210', -876543210], ['9007199254740991', 9007199254740991]] as const) {
  const { location, calls } = await checkGmailConnect({ telegramId: raw })
  assert.deepEqual(calls, [numeric], 'canonical safe owner must be passed unchanged')
  assert.equal(location, 'https://composio.fixture.invalid/consent?owner=' + numeric)
}
assert.equal(Number('9007199254740992'), Number('9007199254740993'), 'historic JS bigint identity collision reproduced')
for (const raw of [
  '9007199254740992', '9007199254740993', '-9007199254740992',
  '9223372036854775807', '', '0', '-0', '000123', '+123', '123 ',
  ' 123', '1.5', '1e3', 'NaN', 'Infinity', 'not-an-owner',
]) {
  const { location, calls, locationUnavailable } = await checkGmailConnect({ telegramId: raw })
  assert.equal(location, locationUnavailable, 'invalid or imprecise owner must fail closed: ' + JSON.stringify(raw))
  assert.equal(calls.length, 0, 'no OAuth account link for invalid owner: ' + JSON.stringify(raw))
}
for (const malformed of [{ telegramId: 9007199254740993 }, { telegramId: 123.5 }, { telegramId: null }]) {
  const { location, calls, locationUnavailable } = await checkGmailConnect(malformed)
  assert.equal(location, locationUnavailable)
  assert.equal(calls.length, 0)
}
const anonymousGmail = await checkGmailConnect(null)
assert.equal(anonymousGmail.location, 'https://app.askgogo.in/dashboard')
assert.equal(anonymousGmail.calls.length, 0)
const noProviderGmail = await checkGmailConnect({ telegramId: '123' }, false)
assert.equal(noProviderGmail.location, noProviderGmail.locationUnavailable)
assert.equal(noProviderGmail.calls.length, 0)

console.log('Google Workspace + Calendar signed OAuth verification passed')
