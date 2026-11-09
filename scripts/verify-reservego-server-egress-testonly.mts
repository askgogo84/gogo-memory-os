// P1 conditional server-egress regression: ReserveGo widget discovery must never fetch
// a caller/search-controlled private address or automatically follow unsafe redirects.
// Inert test-only fixtures: NO real network, provider, database, credentials, or customer data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findReservegoWidget, reservegoOutletId } from '../lib/agent/reservego'

const OUTLET = '63c18b9791da76efde2d82ec'
const WIDGET = `https://widget.reservego.co/reserveOutlets/${OUTLET}`
let pass = 0
let fail = 0

async function check(name: string, run: () => void | Promise<void>) {
  try {
    await run()
    pass++
    console.log('PASS ' + name)
  } catch (error) {
    fail++
    console.error('FAIL ' + name + ': ' + (error instanceof Error ? error.message : String(error)))
  }
}

// Return a safe public HTML fixture; the fake never performs a real fetch.
const safeFetchCalls: { url: string; redirect?: RequestRedirect }[] = []
const safeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  safeFetchCalls.push({ url: String(url), redirect: init?.redirect })
  return new Response(`<main><a href="${WIDGET}">Book</a></main>`, {
    status: 200, headers: { 'content-type': 'text/html' },
  })
}) as typeof fetch

await check('positive: authenticated ReserveGo widget id is read without any server fetch', async () => {
  safeFetchCalls.length = 0
  assert.equal(reservegoOutletId(WIDGET), OUTLET)
  assert.deepEqual(await findReservegoWidget(WIDGET, safeFetch), { outletId: OUTLET, widgetUrl: WIDGET })
  assert.deepEqual(safeFetchCalls, [])
})

await check('positive: a public restaurant page can supply an exact ReserveGo widget link', async () => {
  safeFetchCalls.length = 0
  const found = await findReservegoWidget('https://toit.example/reserve', safeFetch)
  assert.deepEqual(found, { outletId: OUTLET, widgetUrl: WIDGET })
  assert.equal(safeFetchCalls.length, 1)
  assert.equal(safeFetchCalls[0].url, 'https://toit.example/reserve')
})

await check('positive: plaintext HTTP destination fails closed before a server fetch', async () => {
  safeFetchCalls.length = 0
  assert.equal(await findReservegoWidget('http://toit.example/reserve', safeFetch), null)
  assert.deepEqual(safeFetchCalls, [])
})

await check('positive: reservation handler connects provider URL to this server-side helper', () => {
  const src = readFileSync('lib/agent/restaurant-reservation.ts', 'utf8')
  assert.match(src, /reservego\.findReservegoWidget\(provider\.url\)/)
  assert.match(src, /if\(intent\.sourceUrl\)return\{url:intent\.sourceUrl/)
})

for (const [label, url] of [
  ['loopback IPv4', 'https://127.0.0.1/private'],
  ['link-local metadata host', 'https://169.254.169.254/latest/meta-data'],
  ['loopback IPv6', 'https://[::1]/admin'],
  ['credentialed URL with private effective hostname', 'https://restaurant.example@127.0.0.1/private'],
] as const) {
  await check('SAFETY: ' + label + ' denied before any server-side request', async () => {
    const attempted: string[] = []
    const spy = (async (target: string | URL | Request) => {
      attempted.push(String(target))
      return new Response('no widget', { status: 404 })
    }) as typeof fetch
    const result = await findReservegoWidget(url, spy)
    assert.equal(result, null)
    assert.deepEqual(attempted, [], 'unsafe target must never be submitted to fetch')
  })
}

await check('SAFETY: no automatic redirect following from an arbitrary public provider page', async () => {
  const redirectModes: (RequestRedirect | undefined)[] = []
  const simulatedPrivateHops: string[] = []
  const redirectSpy = (async (_url: string | URL | Request, init?: RequestInit) => {
    redirectModes.push(init?.redirect)
    // Simulate what a native fetch with redirect:follow would attempt.
    // No second network request is actually made by this fake transport.
    if (init?.redirect !== 'manual' && init?.redirect !== 'error') {
      simulatedPrivateHops.push('https://127.0.0.1/private')
    }
    return new Response('', { status: 302, headers: { location: 'https://127.0.0.1/private' } })
  }) as typeof fetch
  assert.equal(await findReservegoWidget('https://restaurant.example/reserve', redirectSpy), null)
  assert.equal(redirectModes.length, 1, 'one origin read only')
  assert.deepEqual(simulatedPrivateHops, [], 'redirects must be manually validated, not auto-followed')
  assert.ok(redirectModes[0] === 'manual' || redirectModes[0] === 'error',
    'redirect policy must not automatically connect to the redirected private destination')
})

console.log(`ReserveGo egress synthetic results: ${pass} positive/safety assertions PASS, ${fail} safety assertions FAIL`)
if (fail) process.exitCode = 1
