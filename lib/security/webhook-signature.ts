// Inbound webhook signature verification — PROPOSED production fail-closed default.
// REVIEW-ONLY DRAFT: production Twilio signature/URL compatibility is NOT verified; do not release without owner approval.
//
// WHICH PATH IS LIVE
// ------------------
// The inbound WhatsApp webhook is TWILIO, not the Meta WhatsApp Cloud API:
//   · app/api/webhooks/whatsapp/route.ts parses req.formData() and reads Twilio
//     field names (From, ProfileName, NumMedia, MessageSid, SmsMessageSid, Body,
//     MediaUrl0, MediaContentType0, ButtonPayload). Meta posts JSON
//     (entry[].changes[].value.messages[]) and would match none of them.
//   · that route logs the inbound body under the literal key 'RAW_TWILIO:'.
//   · every response is TwiML with Content-Type text/xml, which is Twilio's
//     contract; Meta expects a bare 200.
//   · outbound goes through the twilio SDK (lib/whatsapp.ts), and TWILIO_AUTH_TOKEN
//     is referenced in 25 places across the codebase.
// The GET handler implements Meta's hub.challenge handshake, but no JSON POST path
// exists anywhere, so the Meta Cloud API path is vestigial for inbound messages.
//
// RELEASE-GATED PRODUCTION STRICT MODE (not yet approved)
// -------------------------------------------------------
// With NODE_ENV=production the default is strict signature validation: any verdict
// other than 'valid' returns 403, including missing verifier configuration. This
// avoids an unsigned request becoming an authenticated identity if secrets or URL
// resolution are missing. An EXPLICIT WEBHOOK_SIGNATURE_ENFORCE=0|false|off|log-only
// is a temporary operator escape hatch; its use must be audited and time bounded.
// Non-production keeps the pre-existing opt-in behavior for existing tests and
// local tools. Real Twilio callback/proxy URL compatibility MUST be independently
// verified before this change ships. Do not release solely on synthetic CI.

import crypto from 'node:crypto'

export type SignatureOutcome = 'valid' | 'invalid' | 'unverifiable'

export type SignatureVerdict = {
  outcome: SignatureOutcome
  reason: string
  matchedUrl?: string
  candidateCount: number
}

export type EnforcementMode = 'strict' | 'enforce' | 'log-only'

/**
 * Twilio's scheme: HMAC-SHA1, keyed with the account auth token, over the full
 * request URL followed by each POST parameter's name and value, sorted by name.
 * Implemented here rather than calling twilio.validateRequest so the verifier is
 * unit-testable offline and so the comparison is constant-time.
 */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return crypto.createHmac('sha1', authToken).update(Buffer.from(payload, 'utf-8')).digest('base64')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf-8')
  const right = Buffer.from(b, 'utf-8')
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

/**
 * Evaluate a signature against every URL the request could legitimately have been
 * signed with. Vercel sits behind a proxy, so the host/proto the app sees is not
 * necessarily what Twilio signed — rather than guess one, try each candidate and
 * report WHICH matched. In log-only mode that is the single most useful field in
 * the log: it tells you exactly what to pin before enforcing.
 */
export function evaluateTwilioSignature(input: {
  signature: string | null | undefined
  candidateUrls: string[]
  params: Record<string, string>
  authToken: string | null | undefined
}): SignatureVerdict {
  const candidates = input.candidateUrls.filter(Boolean)
  const signature = String(input.signature || '').trim()
  const authToken = String(input.authToken || '').trim()

  if (!authToken) return { outcome: 'unverifiable', reason: 'no_auth_token_configured', candidateCount: candidates.length }
  if (!signature) return { outcome: 'unverifiable', reason: 'no_signature_header', candidateCount: candidates.length }
  if (!candidates.length) return { outcome: 'unverifiable', reason: 'no_candidate_url', candidateCount: 0 }

  for (const url of candidates) {
    if (safeEqual(computeTwilioSignature(authToken, url, input.params), signature)) {
      return { outcome: 'valid', reason: 'signature_matched', matchedUrl: url, candidateCount: candidates.length }
    }
  }
  return { outcome: 'invalid', reason: 'no_candidate_url_matched', candidateCount: candidates.length }
}

export function signatureEnforcementMode(env: Record<string, string | undefined> = process.env): EnforcementMode {
  const raw = String(env.WEBHOOK_SIGNATURE_ENFORCE || '').trim().toLowerCase()
  const explicitlyOff = ['0', 'false', 'off', 'log-only'].includes(raw)
  // Production must not accept forged WhatsApp sender identities simply because an
  // optional flag was never configured. A temporary opt-out must be explicit.
  if (String(env.NODE_ENV || '').toLowerCase() === 'production' && !explicitlyOff) return 'strict'
  return ['1', 'true', 'on', 'enforce', 'strict'].includes(raw) ? 'enforce' : 'log-only'
}

/**
 * Every URL this request might have been signed with, most trustworthy first.
 * An explicitly configured URL wins, exactly as the twilio-status route does it.
 */
export function candidateWebhookUrls(
  requestUrl: string,
  headers: { get(name: string): string | null },
  env: Record<string, string | undefined> = process.env,
): string[] {
  const out: string[] = []
  const configured = String(env.TWILIO_WHATSAPP_WEBHOOK_URL || '').trim()
  if (configured) out.push(configured)

  try {
    const parsed = new URL(requestUrl)
    const forwardedHost = headers.get('x-forwarded-host') || headers.get('host')
    const forwardedProto = headers.get('x-forwarded-proto') || 'https'
    if (forwardedHost) out.push(`${forwardedProto}://${forwardedHost}${parsed.pathname}`)
    out.push(`${parsed.origin}${parsed.pathname}`)
    if (parsed.search) {
      if (forwardedHost) out.push(`${forwardedProto}://${forwardedHost}${parsed.pathname}${parsed.search}`)
      out.push(parsed.href)
    }
  } catch {
    /* an unparseable request URL just means fewer candidates */
  }
  return [...new Set(out)]
}

/**
 * In production strict mode ONLY a cryptographically valid verdict is accepted.
 * Local/test legacy 'enforce' retains opt-in behavior (missing local configuration
 * is audit-only), and explicit 'log-only' never rejects.
 * Strict mode deliberately fails closed on unavailable verifier configuration:
 * an unauthenticated message must not be processed as another user's identity.
 */
export function shouldRejectRequest(verdict: SignatureVerdict, mode: EnforcementMode): boolean {
  if (mode === 'strict') return verdict.outcome !== 'valid'
  if (mode !== 'enforce') return false
  if (verdict.outcome === 'invalid') return true
  if (verdict.outcome === 'unverifiable' && verdict.reason === 'no_signature_header') return true
  return false
}

/**
 * Single call site for the route. Returns reject:true for any non-valid verdict
 * in strict mode, and preserves explicit log-only behavior for staged operations.
 */
export function auditInboundTwilioSignature(input: {
  requestUrl: string
  headers: { get(name: string): string | null }
  params: Record<string, string>
  route: string
  env?: Record<string, string | undefined>
}): { reject: boolean; verdict: SignatureVerdict; mode: EnforcementMode } {
  const env = input.env || process.env
  const mode = signatureEnforcementMode(env)
  const verdict = evaluateTwilioSignature({
    signature: input.headers.get('x-twilio-signature'),
    candidateUrls: candidateWebhookUrls(input.requestUrl, input.headers, env),
    params: input.params,
    authToken: env.TWILIO_AUTH_TOKEN,
  })
  const reject = shouldRejectRequest(verdict, mode)
  // One structured audit line per inbound request. Independent provider-level
  // callback evidence is required before strict enforcement may be released.
  console.log('WEBHOOK_SIGNATURE_AUDIT:', JSON.stringify({
    route: input.route,
    mode,
    outcome: verdict.outcome,
    reason: verdict.reason,
    matchedUrl: verdict.matchedUrl || null,
    candidateCount: verdict.candidateCount,
    // What production strict validation would reject, including misconfiguration.
    // Distinct from the actual runtime 'rejected' field when explicitly log-only.
    wouldReject: shouldRejectRequest(verdict, 'strict'),
    rejected: reject,
  }))
  return { reject, verdict, mode }
}
