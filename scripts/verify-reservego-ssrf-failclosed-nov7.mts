// P1 ReserveGo read-only discovery containment. INERT; never accesses external
// restaurants, private hosts, a browser, provider accounts, credentials or bookings.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'ci-placeholder-service-role-key'
process.env.OPENAI_API_KEY ||= 'ci-placeholder-openai-key'
process.env.ANTHROPIC_API_KEY ||= 'ci-placeholder-anthropic-key'

const { findReservegoWidget, reservegoOutletId } = await import('../lib/agent/reservego')
const widgetId = '63c18b9791da76efde2d82ec'
const widget = 'https://widget.reservego.co/reserveOutlets/' + widgetId + '?channel=Widget'
let globalFetchCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = (async (_input: unknown) => {
  globalFetchCalls++
  // A real provider page might redirect to 169.254.169.254 or a private host.
  // If this is ever hit, the security regression fails without any real network.
  throw Error('unsafe_default_server_fetch')
}) as typeof fetch

try {
  const hostile = [
    'https://attacker.example/redirect-to-link-local',
    'https://attacker.example/redirect-to-loopback',
    'https://169.254.169.254/latest/meta-data',
    'https://127.0.0.1/admin',
    'https://10.10.10.10/private',
    'https://[::1]/admin',
    'https://public-restaurant.example/real-restaurant',
  ]
  for (const url of hostile) {
    assert.equal(await findReservegoWidget(url), null, 'no arbitrary app-server fetch: ' + url)
  }
  assert.equal(globalFetchCalls, 0, 'even public-looking URLs must not fetch via unsafe default')
  assert.deepEqual(await findReservegoWidget(widget), { outletId: widgetId, widgetUrl: widget },
    'trusted first-party widget link needs no page fetch')
  assert.equal(globalFetchCalls, 0, 'a direct trusted widget remains zero network calls')

  let injectedCalls = 0
  const inertPageFetch = (async (url: string, opts: any) => {
    injectedCalls++
    assert.equal(url, 'https://test-restaurant.example/book')
    assert.equal(opts.redirect, 'follow', 'historical injected fixture behavior remains testable')
    return new Response('<a href="' + widget.replace('&','&amp;') + '">Open tables</a>',
      { status: 200, headers: { 'content-type': 'text/html' } })
  }) as typeof fetch
  const result = await findReservegoWidget('https://test-restaurant.example/book', inertPageFetch)
  assert.deepEqual(result, { outletId: widgetId, widgetUrl: widget },
    'synthetic transport preserves widget discovery fixture')
  assert.equal(injectedCalls, 1)
  assert.equal(globalFetchCalls, 0)
  assert.equal(await findReservegoWidget('http://test-restaurant.example/book', inertPageFetch), null)
  assert.equal(injectedCalls, 1, 'non-HTTPS URL must not use even test transport')
  assert.equal(reservegoOutletId('https://evil.example/reserveOutlets/' + widgetId), null)
  assert.equal(globalFetchCalls, 0)
} finally {
  globalThis.fetch = originalFetch
}

const source = readFileSync('lib/agent/reservego.ts', 'utf8')
const caller = readFileSync('lib/agent/restaurant-reservation.ts', 'utf8')
const widgetStart = source.indexOf('export async function findReservegoWidget(')
const widgetEnd = source.indexOf('/** "07:00 PM"', widgetStart)
assert.ok(widgetStart >= 0 && widgetEnd > widgetStart, 'isolate original widget discovery only')
const widgetSource = source.slice(widgetStart, widgetEnd)
assert.match(widgetSource, /if \(!fetcher\) return null/, 'production default fail-closed guard is mandatory')
assert.doesNotMatch(widgetSource, /fetcher:\s*typeof fetch\s*=\s*fetch/,
  'widget discovery must not default to global fetch; fixed ReserveGo API feed is separate')
assert.match(caller, /findReservegoWidget\(provider\.url\)/,
  'production caller must not inject unreviewed transport')
assert.match(caller, /runSecureBrowser\(/,
  'regular reservation fallback still uses the existing secure browser')
console.log('PASS ReserveGo SSRF containment: synthetic injected transport only; default server fetch calls=0')
