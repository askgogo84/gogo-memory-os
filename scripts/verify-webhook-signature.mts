// Inbound webhook signature verification — behaviour and safety-default checks.
//
// Two things are proven here:
//   1. the verifier accepts a genuine Twilio signature and rejects a forged one;
//   2. it is OFF by default — with WEBHOOK_SIGNATURE_ENFORCE unset, no verdict,
//      not even 'invalid', can cause a request to be rejected.
//
// (2) is the one that matters until the flag is flipped: it is what makes shipping
// this safe. Run: npx tsx scripts/verify-webhook-signature.mts

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

// ── 4. Unverifiable is distinct from invalid ──────────────────────────────────
{
  assert.equal(evaluateTwilioSignature({ signature: validSignature, candidateUrls: [URL_SIGNED], params: PARAMS, authToken: '' }).outcome, 'unverifiable')
  assert.equal(evaluateTwilioSignature({ signature: '', candidateUrls: [URL_SIGNED], params: PARAMS, authToken: AUTH_TOKEN }).outcome, 'unverifiable')
  assert.equal(evaluateTwilioSignature({ signature: validSignature, candidateUrls: [], params: PARAMS, authToken: AUTH_TOKEN }).outcome, 'unverifiable')
  // Misconfiguration must never be treated as forgery, even under enforcement.
  for (const reason of ['', null]) {
    const v = evaluateTwilioSignature({ signature: reason as any, candidateUrls: [URL_SIGNED], params: PARAMS, authToken: AUTH_TOKEN })
    assert.equal(shouldRejectRequest(v, 'enforce'), false, 'enforcement must not reject an unverifiable request')
  }
  console.log('  ✓ missing token / header / URL is unverifiable, and is never rejected even under enforcement')
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
  console.log('  ✓ route helper: forged passes in log-only, is rejected under enforcement, genuine always passes')
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

console.log('\n✅ webhook signature verification: valid accepted, forged rejected, OFF by default')
