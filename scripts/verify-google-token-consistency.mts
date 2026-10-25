import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')

const crypto = await import('../lib/security/google-token-crypto.ts')
const calendar = await import('../lib/services/google-calendar.ts')

const plainRefresh='1//calendar-refresh-token'
const encryptedRefresh=crypto.encryptGoogleToken(plainRefresh)
let submittedRefresh=''

const originalFetch=globalThis.fetch
globalThis.fetch=async (_input:any,init?:RequestInit)=>{
  const body=init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body||''))
  submittedRefresh=body.get('refresh_token')||''
  return new Response(JSON.stringify({access_token:'calendar-access-token'}),{
    status:200,
    headers:{'Content-Type':'application/json'},
  })
}

try {
  const access=await calendar.refreshAccessToken(encryptedRefresh)
  assert.equal(access,'calendar-access-token')
  assert.equal(submittedRefresh,plainRefresh,'Calendar refresh must decrypt stored ciphertext before calling Google')
} finally {
  globalThis.fetch=originalFetch
}

const calendarCallback=readFileSync('app/api/calendar/callback/route.ts','utf8')
assert.match(calendarCallback,/encryptGoogleToken\(tokens\.refresh_token\)/)
assert.match(calendarCallback,/hasGoogleTokenEncryptionKey\(\)/)
assert.doesNotMatch(calendarCallback,/google_refresh_token:\s*tokens\.refresh_token/)

for(const path of [
  'lib/agent/appointment-auth-resume.ts',
  'lib/agent/gmail-ticket-credential.ts',
  'lib/agent/google-workspace-drive-binary.ts',
  'app/api/test-gmail/route.ts',
]) {
  const source=readFileSync(path,'utf8')
  assert.match(source,/decryptGoogleToken/)
  assert.match(source,/encryptGoogleToken/)
}

const appointment=readFileSync('lib/agent/appointment-auth-resume.ts','utf8')
assert.doesNotMatch(appointment,/let access = String\(data\.gmail_access_token/)
assert.doesNotMatch(appointment,/update\(\{ gmail_access_token: next \}\)/)

const ticket=readFileSync('lib/agent/gmail-ticket-credential.ts','utf8')
assert.doesNotMatch(ticket,/refreshGmailAccessToken\(String\(data\.gmail_refresh_token\)\)/)
assert.doesNotMatch(ticket,/update\(\{ gmail_access_token: next \}\)/)

const drive=readFileSync('lib/agent/google-workspace-drive-binary.ts','utf8')
assert.doesNotMatch(drive,/update\(\{gmail_access_token:token\}\)/)

console.log('Google token consistency regression passed')
