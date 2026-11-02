// P1 SSRF containment regression. Synthetic URLs, injected in-memory HTTP only.
// Run: npx --no-install tsx scripts/verify-reservego-ssrf-containment-fix.mts
// NEVER connect to real hosts, browsers, providers, accounts or databases.
import assert from 'node:assert/strict'
import {findReservegoWidget, reservegoOutletId} from '../lib/agent/reservego'

const outlet = '63c18b9791da76efde2d82ec'
const widget = `https://widget.reservego.co/reserveOutlets/${outlet}?source=inert`
const html = `<main><a href="${widget}">Synthetic booking link</a></main>`
const seen: Array<{url: string; init: RequestInit}> = []
const fetcher = (async (url: string | URL | Request, init: RequestInit = {}) => {
  seen.push({url: String(url), init})
  const body = String(url).includes('nowidget.example') ? '<main>No reservation widget</main>' : html
  return new Response(body, {status: 200, headers: {'content-type':'text/html'}})
}) as typeof fetch

let controlPass = 0, controlFail = 0, mandatoryPass = 0, mandatoryFail = 0
async function check(label: string, mandatory: boolean, fn: () => Promise<void> | void) {
  seen.length = 0
  try {
    await fn()
    if (mandatory) mandatoryPass++
    else controlPass++
    console.log(`PASS [${mandatory ? 'MANDATORY' : 'CONTROL'}] ${label}`)
  } catch (err) {
    if (mandatory) mandatoryFail++
    else controlFail++
    console.error(`FAIL [${mandatory ? 'MANDATORY' : 'CONTROL'}] ${label}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

await check('valid direct ReserveGo widget host/id is recognized and other host denied', false, () => {
  assert.equal(reservegoOutletId(widget), outlet)
  assert.equal(reservegoOutletId(`https://widget.reservego.com/reserveOutlets/${outlet}`), outlet)
  assert.equal(reservegoOutletId(`https://evil.example/reserveOutlets/${outlet}`), null)
})
await check('direct trusted widget requires no page fetch', false, async () => {
  assert.deepEqual(await findReservegoWidget(widget, fetcher), {outletId:outlet,widgetUrl:widget})
  assert.equal(seen.length, 0)
})
await check('HTTP restaurant page is rejected', false, async () => {
  assert.equal(await findReservegoWidget('http://ordinary-restaurant.example/book', fetcher), null)
  assert.equal(seen.length, 0)
})
await check('invalid URL is rejected', false, async () => {
  assert.equal(await findReservegoWidget('not a URL', fetcher), null)
  assert.equal(seen.length, 0)
})
await check('benign public page works with explicitly supplied fake transport', false, async () => {
  assert.deepEqual(await findReservegoWidget('https://toit.example/reservations', fetcher), {outletId:outlet,widgetUrl:widget})
  assert.equal(seen.length, 1)
  assert.equal(seen[0].init.redirect, 'error')
})
await check('benign public mock without widget returns no result', false, async () => {
  assert.equal(await findReservegoWidget('https://nowidget.example/book', fetcher), null)
  assert.equal(seen.length, 1)
})

const forbidden = [
  'https://127.0.0.1:8443/admin',
  'https://10.1.2.3/metadata',
  'https://192.168.7.2/private',
  'https://172.20.0.1/internal',
  'https://169.254.169.254/latest/meta-data',
  'https://localhost:443/admin',
  'https://[::1]/admin',
  'https://2130706433/admin',
  'https://0x7f000001/admin',
  'https://sub.localhost/private',
]
for (const url of forbidden) {
  await check(`reject local or IP destination BEFORE even injected fetch: ${url}`, true, async () => {
    assert.equal(await findReservegoWidget(url, fetcher), null)
    assert.equal(seen.length, 0, 'unsafe destination reached an injected transport')
  })
}

await check('no auto-follow of an untrusted public redirect to private address', true, async () => {
  let initUsed: RequestInit | undefined
  const redirectFixture = (async (_url: string | URL | Request, init: RequestInit = {}) => {
    initUsed = init
    return new Response(null, {status: 302, headers: {Location:'https://127.0.0.1/admin'}})
  }) as typeof fetch
  assert.equal(await findReservegoWidget('https://ordinary-restaurant.example/booking', redirectFixture), null)
  assert.equal(initUsed?.redirect, 'error', 'fetch must explicitly reject redirects rather than follow')
})

await check('production call does NOT invoke global fetch even for public-looking restaurant URL', true, async () => {
  const previous = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (url: string | URL | Request) => {
    requests.push(String(url))
    return new Response(html, {status:200})
  }) as typeof fetch
  try {
    assert.equal(await findReservegoWidget('https://ordinary-restaurant.example/book'), null)
    assert.equal(requests.length, 0, 'untrusted production URL reached the app-server global fetch')
  } finally {
    globalThis.fetch = previous
  }
})

await check('direct widget with HTTP or embedded credentials is rejected', true, async () => {
  const invalid = [
    `http://widget.reservego.co/reserveOutlets/${outlet}`,
    `https://user@widget.reservego.co/reserveOutlets/${outlet}`,
    `https://user:password@widget.reservego.co/reserveOutlets/${outlet}`,
  ]
  for (const url of invalid) {
    assert.equal(reservegoOutletId(url), null)
    assert.equal(await findReservegoWidget(url, fetcher), null)
  }
  assert.equal(seen.length, 0)
})

await check('alternate HTTPS port and internal .home.arpa never access injected transport', true, async () => {
  for (const url of ['https://ordinary-restaurant.example:8443/private', 'https://router.home.arpa/']) {
    assert.equal(await findReservegoWidget(url, fetcher), null)
  }
  assert.equal(seen.length, 0)
})
console.log(`RESERVEGO SSRF CONTAINMENT controlPass=${controlPass} controlFail=${controlFail} mandatoryPass=${mandatoryPass} mandatoryFail=${mandatoryFail}; syntheticOnly=true`)
if (controlFail) process.exitCode = 2
else if (mandatoryFail) process.exitCode = 1
