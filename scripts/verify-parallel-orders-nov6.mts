// 6 Nov (owner): Parallel is the main web search (Serper/Tavily fall back); orders are tracked from the shops'
// emails in Gmail, with one alert when a shop reports a problem or a promised delivery day passes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const ws = await import('../lib/web-search')

// 1. Search order: Parallel first only when its key is set; the old order stays one env var away.
assert.deepEqual(ws.searchProviderOrder({}), ['serper', 'tavily'])
assert.deepEqual(ws.searchProviderOrder({ PARALLEL_API_KEY: 'k' }), ['parallel', 'serper', 'tavily'])
assert.deepEqual(ws.searchProviderOrder({ PARALLEL_API_KEY: 'k', SEARCH_PROVIDER_ORDER: 'serper,tavily' }), ['serper', 'tavily', 'parallel'])
assert.deepEqual(ws.searchProviderOrder({ SEARCH_PROVIDER_ORDER: 'parallel,serper' }), ['serper', 'tavily'], 'no key, no Parallel')
const body = ws.parallelSearchBody('barber open Sunday Rajajinagar', { includeDomains: ['justdial.com'], startDate: '2026-11-01T00:00:00Z' }) as any
assert.equal(body.mode, 'fast'); assert.deepEqual(body.search_queries, ['barber open Sunday Rajajinagar'])
assert.equal(body.advanced_settings.location, 'in'); assert.equal(body.advanced_settings.max_results, 8)
assert.deepEqual(body.advanced_settings.source_policy, { include_domains: ['justdial.com'], after_date: '2026-11-01' })
const results = ws.parallelResults({ results: [
  { url: 'https://www.justdial.com/x', title: 'Barbers in Rajajinagar', excerpts: ['Open Sunday 9 am', 'Call 080 1234 5678'], publish_date: '2026-11-02' },
  { url: 'https://www.justdial.com/x', title: 'dup', excerpts: [] }, { url: 'javascript:alert(1)', title: 'bad', excerpts: [] },
] })
assert.equal(results.length, 1); assert.equal(results[0].snippet, 'Open Sunday 9 am … Call 080 1234 5678'); assert.equal(results[0].publishedDate, '2026-11-02T00:00:00.000Z')
const src = readFileSync('lib/web-search.ts', 'utf8')
assert.match(src, /fetch\('https:\/\/api\.parallel\.ai\/v1\/search', \{\n    method: 'POST', headers: \{ 'x-api-key': apiKey/)
assert.match(src, /provider === 'parallel' \? process\.env\.PARALLEL_API_KEY/)
console.log('✓ Parallel is the main web search when keyed; results mapped; Serper/Tavily remain the fallback')

// 2. Order emails.
const ot = await import('../lib/agent/order-tracking')
const sent = (d: string) => new Date(`${d}T10:00:00+05:30`).toUTCString()
const mails = [
  { id: '1', from: 'Amazon.in <order-update@amazon.in>', subject: 'Your Amazon.in order of "boAt Airdopes 141" has shipped', snippet: 'Order #403-1234567-1234567 Arriving Friday', date: sent('2026-11-03') },
  { id: '2', from: 'Amazon.in <order-update@amazon.in>', subject: 'Ordered: "boAt Airdopes 141"', snippet: 'Order #403-1234567-1234567', date: sent('2026-11-02') },
  { id: '3', from: 'Flipkart <no-reply@nct.flipkart.com>', subject: 'Delivery attempt failed for your order', snippet: 'Order ID OD123456789012345 We could not deliver your Philips trimmer', date: sent('2026-11-05') },
  { id: '4', from: 'Myntra <updates@myntra.com>', subject: 'Delivered: "Roadster Shirt"', snippet: 'Your order has been delivered', date: sent('2026-11-05') },
  { id: '5', from: 'Amazon.in <store-news@amazon.in>', subject: 'Great Indian sale: 70% off', snippet: 'order now', date: sent('2026-11-05') },
  { id: '6', from: 'Swiggy <noreply@swiggy.in>', subject: 'Your order has been delivered', snippet: 'Delivered in 25 mins', date: sent('2026-11-05') },
  { id: '7', from: 'Nykaa <orders@nykaa.com>', subject: 'Your order is out for delivery', snippet: 'Order no. NYK9876543 arriving today', date: sent('2026-11-06') },
]
assert.equal(ot.orderStatus('Great Indian sale: 70% off'), null, 'offers are not orders')
assert.equal(ot.shopOf('Swiggy <noreply@swiggy.in>'), null, 'food delivery is not tracked')
assert.equal(ot.expectedDay('Arriving Friday', sent('2026-11-03')), '2026-11-06')
assert.equal(ot.expectedDay('Expected delivery by Sat, 8 Nov', sent('2026-11-03')), '2026-11-08')
assert.equal(ot.expectedDay('Arriving tomorrow', sent('2026-11-03')), '2026-11-04')
assert.equal(ot.expectedDay('Order placed', sent('2026-11-03')), null)
const orders = ot.trackOrders(mails)
assert.equal(orders.length, 4, 'one row per order; offers and food dropped')
const airdopes = orders.find(o => o.shop === 'Amazon')!
assert.equal(airdopes.label, 'boAt Airdopes 141'); assert.equal(airdopes.status, 'shipped'); assert.equal(airdopes.expected, '2026-11-06'); assert.equal(airdopes.orderId, '403-1234567-1234567')
const trimmer = orders.find(o => o.shop === 'Flipkart')!
assert.equal(trimmer.status, 'attempt_failed'); assert.equal(trimmer.problem, true); assert.equal(trimmer.orderId, 'OD123456789012345')
console.log('✓ shop emails become one order each: latest status, promised day, order id; offers and food skipped')

// 3. Missed and problem alerts, once each.
const fri = Date.parse('2026-11-06T20:00:00+05:30'), sat11 = Date.parse('2026-11-07T11:00:00+05:30')
assert.equal(ot.isMissed(airdopes, fri), false, 'not missed on the promised day')
assert.equal(ot.isMissed(airdopes, sat11), true, 'missed from 10 am the next day')
const first = ot.orderAlerts(orders, [], sat11)
assert.equal(first.length, 3, 'Airdopes and Nykaa (both due Fri) missed; Flipkart attempt failed')
assert.match(first.map(a => a.line).join('\n'), /Your \*Nykaa order\* was due Fri, 6 Nov/)
assert.match(first.map(a => a.line).join('\n'), /\*boAt Airdopes 141\* \(Amazon\) was due Fri, 6 Nov, and I haven't seen a delivery email\. Last update: Shipped\./)
assert.match(first.map(a => a.line).join('\n'), /Your \*Flipkart order\*: Delivery attempt failed\./)
assert.equal(ot.orderAlerts(orders, first.map(a => a.id), sat11).length, 0, 'never the same alert twice')
const delivered = ot.trackOrders([...mails, { id: '8', from: 'Amazon.in <shipment-tracking@amazon.in>', subject: 'Delivered: "boAt Airdopes 141"', snippet: 'Order #403-1234567-1234567', date: sent('2026-11-07') }])
assert.equal(ot.orderAlerts(delivered, [], sat11).filter(a => a.id.startsWith('Amazon')).length, 0, 'a delivery email clears it')
console.log('✓ alerts: a missed promised day (from 10 am next day) and shop-reported problems, each once')

// 4. The list answer and the wiring.
const list = ot.formatOrders(orders, sat11)
assert.match(list, /^📦 \*On the way \(3\)\*/)
assert.match(list, /• \*boAt Airdopes 141\* · Amazon\n  ⚠️ Was due Fri, 6 Nov, no delivery email yet/)
assert.match(list, /• \*Flipkart order …012345\* · Flipkart\n  Delivery attempt failed/)
assert.match(list, /✅ \*Delivered recently\*\n• Roadster Shirt · Myntra/)
for (const t of ['track my orders', 'where are my orders?', 'any deliveries today', 'my parcels', 'what is arriving today']) assert.ok(ot.ORDER_LIST_RE.test(t), t)
for (const t of ['where is my Amazon order', 'order a pizza', 'cancel my order']) assert.equal(ot.ORDER_LIST_RE.test(t), false, t)
const w = readFileSync('lib/agent/watchers.ts', 'utf8')
assert.match(w, /const alerts=ot\.orderAlerts\(orders,sentIds,now\.getTime\(\)\)/)
assert.match(w, /topic:'watches'\}\)/)
for (const p of ['app/api/dashboard/chat/route.ts', 'lib/agent/whatsapp-bridge.ts']) assert.match(readFileSync(p, 'utf8'), /order-tracking'\)\.then\(m=>m\.tryOrderList\(actor,/, p)
assert.match(readFileSync('lib/agent/same-brain.ts', 'utf8'), /📦 \*Orders on the way\*/, 'important-mail digest includes orders')
console.log('✓ "track my orders" on both surfaces; the inbox watch sends order alerts; the mail digest lists orders')

// 5. Any shop (Dots screenshot, 6 Nov): a small brand shipped by Shiprocket, and "out for delivery today".
assert.equal(ot.shopOf('Shiprocket <noreply@shiprocket.in>', "Your order from Drip N' Dip is out for delivery"), "Drip N' Dip")
assert.equal(ot.shopOf('"The Souled Store" <orders@thesouledstore.com>', 'Your order has shipped'), 'The Souled Store')
assert.equal(ot.shopOf('Delhivery <noreply@delhivery.com>', 'Shipment out for delivery'), 'Delhivery')
assert.equal(ot.shopOf('Zepto <noreply@zeptonow.com>', 'Your order is delivered'), null, '10-minute delivery skipped')
assert.equal(ot.orderEvent({ from: 'IndiGo <reservations@goindigo.in>', subject: 'Your flight has been cancelled', date: sent('2026-11-05') }), null, 'a cancelled flight is not an order')
assert.equal(ot.orderEvent({ from: 'HDFC Bank <alerts@hdfcbank.net>', subject: 'Your statement has been delivered', date: sent('2026-11-05') }), null, 'a statement is not an order')
const drip = ot.trackOrders([
  { id: 'd1', from: 'Shiprocket <noreply@shiprocket.in>', subject: "Your order from Drip N' Dip has been shipped", snippet: 'Estimated delivery by 7 Nov', date: sent('2026-11-05') },
  { id: 'd2', from: 'Shiprocket <noreply@shiprocket.in>', subject: "Your order from Drip N' Dip is out for delivery", snippet: 'Order ID DND10234 expected before 7 pm', date: new Date('2026-11-06T09:30:00+05:30').toUTCString() },
])
assert.equal(drip.length, 1, 'shipped + out for delivery are one order (same brand thread)')
assert.equal(drip[0].shop, "Drip N' Dip"); assert.equal(drip[0].status, 'out_for_delivery'); assert.equal(drip[0].expected, '2026-11-07')
const today = ot.orderAlerts(drip, [], Date.parse('2026-11-06T10:00:00+05:30'))
assert.deepEqual(today.map(a => a.line), ["Your *Drip N' Dip order* is out for delivery today, earlier than the Sat, 7 Nov it promised."])
assert.equal(ot.orderAlerts(drip, today.map(a => a.id), Date.parse('2026-11-06T15:00:00+05:30')).length, 0, 'once')
assert.equal(ot.orderAlerts(drip, [], Date.parse('2026-11-07T10:00:00+05:30')).length, 0, 'not repeated as "today" on a later day')
console.log('✓ any shop or courier (Shiprocket brands too); food/quick commerce, flights and statements skipped; "out for delivery today" once')
console.log('Parallel search + order tracking (6 Nov) checks passed')
