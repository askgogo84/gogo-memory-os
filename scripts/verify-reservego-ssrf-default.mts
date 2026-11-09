// Original-module SSRF regression; all URLs and fetches are synthetic and inert.
// Production findReservegoWidget(provider.url) must never fetch an untrusted page.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findReservegoWidget, reservegoOutletId } from '../lib/agent/reservego'

const OUTLET = '63c18b9791da76efde2d82ec'
const WIDGET = `https://widget.reservego.co/reserveOutlets/${OUTLET}?source=9`
const previousFetch = globalThis.fetch
const attempted: string[] = []
globalThis.fetch = (async (url: RequestInfo | URL) => {
  attempted.push(String(url))
  throw new Error('GLOBAL_FETCH_MUST_NEVER_RUN_IN_FIXTURE')
}) as typeof fetch

try {
  for (const url of [
    'https://restaurant.example/booking',
    'https://redirector.example/to-http-metadata',
    'https://127.0.0.1:8443/admin',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost:3000/internal',
    'https://10.0.0.1/private',
    'https://[::1]/private',
    'http://restaurant.example/booking',
    'not-a-url',
  ]) {
    assert.equal(await findReservegoWidget(url), null, `production must not fetch ${url}`)
  }
  assert.deepEqual(attempted, [], 'production default did no server-side untrusted URL fetch')

  // A validated direct HTTPS ReserveGo widget requires no HTML fetch.
  assert.equal(reservegoOutletId(WIDGET), OUTLET)
  assert.deepEqual(await findReservegoWidget(WIDGET), { outletId: OUTLET, widgetUrl: WIDGET })
  assert.deepEqual(attempted, [], 'known direct widget detection is URL-only')
  for (const url of [
    `http://widget.reservego.co/reserveOutlets/${OUTLET}`,
    `ftp://widget.reservego.co/reserveOutlets/${OUTLET}`,
    `https://widget.reservego.co.evil.example/reserveOutlets/${OUTLET}`,
    `https://user:pass@widget.reservego.co/reserveOutlets/${OUTLET}`,
  ]) assert.equal(reservegoOutletId(url), null, `reject unsafe widget URL ${url}`)

  // Old HTML extraction remains testable only with an explicit INERT transport.
  const fixtureCalls: { url: string; redirect: string | undefined }[] = []
  const pageFetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    fixtureCalls.push({ url: String(url), redirect: init?.redirect })
    assert.equal(String(url), 'https://restaurant.example/booking')
    return new Response(`<a href="${WIDGET.replace('&', '&amp;')}">Book</a>`, { status: 200 })
  }) as typeof fetch
  assert.deepEqual(await findReservegoWidget('https://restaurant.example/booking', pageFetcher),
    { outletId: OUTLET, widgetUrl: WIDGET })
  assert.deepEqual(fixtureCalls, [{ url: 'https://restaurant.example/booking', redirect: 'manual' }])
  assert.deepEqual(attempted, [], 'explicit mock did not invoke global fetch')

  // A 302 to an internal host cannot auto-follow even under an injected transport.
  const redirected = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.redirect, 'manual')
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
  }) as typeof fetch
  assert.equal(await findReservegoWidget('https://redirector.example/booking', redirected), null)
  assert.deepEqual(attempted, [], 'redirect remains inert')

  // Existing caller retains its secure-browser fallback after widget discovery fails.
  const caller = readFileSync('lib/agent/restaurant-reservation.ts', 'utf8')
  assert.match(caller, /findReservegoWidget\(provider\.url\)/)
  assert.match(caller, /runSecureBrowser\(/)
} finally {
  globalThis.fetch = previousFetch
}
console.log('ReserveGo SSRF fixture: direct trusted widgets preserved; no arbitrary production fetch or redirect-follow')
