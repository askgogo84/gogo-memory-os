import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  detectProviderChallenge,
  isCloudflareHttpChallenge,
  PROVIDER_CLOUDFLARE_CHALLENGE,
  DEVICE_HANDOFF_REQUIRED,
} from '../lib/agent/provider-challenge.ts'

// Constants are the deterministic contract shared across surfaces.
assert.equal(PROVIDER_CLOUDFLARE_CHALLENGE, 'provider_cloudflare_challenge')
assert.equal(DEVICE_HANDOFF_REQUIRED, 'device_handoff_required')

// --- Positive: real BookMyShow/Cloudflare block page (verified live) ---
const bmsBlock = {
  title: 'Attention Required! | Cloudflare',
  text: 'Sorry, you have been blocked. You are unable to access bookmyshow.com. Ray ID: a39f69ca. Please enable cookies. Performance & security by Cloudflare.',
}
const c1 = detectProviderChallenge(bmsBlock)
assert.equal(c1.challenged, true, 'BMS Cloudflare block must be detected')
assert.equal(c1.provider, 'cloudflare')

// Other Cloudflare shapes.
assert.equal(detectProviderChallenge({ text: 'Checking your browser before accessing example.com' }).challenged, true)
assert.equal(detectProviderChallenge({ text: 'please wait <div class="cf-browser-verification"> __cf_chl_opt' }).challenged, true)
assert.equal(detectProviderChallenge({ title: 'Just a moment...', text: 'challenges.cloudflare.com/turnstile' }).challenged, true)

// --- Negative: legitimate booking content must NOT be flagged ---
assert.equal(detectProviderChallenge({ title: 'Your Movie Ticket', text: 'PVR: Oppenheimer. Seats G7, G8. Show your QR at entry.' }).challenged, false)
// A page that merely mentions the word cloudflare (e.g. "secured by Cloudflare" footer) is not a challenge.
assert.equal(detectProviderChallenge({ text: 'This site is protected by Cloudflare. Booking confirmed.' }).challenged, false)
// A generic captcha with no Cloudflare markers stays on the human-auth path.
assert.equal(detectProviderChallenge({ text: 'Please verify you are human to continue.' }).challenged, false)

// --- HTTP-level detection for the static fetch path ---
assert.equal(isCloudflareHttpChallenge({ status: 403, server: 'cloudflare', bodySample: 'Attention Required! | Cloudflare' }), true, '403 + cloudflare + marker is a challenge')
assert.equal(isCloudflareHttpChallenge({ status: 503, server: 'cloudflare', bodySample: 'sorry, you have been blocked' }), true)
assert.equal(isCloudflareHttpChallenge({ status: 200, server: 'cloudflare', cfMitigated: 'challenge' }), true, 'cf-mitigated header is authoritative')
// An ordinary 403 without challenge markers is NOT treated as a device-handoff challenge.
assert.equal(isCloudflareHttpChallenge({ status: 403, server: 'cloudflare', bodySample: '{"error":"forbidden"}' }), false)
assert.equal(isCloudflareHttpChallenge({ status: 200, server: 'cloudflare', bodySample: '<html>ok</html>' }), false)

// --- Wiring guards: the handoff contract must be present where it matters ---
const ticket = readFileSync(new URL('../lib/agent/secure-ticket-reader.ts', import.meta.url), 'utf8')
const closure = readFileSync(new URL('../lib/agent/booking-closure.ts', import.meta.url), 'utf8')
const watcher = readFileSync(new URL('../lib/agent/booking-change-worker.ts', import.meta.url), 'utf8')

// Ticket reader emits the challenge reason + device handoff, and must NOT fall
// back to the sandbox browser (same datacenter IP -> same block).
assert.match(ticket, /detectProviderChallenge/)
assert.match(ticket, /provider_cloudflare_challenge/)
assert.match(ticket, /device_handoff_required/)

// Closure surfaces a device handoff and does not arm a browser retry watch on challenge.
assert.match(closure, /deviceHandoff/)
assert.match(closure, /provider_cloudflare_challenge/)

// The change watcher STOPS (completes) on a Cloudflare challenge instead of deferring forever.
assert.match(watcher, /provider_cloudflare_challenge/)
assert.match(watcher, /await complete\(/)

console.log('provider challenge (cloudflare -> device handoff) verification passed')
