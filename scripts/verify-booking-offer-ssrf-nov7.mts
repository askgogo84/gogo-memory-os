// Inert original-module booking-listing SSRF regression. NO real network or bookings.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'ci-placeholder-service-role-key'
process.env.OPENAI_API_KEY ||= 'ci-placeholder-openai-key'
process.env.ANTHROPIC_API_KEY ||= 'ci-placeholder-anthropic-key'

const be = await import('../lib/agent/booking-engine.ts')
const base = be.collectBookingOptions([
  { url: 'https://www.swiggy.com/dineout/bangalore/fixture', title: 'Synthetic venue', snippet: 'Book a table' },
  { url: 'https://www.district.in/restaurants/fixture', title: 'Synthetic venue', snippet: '' },
  { url: 'https://www.eazydiner.com/bangalore/fixture', title: 'Synthetic venue', snippet: 'Up to 25% off' },
], [])
assert.equal(base.length, 3)
assert.equal(base.filter(o => o.offer !== null).length, 1)

// The real caller omits the transport. An HTTPS search result is NOT a safe network destination:
// its origin can redirect into private/link-local hosts *before* any final-host validation.
let ambientCalls = 0
const originalFetch = globalThis.fetch
;(globalThis as any).fetch = async () => { ambientCalls++; throw new Error('FORBIDDEN AMBIENT NETWORK') }
try {
  const unchanged = await be.enrichOffersFromListings(base)
  assert.deepEqual(unchanged, base, 'production defaults to safe public snippets with NO app-server GET')
  assert.equal(ambientCalls, 0, 'no implicit fetch of external provider listings')
  assert.equal(unchanged[2].offer?.percent, 25, 'public search offers must be preserved')
  assert.deepEqual(be.rankBookingOptions(unchanged)[0].platform.id, 'eazydiner', 'offer ranking intact')
} finally { globalThis.fetch = originalFetch }

// Explicit test-only injected transport retains the old offer parser, but NEVER follows redirects.
const called: Array<{ url: string; redirect: unknown }> = []
const injected = (async (url: string, init: RequestInit) => {
  called.push({ url, redirect: init.redirect })
  assert.equal(init.redirect, 'manual', 'a provider must not redirect a server GET into a private host')
  if (url.includes('swiggy.com')) return new Response('<div>Flat 20% off on total bill</div>', { status: 200 })
  if (url.includes('district.in')) return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } })
  throw Error('unexpected synthetic destination')
}) as typeof fetch
const enriched = await be.enrichOffersFromListings(base, injected)
assert.equal(enriched[0].offer?.percent, 20)
assert.equal(enriched[1].offer, null, 'a redirect is not evidence of a provider offer')
assert.equal(enriched[2].offer?.percent, 25, 'already-listed offer requires no extra network')
assert.equal(called.length, 2, 'only two missing-offer platforms queried using the fixture transport')
assert.ok(!called.some(c => c.url.includes('169.254.')), 'redirect target never requested')
assert.equal(enriched[0].connected, base[0].connected)

// Defense-in-depth: even synthetic transports cannot receive cross-platform, plain HTTP,
// embedded credentials, or URLs not issued for a supported booking platform.
const badUrls = [
  'http://www.swiggy.com/dineout/fixture',
  'https://evil.example/offer',
  'https://www.swiggy.com.evil.example/dineout/fixture',
  'https://user:password@www.swiggy.com/dineout/fixture',
  'https://www.eazydiner.com/fixture',
]
for (const url of badUrls) {
  const crafted = { ...base[0], url, offer: null }
  const before = called.length
  const out = await be.enrichOffersFromListings([crafted], injected)
  assert.deepEqual(out, [crafted], 'untrusted listing option must not be fetched: ' + url)
  assert.equal(called.length, before, 'untrusted option never reaches injected fetcher')
}

// Lock source-level integration: real restaurant flow must not inject an unrestricted global fetch.
const caller = readFileSync(new URL('../lib/agent/restaurant-reservation.ts', import.meta.url), 'utf8')
assert.match(caller, /engine\.enrichOffersFromListings\(options\)/, 'default safe snippet path used in production')
const source = readFileSync(new URL('../lib/agent/booking-engine.ts', import.meta.url), 'utf8')
const fn = source.slice(source.indexOf('export async function enrichOffersFromListings('))
assert.match(fn, /fetchImpl\?: typeof fetch/, 'transport is opt-in and never defaults to ambient fetch')
assert.match(fn, /if \(!fetchImpl\) return options/, 'no network on the default production path')
assert.doesNotMatch(fn, /redirect:\s*['"]follow['"]/, 'automatic redirects forbidden')
console.log('BOOKING_OFFER_SSRF_FAILCLOSED_OK — inert production and injected tests')
