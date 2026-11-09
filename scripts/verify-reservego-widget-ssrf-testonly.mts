// TEST-ONLY (expected mandatory SSRF RED on the unchanged source): no real network or providers.
// Run: npx tsx scripts/verify-reservego-widget-ssrf-testonly.mts
import assert from 'node:assert/strict'
import { findReservegoWidget, reservegoOutletId } from '../lib/agent/reservego'

const outlet = '63c18b9791da76efde2d82ec'
const widget = `https://widget.reservego.co/reserveOutlets/${outlet}?source=inert`
const html = `<main><a href="${widget}">Synthetic reservation widget</a></main>`
type FetchEntry = { url: string; init: RequestInit }
const seen: FetchEntry[] = []
const fetcher = (async (url: string | URL | Request, init: RequestInit = {}) => {
  // This is the ONLY transport allowed by this test. It never accesses the network.
  seen.push({url: String(url), init})
  const body = String(url).includes('nowidget.example') ? '<main>No widget</main>' : html
  return new Response(body, {status: 200, headers: {'content-type': 'text/html'}})
}) as typeof fetch

let controlPass = 0, controlFail = 0, mandatoryPass = 0, mandatoryFail = 0
async function check(name: string, mandatory: boolean, run: () => Promise<void> | void) {
  seen.length = 0
  try {
    await run()
    if (mandatory) mandatoryPass++
    else controlPass++
    console.log(`PASS [${mandatory ? 'MANDATORY' : 'CONTROL'}] ${name}`)
  } catch (err) {
    if (mandatory) mandatoryFail++
    else controlFail++
    const why = err instanceof Error ? err.message : String(err)
    console.error(`FAIL [${mandatory ? 'MANDATORY' : 'CONTROL'}] ${name}: ${why}`)
  }
}

await check('recognized direct ReserveGo URL parses exactly', false, () => {
  assert.equal(reservegoOutletId(widget), outlet)
  assert.equal(reservegoOutletId(`https://other.example/reserveOutlets/${outlet}`), null)
})
await check('direct ReserveGo widget needs no additional page fetch', false, async () => {
  assert.deepEqual(await findReservegoWidget(widget, fetcher), {outletId:outlet,widgetUrl:widget})
  assert.equal(seen.length, 0)
})
await check('HTTP provider page is not fetched', false, async () => {
  assert.equal(await findReservegoWidget('http://example.com/booking', fetcher), null)
  assert.equal(seen.length, 0)
})
await check('invalid URL is rejected before fetch', false, async () => {
  assert.equal(await findReservegoWidget('not a URL', fetcher), null)
  assert.equal(seen.length, 0)
})
await check('benign public HTTPS page with a widget is read using only fake transport', false, async () => {
  assert.deepEqual(await findReservegoWidget('https://toit.example/reservations', fetcher), {outletId:outlet,widgetUrl:widget})
  assert.equal(seen.length, 1)
})
await check('benign public HTTPS page lacking widget has no result', false, async () => {
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
]
for (const url of forbidden) {
  await check(`private/internal destination must never invoke server fetch: ${url}`, true, async () => {
    const result = await findReservegoWidget(url, fetcher)
    assert.equal(seen.length, 0, `untrusted destination ${url} reached server fetch`)
    assert.equal(result, null, 'private/internal destination must not produce a widget result')
  })
}
await check('untrusted public page fetch must not auto-follow redirects into private networks', true, async () => {
  await findReservegoWidget('https://ordinary-restaurant.example/booking', fetcher)
  assert.ok(!seen.some(c => c.init.redirect === 'follow'), 'untrusted redirects are followed automatically before checking each destination')
})

console.log(`RESERVEGO SSRF DIAGNOSTIC control PASS=${controlPass} FAIL=${controlFail}; mandatory PASS=${mandatoryPass} FAIL=${mandatoryFail}`)
if (controlFail) process.exitCode = 2
else if (mandatoryFail) process.exitCode = 1
