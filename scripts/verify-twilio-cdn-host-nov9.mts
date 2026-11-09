// Hotfix 9 Nov: Twilio media redirects accept Twilio's CDN forms, never another host, never forward credentials,
// and a rejection is logged (host only) instead of failing silently.
import assert from 'node:assert/strict'
import { isTwilioMediaCdnUrl, logRejectedTwilioRedirect } from '../lib/services/twilio-cdn'
import { downloadTwilioWhatsappInboundMedia } from '../lib/services/twilio-whatsapp-inbound-egress'
const ok = (u: string) => isTwilioMediaCdnUrl(new URL(u))
for (const u of ['https://mms.twiliocdn.com/AC1/abc', 'https://media.twiliocdn.com/AC1/abc?sig=1', 'https://s3-external-1.amazonaws.com/media.twiliocdn.com/AC1/abc?X-Amz=1', 'https://s3.amazonaws.com/media.twiliocdn.com/AC1/x', 'https://media.twiliocdn.com.s3.amazonaws.com/AC1/x']) assert.equal(ok(u), true, u)
for (const u of ['http://mms.twiliocdn.com/AC1/abc', 'https://mms.twiliocdn.com/', 'https://user:pw@mms.twiliocdn.com/a', 'https://mms.twiliocdn.com.evil.com/a', 'https://eviltwiliocdn.com/a', 'https://s3.amazonaws.com/attacker-bucket/media.twiliocdn.com/x', 'https://s3.amazonaws.com/media.twiliocdn.com.evil/x', 'https://mms.twiliocdn.com:8443/a', 'https://169.254.169.254/latest', 'https://example.com/media.twiliocdn.com/x']) assert.equal(ok(u), false, u)
console.log('PASS accepted: mms/*.twiliocdn.com and Twilio\'s media.twiliocdn.com S3 bucket; rejected: http, root, userinfo, look-alikes, other buckets, ports, metadata IPs')

const logs: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
logRejectedTwilioRedirect('test', 'https://evil.example/path?secret=1')
assert.ok(logs.some(l => /TWILIO_MEDIA_REDIRECT_REJECTED/.test(l) && /"host":"evil.example"/.test(l) && !/secret|path/.test(l)))
console.log('PASS rejection log carries the host only')

const SID = 'AC' + 'a'.repeat(32); const api = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/MM${'b'.repeat(32)}/Media/ME${'c'.repeat(32)}`
const run = async (location: string) => {
  const calls: { url: string; auth: boolean }[] = []
  const fetchImpl = (async (url: string, init: any) => {
    calls.push({ url: String(url), auth: !!init?.headers?.Authorization })
    if (String(url).startsWith('https://api.twilio.com')) return new Response(null, { status: 307, headers: { location } })
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/ogg', 'content-length': '3' } })
  }) as unknown as typeof fetch
  const r = await downloadTwilioWhatsappInboundMedia({ mediaUrl: api, accountSid: SID, authToken: 't', kind: 'audio', fetchImpl })
  return { r, calls }
}
let x = await run('https://s3-external-1.amazonaws.com/media.twiliocdn.com/AC/x?sig=1')
assert.ok(x.r && x.r.contentType === 'audio/ogg', 'S3-form Twilio redirect now downloads'); assert.deepEqual(x.calls.map(c => c.auth), [true, false], 'credentials only on the api.twilio.com hop')
x = await run('https://mms.twiliocdn.com/AC/x'); assert.ok(x.r)
logs.length = 0; x = await run('https://evil.example/x'); assert.equal(x.r, null); assert.equal(x.calls.length, 1, 'never fetched'); assert.ok(logs.some(l => /whatsapp-inbound/.test(l)))
console.error = orig
console.log('PASS inbound voice/image download: Twilio CDN forms work, other hosts are never fetched and are logged')
console.log('verify-twilio-cdn-host-nov9: 3 passed')
