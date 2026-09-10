import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

console.log('Google Workspace + Calendar signed OAuth verification passed')
