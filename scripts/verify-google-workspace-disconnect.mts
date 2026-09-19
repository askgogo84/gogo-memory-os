import assert from 'node:assert/strict'
import fs from 'node:fs'

const brain=fs.readFileSync('lib/agent/same-brain.ts','utf8')
const gmail=fs.readFileSync('lib/services/google-gmail.ts','utf8')

for(const phrase of ['disconnect','unlink','remove']) assert.ok(brain.includes(phrase))
for(const field of ['gmail_access_token:null','gmail_refresh_token:null','gmail_connected:false','gmail_connected_at:null','gmail_email:null']) {
  assert.ok(brain.includes(field),`disconnect must clear ${field}`)
}
assert.ok(brain.includes('revokeGoogleToken(token)'))
assert.ok(gmail.includes("https://oauth2.googleapis.com/revoke"))
assert.ok(gmail.includes("new URLSearchParams({token:value})"))
console.log('google workspace disconnect contract passed')
