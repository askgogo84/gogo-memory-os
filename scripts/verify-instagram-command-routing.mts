import { readFileSync } from 'node:fs'
import { downloadTwilioSocialPreviewImage, TWILIO_SOCIAL_PREVIEW_MAX_BYTES } from '../lib/services/twilio-social-preview-image'
import assert from 'node:assert/strict'
import {detectInstagramPreviewCard, isInstagramReelPreview} from '../lib/services/reel-saver'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
const {parseConnectedProviderReadCommand,parseBrowserCommand} = await import('../lib/agent/browser-command')

const commands = [
  'Open Instagram and tell me what the latest 3 posts on @zomato are about',
  'Use the browser to research instagram.com/zomato and summarise the latest 3 posts',
  'Could you please open Instagram and show me the latest posts?',
  'What are the latest posts on Instagram about?',
  'Instagram is where I want you to research Zomato',
  'Use the browser to read https://www.instagram.com/zomato/ and summarise the latest 3 posts',
]
for (const command of commands) {
  assert.equal(detectInstagramPreviewCard(command), false, command)
  assert.equal(isInstagramReelPreview(command), false, command)
}
for (const preview of ['Zomato on Instagram: A new restaurant story', 'Zomato on Instagra...: A new restaurant story', 'Instagram:\nA new restaurant story']) {
  assert.equal(detectInstagramPreviewCard(preview), true, preview)
  assert.equal(isInstagramReelPreview(preview), true, preview)
}
const exact = parseConnectedProviderReadCommand(commands[0])
assert.ok(exact, 'the exact dashboard/WhatsApp acceptance prompt reaches the read executor')
assert.equal(new URL(exact.url).hostname, 'www.instagram.com')
assert.equal(exact.mode, 'read')
assert.ok(exact.objective.includes('@zomato'), 'original objective survives routing')
assert.equal(parseConnectedProviderReadCommand('Open Instagram and Zomato and show my orders'), null, 'actual multi-provider requests remain rejected')
assert.ok(parseBrowserCommand(commands[5]), 'full URL acceptance prompt reaches the browser parser')
console.log('Instagram requests bypass preview saving; genuine forwarded cards and browser objective preserved')


// P1 adversarial offline regression: the inbound social-preview media URL must
// never carry Twilio Basic auth to arbitrary endpoints or through redirects.
const account = 'AC' + 'a'.repeat(32)
const foreignAccount = 'AC' + 'b'.repeat(32)
const inbound = 'https://api.twilio.com/2010-04-01/Accounts/' + account
  + '/Messages/MM' + 'c'.repeat(32) + '/Media/ME' + 'd'.repeat(32)
const secret = 'synthetic-token-not-real'
const photo = new Uint8Array([255, 216, 255, 217])
const image = () => new Response(photo, { status: 200, headers: { 'content-type': 'image/jpeg' } })
type Call = { url: string; authorization: string | null; redirect: string | undefined }
function stub(...responses: Response[]): { calls: Call[]; fetchImpl: typeof fetch } {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
      redirect: init?.redirect,
    })
    const next = responses.shift()
    if (!next) throw new Error('Unexpected synthetic network request')
    return next
  }) as typeof fetch
  return { calls, fetchImpl }
}
for (const bad of [
  'http://api.twilio.com/2010-04-01/Accounts/' + account + '/Messages/MM' + 'c'.repeat(32) + '/Media/ME' + 'd'.repeat(32),
  'https://api.twilio.com.evil.example/' + account,
  'http://169.254.169.254/latest/meta-data/',
  'https://127.0.0.1/admin',
  inbound.replace(account, foreignAccount),
  inbound + '?url=https://169.254.169.254/',
  inbound + '#x',
  'https://api.twilio.com@evil.example/secret',
  'https://api.twilio.com/2010-04-01/Accounts/' + account + '/Messages/MM' + 'c'.repeat(32) + '/Media/bad',
]) {
  const test = stub(image())
  await assert.rejects(() => downloadTwilioSocialPreviewImage(bad, account, secret, { fetchImpl: test.fetchImpl }))
  assert.equal(test.calls.length, 0, 'Untrusted media URL must fail before any network or credential egress: ' + bad)
}
{
  const test = stub(image())
  const out = await downloadTwilioSocialPreviewImage(inbound, account, secret, { fetchImpl: test.fetchImpl })
  assert.deepEqual(out.buffer, Buffer.from(photo))
  assert.equal(out.contentType, 'image/jpeg')
  assert.equal(test.calls.length, 1)
  assert.equal(test.calls[0].url, inbound)
  assert.equal(test.calls[0].redirect, 'manual')
  assert.equal(test.calls[0].authorization, 'Basic ' + Buffer.from(account + ':' + secret).toString('base64'))
}
{
  const cdn = 'https://mms.twiliocdn.com/asset/signed?token=fixture'
  const test = stub(Response.redirect(cdn, 302), image())
  const out = await downloadTwilioSocialPreviewImage(inbound, account, secret, { fetchImpl: test.fetchImpl })
  assert.equal(out.contentType, 'image/jpeg')
  assert.equal(test.calls.length, 2)
  assert.equal(test.calls[1].url, cdn)
  assert.equal(test.calls[1].redirect, 'manual')
  assert.equal(test.calls[1].authorization, null, 'Never attach Basic auth to CDN')
}
for (const location of [
  'http://mms.twiliocdn.com/asset',
  'https://mms.twiliocdn.com.evil.example/asset',
  'https://169.254.169.254/metadata',
  'https://mms.twiliocdn.com@evil.example/asset',
  'https://mms.twiliocdn.com/',
]) {
  const test = stub(Response.redirect(location, 302), image())
  await assert.rejects(() => downloadTwilioSocialPreviewImage(inbound, account, secret, { fetchImpl: test.fetchImpl }))
  assert.equal(test.calls.length, 1, 'Unsafe redirect must not cause a second request')
}
{
  const test = stub(Response.redirect('https://mms.twiliocdn.com/first', 302),
    Response.redirect('https://mms.twiliocdn.com/second', 302))
  await assert.rejects(() => downloadTwilioSocialPreviewImage(inbound, account, secret, { fetchImpl: test.fetchImpl }))
  assert.equal(test.calls.length, 2, 'Second CDN redirect forbidden')
  assert.equal(test.calls[1].authorization, null)
}
{
  const test = stub(new Response(photo, { headers: { 'content-type': 'text/html' } }))
  await assert.rejects(() => downloadTwilioSocialPreviewImage(inbound, account, secret, { fetchImpl: test.fetchImpl }))
}
{
  const test = stub(new Response(photo, { headers: { 'content-type': 'image/jpeg', 'content-length': String(TWILIO_SOCIAL_PREVIEW_MAX_BYTES + 1) } }))
  await assert.rejects(() => downloadTwilioSocialPreviewImage(inbound, account, secret, { fetchImpl: test.fetchImpl }))
}
{
  const tooLarge = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(TWILIO_SOCIAL_PREVIEW_MAX_BYTES + 1)); controller.close() },
  })
  const test = stub(new Response(tooLarge, { headers: { 'content-type': 'image/jpeg' } }))
  await assert.rejects(() => downloadTwilioSocialPreviewImage(inbound, account, secret, { fetchImpl: test.fetchImpl }))
}
{
  const source = readFileSync('lib/services/reel-saver.ts', 'utf8')
  assert.match(source, /await downloadTwilioSocialPreviewImage\(params\.mediaUrl, sid, tok\)/)
  assert.match(source, /catch \{ \/\* Fail closed on unsafe\/download-failed images; keep caption-only summary/)
  assert.doesNotMatch(source, /fetch\(params\.mediaUrl/)
  assert.doesNotMatch(source, /await res\.arrayBuffer\(\)/)
}
console.log('✅ Social-preview Twilio media credential/redirect/byte-limit safety (offline fixtures)')
