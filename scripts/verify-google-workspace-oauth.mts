import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.CRON_SECRET = process.env.CRON_SECRET || 'askgogo-google-workspace-test-secret'
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id'

const gmail = await import('../lib/services/google-gmail.ts')
const connectRoute = readFileSync(new URL('../app/api/gmail/connect/route.ts', import.meta.url), 'utf8')
const callbackRoute = readFileSync(new URL('../app/api/gmail/callback/route.ts', import.meta.url), 'utf8')
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

// A public caller can no longer choose another user's telegram id and have the
// route sign it. The only accepted input is the short-lived server-signed token.
assert.match(connectRoute, /verifyGmailConnectToken/)
assert.match(connectRoute, /searchParams\.get\('token'\)/)
assert.doesNotMatch(connectRoute, /searchParams\.get\('telegramId'\)/)

// Callback identity comes only from signed OAuth state, never raw state parsing.
assert.match(callbackRoute, /consumeGmailOauthState/)
assert.doesNotMatch(callbackRoute, /Number\(state\)/)
assert.match(callbackRoute, /Could not verify the connected Google account/)

// User-facing reconnect links are signed and do not leak/accept raw identity ids.
assert.match(emailActions, /buildGmailConnectUrl/)
assert.doesNotMatch(emailActions, /gmail\/connect\?telegramId=/)
assert.match(emailActions, /read-only Gmail, Contacts and Drive/)

console.log('Google Workspace signed read-only OAuth verification passed')
