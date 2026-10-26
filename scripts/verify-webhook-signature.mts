// Inbound webhook signature verification — behaviour and safety-default checks.
//
// Two things are proven here:
//   1. the verifier accepts a genuine Twilio signature and rejects a forged one;
//   2. it is OFF by default — with WEBHOOK_SIGNATURE_ENFORCE unset, no verdict,
//      not even 'invalid', can cause a request to be rejected.
//
// (2) is the one that matters until the flag is flipped: it is what makes shipping
// this safe. Run: npx tsx scripts/verify-webhook-signature.mts

import { downloadTwilioWhatsappInboundMedia, TWILIO_WHATSAPP_IMAGE_MAX_BYTES } from '../lib/services/twilio-whatsapp-inbound-egress'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import {
  auditInboundTwilioSignature,
  candidateWebhookUrls,
  computeTwilioSignature,
  evaluateTwilioSignature,
  shouldRejectRequest,
  signatureEnforcementMode,
} from '../lib/security/webhook-signature'

const AUTH_TOKEN = 'test_auth_token_do_not_use_in_production'
const URL_SIGNED = 'https://app.askgogo.in/api/webhooks/whatsapp'
const PARAMS = {
  From: 'whatsapp:+919876543210',
  Body: 'remind me to call mum at 6pm',
  NumMedia: '0',
  MessageSid: 'SM00000000000000000000000000000001',
  ProfileName: 'Test User',
}

const headers = (map: Record<string, string>) => ({ get: (n: string) => map[n.toLowerCase()] ?? null })

// ── 1. The signature algorithm matches Twilio's published scheme ──────────────
{
  const expected = crypto
    .createHmac('sha1', AUTH_TOKEN)
    .update(
      Buffer.from(
        Object.keys(PARAMS).sort().reduce((acc, k) => acc + k + (PARAMS as any)[k], URL_SIGNED),
        'utf-8',
      ),
    )
    .digest('base64')
  assert.equal(computeTwilioSignature(AUTH_TOKEN, URL_SIGNED, PARAMS), expected)
  console.log('  ✓ signature is HMAC-SHA1 over url + params sorted by name, base64')
}

const validSignature = computeTwilioSignature(AUTH_TOKEN, URL_SIGNED, PARAMS)

// ── 2. A valid signature is accepted ──────────────────────────────────────────
{
  const v = evaluateTwilioSignature({ signature: validSignature, candidateUrls: [URL_SIGNED], params: PARAMS, authToken: AUTH_TOKEN })
  assert.equal(v.outcome, 'valid')
  assert.equal(v.matchedUrl, URL_SIGNED)
  console.log('  ✓ a genuine Twilio signature evaluates to valid')
}

// ── 3. Forgeries are rejected, every way a request can be tampered with ───────
{
  const tampered = { ...PARAMS, Body: 'transfer my money to the attacker' }
  assert.equal(
    evaluateTwilioSignature({ signature: validSignature, candidateUrls: [URL_SIGNED], params: tampered, authToken: AUTH_TOKEN }).outcome,
    'invalid',
    'a modified body must invalidate the signature',
  )
  assert.equal(
    evaluateTwilioSignature({ signature: validSignature, candidateUrls: [URL_SIGNED], params: { ...PARAMS, From: 'whatsapp:+910000000000' }, authToken: AUTH_TOKEN }).outcome,
    'invalid',
    'impersonating another sender must invalidate the signature',
  )
  assert.equal(
    evaluateTwilioSignature({ signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=', candidateUrls: [URL_SIGNED], params: PARAMS, authToken: AUTH_TOKEN }).outcome,
    'invalid',
    'a garbage signature must be invalid',
  )
  assert.equal(
    evaluateTwilioSignature({ signature: validSignature, candidateUrls: ['https://evil.example/api/webhooks/whatsapp'], params: PARAMS, authToken: AUTH_TOKEN }).outcome,
    'invalid',
    'a signature for a different URL must not validate',
  )
  assert.equal(
    evaluateTwilioSignature({ signature: validSignature, candidateUrls: [URL_SIGNED], params: PARAMS, authToken: 'wrong_token' }).outcome,
    'invalid',
    'a different auth token must not validate',
  )
  console.log('  ✓ tampered body, spoofed sender, garbage signature, wrong URL and wrong token are all invalid')
}

// ── 4. Unverifiable is distinct from invalid; the REASON decides rejection ─────
{
  // All three are 'unverifiable' — distinct from a forgery's 'invalid'.
  const noToken = evaluateTwilioSignature({ signature: validSignature, candidateUrls: [URL_SIGNED], params: PARAMS, authToken: '' })
  const noHeader = evaluateTwilioSignature({ signature: '', candidateUrls: [URL_SIGNED], params: PARAMS, authToken: AUTH_TOKEN })
  const noUrl = evaluateTwilioSignature({ signature: validSignature, candidateUrls: [], params: PARAMS, authToken: AUTH_TOKEN })
  assert.equal(noToken.outcome, 'unverifiable')
  assert.equal(noHeader.outcome, 'unverifiable')
  assert.equal(noUrl.outcome, 'unverifiable')
  assert.equal(noHeader.reason, 'no_signature_header')
  assert.equal(noToken.reason, 'no_auth_token_configured')
  assert.equal(noUrl.reason, 'no_candidate_url')

  // An ABSENT signature header is attacker-controlled (the easiest forgery), so it
  // must be rejected under enforcement — exactly like an 'invalid' signature.
  for (const absent of ['', null, undefined]) {
    const v = evaluateTwilioSignature({ signature: absent as any, candidateUrls: [URL_SIGNED], params: PARAMS, authToken: AUTH_TOKEN })
    assert.equal(v.reason, 'no_signature_header')
    assert.equal(shouldRejectRequest(v, 'enforce'), true, 'enforcement must reject a request with no signature header')
  }

  // OUR OWN misconfiguration (no auth token, no candidate URL) must NEVER reject —
  // otherwise a config slip would 403 genuine Twilio traffic.
  assert.equal(shouldRejectRequest(noToken, 'enforce'), false, 'enforcement must not reject on missing auth token (our misconfig)')
  assert.equal(shouldRejectRequest(noUrl, 'enforce'), false, 'enforcement must not reject on missing candidate URL (our misconfig)')
  console.log('  ✓ absent header rejects under enforcement; missing token / URL (our misconfig) never rejects')
}

// ── 5. THE SAFETY DEFAULT: unset flag can never reject ─────────────────────────
{
  assert.equal(signatureEnforcementMode({}), 'log-only')
  assert.equal(signatureEnforcementMode({ WEBHOOK_SIGNATURE_ENFORCE: '' }), 'log-only')
  assert.equal(signatureEnforcementMode({ WEBHOOK_SIGNATURE_ENFORCE: '0' }), 'log-only')
  assert.equal(signatureEnforcementMode({ WEBHOOK_SIGNATURE_ENFORCE: 'false' }), 'log-only')
  for (const on of ['1', 'true', 'on', 'enforce', 'TRUE', 'On']) {
    assert.equal(signatureEnforcementMode({ WEBHOOK_SIGNATURE_ENFORCE: on }), 'enforce', `${on} should enable enforcement`)
  }

  const forged = evaluateTwilioSignature({ signature: 'AAAA=', candidateUrls: [URL_SIGNED], params: PARAMS, authToken: AUTH_TOKEN })
  assert.equal(forged.outcome, 'invalid')
  assert.equal(shouldRejectRequest(forged, 'log-only'), false, 'LOG-ONLY MUST NEVER REJECT')
  assert.equal(shouldRejectRequest(forged, 'enforce'), true)
  console.log('  ✓ log-only is the default and never rejects; enforcement rejects only real forgeries')
}

// ── 6. End-to-end through the route helper, both modes ────────────────────────
{
  const req = {
    requestUrl: 'https://app.askgogo.in/api/webhooks/whatsapp',
    headers: headers({ 'x-twilio-signature': 'AAAA=', 'x-forwarded-host': 'app.askgogo.in', 'x-forwarded-proto': 'https' }),
    params: PARAMS,
    route: 'webhooks/whatsapp',
  }
  const logOnly = auditInboundTwilioSignature({ ...req, env: { TWILIO_AUTH_TOKEN: AUTH_TOKEN } })
  assert.equal(logOnly.mode, 'log-only')
  assert.equal(logOnly.verdict.outcome, 'invalid')
  assert.equal(logOnly.reject, false, 'a forged request must still pass through in log-only mode')

  const enforced = auditInboundTwilioSignature({ ...req, env: { TWILIO_AUTH_TOKEN: AUTH_TOKEN, WEBHOOK_SIGNATURE_ENFORCE: '1' } })
  assert.equal(enforced.reject, true)

  const good = auditInboundTwilioSignature({
    ...req,
    headers: headers({ 'x-twilio-signature': validSignature, 'x-forwarded-host': 'app.askgogo.in', 'x-forwarded-proto': 'https' }),
    env: { TWILIO_AUTH_TOKEN: AUTH_TOKEN, WEBHOOK_SIGNATURE_ENFORCE: '1' },
  })
  assert.equal(good.verdict.outcome, 'valid')
  assert.equal(good.reject, false)

  // THE GAP THIS FIX CLOSES: a request that simply OMITS the signature header must
  // be rejected under enforcement, not waved through. Headers carry no x-twilio-signature.
  const noHeaderHeaders = headers({ 'x-forwarded-host': 'app.askgogo.in', 'x-forwarded-proto': 'https' })
  const unsignedEnforced = auditInboundTwilioSignature({
    ...req,
    headers: noHeaderHeaders,
    env: { TWILIO_AUTH_TOKEN: AUTH_TOKEN, WEBHOOK_SIGNATURE_ENFORCE: '1' },
  })
  assert.equal(unsignedEnforced.verdict.reason, 'no_signature_header')
  assert.equal(unsignedEnforced.reject, true, 'enforce + no signature header must be rejected')

  // The same unsigned request in log-only mode must still pass — the flag is the
  // only thing that can ever cause a rejection.
  const unsignedLogOnly = auditInboundTwilioSignature({ ...req, headers: noHeaderHeaders, env: { TWILIO_AUTH_TOKEN: AUTH_TOKEN } })
  assert.equal(unsignedLogOnly.mode, 'log-only')
  assert.equal(unsignedLogOnly.reject, false, 'log-only + no signature header must NOT be rejected')

  // Enforce + our own misconfiguration (no auth token) must NOT reject genuine traffic.
  const noTokenEnforced = auditInboundTwilioSignature({ ...req, env: { WEBHOOK_SIGNATURE_ENFORCE: '1' } })
  assert.equal(noTokenEnforced.verdict.reason, 'no_auth_token_configured')
  assert.equal(noTokenEnforced.reject, false, 'enforce + no auth token configured (our misconfig) must NOT be rejected')
  console.log('  ✓ route helper: unsigned rejected under enforcement but not log-only; our misconfig never rejects; genuine always passes')
}

// ── 7. URL candidates cover the proxy cases ───────────────────────────────────
{
  const c = candidateWebhookUrls(
    'https://gogo-memory-os.vercel.app/api/webhooks/whatsapp',
    headers({ 'x-forwarded-host': 'app.askgogo.in', 'x-forwarded-proto': 'https' }),
    {},
  )
  assert.ok(c.includes('https://app.askgogo.in/api/webhooks/whatsapp'), 'must try the forwarded host Twilio was configured with')
  assert.ok(c.includes('https://gogo-memory-os.vercel.app/api/webhooks/whatsapp'), 'must try the origin the app sees')

  const pinned = candidateWebhookUrls('https://whatever.example/api/webhooks/whatsapp', headers({}), {
    TWILIO_WHATSAPP_WEBHOOK_URL: 'https://app.askgogo.in/api/webhooks/whatsapp',
  })
  assert.equal(pinned[0], 'https://app.askgogo.in/api/webhooks/whatsapp', 'an explicitly configured URL must win')
  console.log('  ✓ candidate URLs cover proxy rewriting, and an explicit TWILIO_WHATSAPP_WEBHOOK_URL wins')
}

// ── 8. The webhook is actually wired, and wired before any processing ─────────
{
  const route = fs.readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
  assert.match(route, /auditInboundTwilioSignature/, 'the inbound webhook must call the audit')
  assert.match(route, /if \(signatureAudit\.reject\) return new NextResponse\('Forbidden', \{ status: 403 \}\)/)

  const auditAt = route.indexOf('auditInboundTwilioSignature({')
  const resolveAt = route.indexOf('await resolveUser(')
  assert.ok(auditAt > 0 && resolveAt > 0 && auditAt < resolveAt, 'the audit must run before the user is resolved')

  // The body can only be read once; the audit must reuse the parsed formData.
  assert.doesNotMatch(
    route.slice(auditAt - 900, auditAt),
    /await req\.formData\(\)[\s\S]*await req\.formData\(\)/,
    'the audit must not re-read the request body',
  )
  console.log('  ✓ wired into the inbound webhook ahead of user resolution, reusing the parsed body')
}

// ── 9. P1: media URL metadata never authorizes off-origin credential egress ──
// Synthetic network only. No provider calls, real credentials, user content or DB.
{
  const sid = 'AC' + 'a'.repeat(32)
  const message = 'MM' + 'b'.repeat(32)
  const media = 'ME' + 'c'.repeat(32)
  const goodUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/${message}/Media/${media}`
  const basic = 'Basic ' + Buffer.from(sid + ':fake-token').toString('base64')
  const imageResponse = () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200, headers: { 'content-type': 'image/png', 'content-length': '3' },
  })
  function network(responses: Response[]) {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      const res = responses.shift()
      if (!res) throw new Error('unexpected fake network call')
      return res
    }) as typeof fetch
    return { calls, fetchImpl }
  }
  const request = (mediaUrl: string, fetchImpl: typeof fetch, kind: 'image' | 'audio' = 'image') =>
    downloadTwilioWhatsappInboundMedia({ mediaUrl, accountSid: sid, authToken: 'fake-token', kind, fetchImpl })

  const invalid = [
    'http://169.254.169.254/latest/meta-data',
    'https://169.254.169.254/latest/meta-data',
    'https://api.twilio.com.evil.example/2010-04-01/Accounts/' + sid,
    'https://api.twilio.com@evil.example/a',
    'http://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages/' + message + '/Media/' + media,
    goodUrl.replace(sid, 'AC' + 'd'.repeat(32)),
    goodUrl.replace('/Messages/', '/Calls/'),
    goodUrl.replace('/Media/', '/Media-not/'),
    goodUrl + '?redirect=https://evil.example',
    goodUrl + '#private',
    goodUrl.replace('/Media/' + media, '/Media/' + media + '/other'),
    goodUrl.replace(message, 'SM0001'),
  ]
  for (const hostile of invalid) {
    const fake = network([])
    assert.equal(await request(hostile, fake.fetchImpl), null, 'must reject invalid origin/account/path before fetch')
    assert.equal(fake.calls.length, 0, 'no outbound fetch for invalid URL')
  }

  const success = network([imageResponse()])
  const direct = await request(goodUrl, success.fetchImpl)
  assert.ok(direct)
  assert.equal(direct.contentType, 'image/png')
  assert.deepEqual([...new Uint8Array(direct.arrayBuffer)], [1, 2, 3])
  assert.equal(success.calls.length, 1)
  assert.equal(success.calls[0].url, goodUrl)
  assert.equal((success.calls[0].init?.headers as Record<string, string>).Authorization, basic)
  assert.equal(success.calls[0].init?.redirect, 'manual')

  const cdn = 'https://mms.twiliocdn.com/secure/test-content?sig=test'
  const oneHop = network([
    new Response(null, { status: 302, headers: { location: cdn } }),
    imageResponse(),
  ])
  assert.ok(await request(goodUrl, oneHop.fetchImpl))
  assert.equal(oneHop.calls.length, 2)
  assert.equal(oneHop.calls[1].url, cdn)
  assert.equal(oneHop.calls[1].init?.redirect, 'manual')
  assert.equal((oneHop.calls[1].init?.headers as Record<string, string> | undefined)?.Authorization, undefined,
    'CDN hop must never carry Basic auth')

  for (const redirect of [
    'http://mms.twiliocdn.com/unsafe',
    'https://mms.twiliocdn.com.evil.example/unsafe',
    'https://127.0.0.1/internal',
    'https://api.twilio.com/internal',
    'https://user:pass@mms.twiliocdn.com/private',
  ]) {
    const offHost = network([new Response(null, { status: 302, headers: { location: redirect } })])
    assert.equal(await request(goodUrl, offHost.fetchImpl), null)
    assert.equal(offHost.calls.length, 1, 'off-host second hop must not be fetched')
  }
  const doubleRedirect = network([
    new Response(null, { status: 302, headers: { location: cdn } }),
    new Response(null, { status: 302, headers: { location: 'https://evil.example/third' } }),
  ])
  assert.equal(await request(goodUrl, doubleRedirect.fetchImpl), null)
  assert.equal(doubleRedirect.calls.length, 2, 'no third-hop network request')

  const badMime = network([new Response('<html>bad</html>', { headers: { 'content-type': 'text/html' } })])
  assert.equal(await request(goodUrl, badMime.fetchImpl), null)
  const oversizedHeader = network([new Response(new Uint8Array([1]), {
    headers: { 'content-type': 'image/png', 'content-length': String(TWILIO_WHATSAPP_IMAGE_MAX_BYTES + 1) },
  })])
  assert.equal(await request(goodUrl, oversizedHeader.fetchImpl), null)
  const hugeStream = network([new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const chunk = new Uint8Array(1024 * 1024)
      for (let i = 0; i < 13; i++) controller.enqueue(chunk)
      controller.close()
    },
  }), { headers: { 'content-type': 'image/jpeg' } })])
  assert.equal(await request(goodUrl, hugeStream.fetchImpl), null, 'actual streamed bytes must be limited')

  const audio = network([new Response(new Uint8Array([4, 5]), {
    headers: { 'content-type': 'audio/ogg' },
  })])
  const recording = await request(goodUrl, audio.fetchImpl, 'audio')
  assert.ok(recording)
  assert.equal(recording.contentType, 'audio/ogg')
  const noCreds = network([])
  assert.equal(await downloadTwilioWhatsappInboundMedia({
    mediaUrl: goodUrl, accountSid: sid, authToken: '', kind: 'image', fetchImpl: noCreds.fetchImpl,
  }), null)
  assert.equal(noCreds.calls.length, 0)

  const route = fs.readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
  assert.equal((route.match(/downloadTwilioWhatsappInboundMedia\(/g) || []).length, 3,
    'translation, food/ticket classification and meeting diarization use guarded download')
  assert.doesNotMatch(route, /fetch\((?:firstMediaUrl|mediaUrl0),\s*\{\s*headers:\s*\{\s*Authorization:/,
    'legacy direct credential-bearing fetches must be removed')
  console.log('  ✓ P1 media fetch: account/path exact, auth first-hop only, bounded stream/MIME, image+audio, fail-closed redirects')
}

console.log('\n✅ webhook signature verification: valid accepted, forged rejected, OFF by default')
