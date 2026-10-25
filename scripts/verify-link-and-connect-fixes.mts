import assert from 'node:assert/strict'
// 13 Oct 18:46: a pasted instagram.com reel link was sent to Instagram's login page by the provider-read parser
// (browser busy -> "service temporarily unavailable"), and the calendar connect link was ~560 characters.
// Run: GOOGLE_CLIENT_ID=x CALENDAR_OAUTH_STATE_SECRET=s npx tsx scripts/verify-link-and-connect-fixes.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.GOOGLE_CLIENT_ID ||= 'client-id'
process.env.CALENDAR_OAUTH_STATE_SECRET ||= 'test-secret'
const B = await import('../lib/agent/browser-command')
const cal = await import('../lib/google-calendar')

const reel = 'https://www.instagram.com/reel/Deb3ZCdgFjW/?dlrf=MXJraWhnOWZlOHc0Ng=='
assert.equal(B.parseConnectedProviderReadCommand(reel), null, 'a bare reel link is not a provider read')
assert.equal(B.parseConnectedProviderReadCommand(`save this ${reel}`), null)
assert.equal(B.parseConnectedProviderReadCommand('https://blinkit.com/prn/x/prid/1'), null, 'a store named only in a link is not a request')
assert.ok(B.parseConnectedProviderReadCommand('show my blinkit orders'), 'a provider named in the sentence still routes')

const link = cal.buildCalendarConnectUrl(-884501501)!
assert.ok(link.length < 130, `connect link is short (${link.length})`)
const token = new URL(link).searchParams.get('token') || ''
assert.equal(cal.verifyCalendarConnectToken(token), -884501501)
assert.equal(cal.verifyCalendarConnectToken(token.replace(/^c1\.-884501501/, 'c1.-884501502')), null, 'a changed id fails the signature')
assert.equal(cal.verifyCalendarConnectToken(token + 'x'), null)
assert.equal(cal.verifyCalendarConnectToken('c1.-884501501.zzzzzzzz.nonce.sig'), null)
assert.equal(cal.buildCalendarConnectUrl(0), null)
assert.match(new URL(cal.getAuthUrl(-884501501)).searchParams.get('prompt') || '', /select_account/)
console.log('Links: reel links are not provider reads; the calendar connect link is short and signed')
