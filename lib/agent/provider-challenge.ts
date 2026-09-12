// Deterministic detection of provider anti-bot interstitials (Cloudflare "Attention
// Required!" / "you have been blocked" pages) so the agent can hand the task off to
// the user's already-authenticated device instead of retrying a request that is
// blocked by datacenter-IP reputation.
//
// We DO NOT attempt to solve, bypass, or evade the challenge (no UA rotation, no
// cookie replay, no proxying). Detection is purely observational: when a provider
// serves a challenge, the only legitimate routes are the redirect-resolved deep
// link (opened on the user's device) and any connected-account confirmation
// (e.g. Gmail). See secure-ticket-reader.ts / booking-closure.ts for the handoff.
//
// Verified live against BookMyShow (bmsurl.co -> in.bookmyshow.com): the resolved
// page returns HTTP 403 with `server: cloudflare` and a "Attention Required! |
// Cloudflare" body carrying no OpenGraph/JSON-LD/structured booking data.

export const PROVIDER_CLOUDFLARE_CHALLENGE = 'provider_cloudflare_challenge'
export const DEVICE_HANDOFF_REQUIRED = 'device_handoff_required'

export type ProviderChallenge = {
  challenged: boolean
  provider?: 'cloudflare'
  signal?: string
}

/**
 * Detect a Cloudflare challenge/block from a rendered page model (title + text).
 * Signatures are chosen to be specific to Cloudflare's interstitial/block pages
 * so they do not fire on ordinary booking content that merely mentions the word
 * "cloudflare" or a generic captcha (generic captchas stay on the human-auth path).
 */
export function detectProviderChallenge(page: { title?: string; text?: string }): ProviderChallenge {
  const raw = `${String(page?.title || '')}\n${String(page?.text || '')}`.slice(0, 20000)
  const t = raw.toLowerCase()

  // Canonical Cloudflare interstitial title — strongest single signal.
  if (/attention required!?\s*\|\s*cloudflare/i.test(raw)) {
    return { challenged: true, provider: 'cloudflare', signal: 'attention_required_title' }
  }
  // Classic "I'm Under Attack" interstitial.
  if (/checking your browser before accessing/.test(t)) {
    return { challenged: true, provider: 'cloudflare', signal: 'im_under_attack' }
  }
  // Managed challenge markup / turnstile challenge host.
  if (/__cf_chl|cf-browser-verification|cf_chl_opt|challenges\.cloudflare\.com/.test(t)) {
    return { challenged: true, provider: 'cloudflare', signal: 'cf_challenge_script' }
  }
  const mentionsCloudflare = /\bcloudflare\b/.test(t)
  if (mentionsCloudflare && /sorry, you have been blocked/.test(t)) {
    return { challenged: true, provider: 'cloudflare', signal: 'blocked' }
  }
  // Block page pattern: Cloudflare + a Ray ID + a human/cookie gate.
  if (mentionsCloudflare && /ray id/.test(t) && /(please enable cookies|verify you are human|you have been blocked)/.test(t)) {
    return { challenged: true, provider: 'cloudflare', signal: 'ray_id_gate' }
  }
  return { challenged: false }
}

/**
 * HTTP-level detection for the static server-side fetch path (response headers +
 * a small body sample). A challenged provider fronted by Cloudflare returns
 * 403/429/503 with `server: cloudflare` (or a `cf-mitigated: challenge` header).
 * We still require a body marker on the status path so an ordinary authenticated
 * 403 is not mistaken for a challenge.
 */
export function isCloudflareHttpChallenge(input: {
  status: number
  server?: string | null
  cfMitigated?: string | null
  bodySample?: string
}): boolean {
  if (String(input.cfMitigated || '').toLowerCase() === 'challenge') return true
  const isCloudflare = String(input.server || '').toLowerCase().includes('cloudflare')
  if (isCloudflare && [403, 429, 503].includes(Number(input.status))) {
    const body = String(input.bodySample || '')
    if (detectProviderChallenge({ text: body }).challenged) return true
    return /attention required|sorry, you have been blocked|cf-browser-verification|ray id/i.test(body)
  }
  return false
}
