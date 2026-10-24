// 19 Oct live: the browser timed out (browser_read_deadline) driving Toit's ReserveGo widget. The widget reads
// a public times feed; Gogo now reads the same feed. Fixture = the real response shape observed on 19 Oct.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'
const rg = await import('../lib/agent/reservego')
const OUTLET = '63c18b9791da76efde2d82ec'
const WIDGET = `https://widget.reservego.co/reserveOutlets/${OUTLET}?source=9`
const feed = {code: 'SUCCESS', message: 'Success', timeslots: [
  {slotName: 'Breakfast', status: 1, slots: [{Time: '08:30 AM', status: 1, available: 287, amount: '0'}]},
  {slotName: 'Lunch', status: 1, slots: [{Time: '12:00 PM', status: 1, available: 89, amount: '0'}, {Time: '12:30 PM', status: 0, available: 0, amount: '0'}]},
  {slotName: 'Dinner', status: 1, slots: [{Time: '05:30 PM', status: 1, available: 62, amount: '0'}, {Time: '06:00 PM', status: 1, available: 62, amount: '0'}, {Time: '06:30 PM', status: 1, available: 62, amount: '0'}, {Time: '07:00 PM', status: 1, available: 62, amount: '500'}, {Time: '07:30 PM', status: 1, available: 0, amount: '0'}]},
  {slotName: 'Late', status: 0, slots: [{Time: '10:00 PM', status: 1, available: 9, amount: '0'}]},
]}
let calls: any[] = []
const fetcher = (async (url: any, init: any = {}) => {
  calls.push({url: String(url), init})
  if (String(url).startsWith('https://api.reservego.co/api/bookings/widgets/timeSlots')) return new Response(JSON.stringify(feed), {status: 200})
  if (String(url) === 'https://toit.in/bangalore-reservation/') return new Response(`<a href="${WIDGET.replace('&', '&amp;')}">Toit Bangalore</a>`, {status: 200})
  return new Response('not found', {status: 404})
}) as any

assert.equal(rg.reservegoOutletId(WIDGET), OUTLET)
assert.equal(rg.reservegoOutletId('https://widget.reservego.com/reserveOutlets/' + OUTLET), OUTLET)
assert.equal(rg.reservegoOutletId('https://evil.example/reserveOutlets/' + OUTLET), null, 'only reservego hosts')
assert.equal(rg.reservegoOutletId('http://widget.reservego.co/reserveOutlets/' + OUTLET), null, 'direct widget requires HTTPS')
assert.equal(rg.reservegoOutletId('https://attacker@widget.reservego.co/reserveOutlets/' + OUTLET), null, 'no credentials in widget URL')
assert.equal(rg.reservegoClock('07:00 PM'), '19:00'); assert.equal(rg.reservegoClock('12:00 PM'), '12:00'); assert.equal(rg.reservegoClock('12:30 AM'), '00:30')

// The restaurant's own page links the widget → outlet found; a direct widget URL needs no page fetch.
assert.deepEqual(await rg.findReservegoWidget('https://toit.in/bangalore-reservation/', fetcher), {outletId: OUTLET, widgetUrl: WIDGET})
assert.equal(calls[0]?.init?.redirect, 'manual', 'injected page fixture also forbids automatic redirect following')
calls = []
assert.equal((await rg.findReservegoWidget(WIDGET, fetcher))?.outletId, OUTLET)
assert.equal(calls.length, 0)
assert.equal(await rg.findReservegoWidget('https://nowidget.example/', fetcher), null)

// Independently confirmed SSRF boundary: a search-discovered first-party URL,
// including a public redirector or cloud metadata IP, must NOT cause the normal
// server call path to touch the network. No real network traffic in this test.
const originalFetch = globalThis.fetch
let unexpectedNetworkCalls = 0
globalThis.fetch = (async () => {
  unexpectedNetworkCalls++
  throw new Error('global server fetch must not run for untrusted page URLs')
}) as typeof fetch
try {
  for (const candidate of [
    'https://toit.in/bangalore-reservation/',
    'https://169.254.169.254/latest/meta-data/',
    'https://public.example/redirect-to-internal',
    'https://127.0.0.1/private',
    'https://[::1]/private',
  ]) {
    assert.equal(await rg.findReservegoWidget(candidate), null, 'untrusted server page read fails closed: ' + candidate)
  }
  assert.deepEqual(await rg.findReservegoWidget(WIDGET), {outletId: OUTLET, widgetUrl: WIDGET},
    'direct trusted widget extraction survives closed page-read path')
  assert.equal(unexpectedNetworkCalls, 0, 'global fetch was never called')
} finally {
  globalThis.fetch = originalFetch
}
const redirectCalls: string[] = []
assert.equal(await rg.findReservegoWidget('https://public.example/go', (async (_url:any, init:any) => {
  redirectCalls.push(init.redirect)
  return Response.redirect('http://169.254.169.254/latest/meta-data/', 302)
}) as any), null, 'synthetic redirect is never followed')
assert.deepEqual(redirectCalls, ['manual'], 'even the injected transport receives manual redirect policy')

calls = []
const out = await rg.fetchReservegoSlots(OUTLET, '2026-10-20', fetcher)
assert.deepEqual(out.slots, ['08:30', '12:00', '17:30', '18:00', '18:30', '19:00'], 'full, closed and closed-group times excluded')
assert.deepEqual(out.feeSlots, ['19:00'])
assert.deepEqual(JSON.parse(calls[0].init.body), {outletId: OUTLET, channel: 'Widget', date: '2026-10-20', widgetSlotNames: 1})
assert.equal(calls[0].init.method, 'POST')
await assert.rejects(rg.fetchReservegoSlots(OUTLET, '2026-10-20', (async () => new Response('{}', {status: 200})) as any), /reservego_shape/)
await assert.rejects(rg.fetchReservegoSlots(OUTLET, '2026-10-20', (async () => new Response('x', {status: 503})) as any), /reservego_http_503/)
await assert.rejects(rg.fetchReservegoSlots('nothex', '2026-10-20', fetcher), /reservego_bad_input/)

const src = readFileSync('lib/agent/restaurant-reservation.ts', 'utf8')
const fast = src.indexOf('fetchReservegoSlots(widget.outletId'), browser = src.indexOf('inspected=await runSecureBrowser({')
assert.ok(fast > 0 && fast < browser, 'feed read runs before the browser read')
assert.match(src, /RESERVEGO_FEED_FAILED/, 'feed failure falls back to the browser read')
assert.match(src, /reservego\\\.co\(\?:m\)\?\$/, 'widget.reservego.co counts as first party')
process.stdout.write('ReserveGo feed: outlet discovery, slot parsing (open/full/closed/fee), errors, wired before the browser read.\n')
