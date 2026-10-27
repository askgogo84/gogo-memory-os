// Result cards Phase 1 (docs/result-cards): WhatsApp flight card model, caption, signed link and send order.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const { flightCardModel, flightCardCaption, formatInr } = await import('../lib/agent/flight-card.ts')
const ctx = { kind: 'flight', origin: { code: 'BLR' }, destination: { code: 'DEL' }, startDate: '2026-11-12', adults: 1, cabin: 'economy' }
const f = (airline: string, departure: string, arrival: string, fareInr: number, stops = 0) => ({ airline, departure, arrival, fareInr, stops, route: 'BLR → DEL' })
const output = { inventoryType: 'browser-verified', context: ctx, observedAt: '2026-10-27T02:20:00Z',
  flights: [f('IndiGo', '6:45 AM', '9:35 AM', 9759), f('Akasa Air', '5:00 AM', '7:55 AM', 9744), f('IndiGo', '5:05 PM', '7:50 PM', 9759), f('Air India', '8:00 PM', '11:30 PM', 12500, 1), f('IndiGo', '8:45 PM', '11:35 PM', 9759), f('IndiGo', '10:25 PM', '1:20 AM Nov 13', 9759)] }
const m = flightCardModel(output)!
assert.equal(m.route, 'BLR → DEL'); assert.equal(m.when, 'Thu 12 Nov'); assert.equal(m.party, '1 adult · economy')
assert.deepEqual(m.rows.map(r => [r.n, r.airline, r.departure, r.fareInr, r.pick]).slice(0, 2), [[1, 'Akasa Air', '5:00 AM', 9744, true], [2, 'IndiGo', '6:45 AM', 9759, false]])
assert.equal(m.rows.length, 5, 'top five like the text list'); assert.equal(m.rows[0].code, 'QP'); assert.equal(m.rows[1].code, '6E')
assert.equal(flightCardCaption(m), 'BLR → DEL · Thu 12 Nov: I\'d pick #1, Akasa Air at 5:00 AM, cheapest and nonstop. #2 is ₹15 more at 6:45 AM. Say "book 1" to book.')
assert.equal(formatInr(9744, false), 'Rs 9,744')
// Refusals: round trips, unverified party totals, model-shaped junk.
assert.equal(flightCardModel({ ...output, context: { ...ctx, roundTrip: true, returnDate: '2026-11-15' } }), null)
assert.equal(flightCardModel({ ...output, inventoryType: 'fallback' }), null)
assert.equal(flightCardModel({ ...output, context: { ...ctx, adults: 2 } }), null, 'per-person fares are not shown as a party price')
assert.equal(flightCardModel({ ...output, flights: [{ airline: 'IndiGo<script>', departure: '6 AM', arrival: 'x', fareInr: 1, stops: 0 }] }), null)

// Signed link: bound to this run and owner.
process.env.CARD_LINK_SECRET = 'test-secret-for-cards-0123456789'
const { signCardToken, verifyCardToken } = await import('../lib/security/card-link.ts')
const { flightResultCard } = await import('../lib/agent/travel-research-worker.ts')
const runId = '27507272-2320-48c8-a7ea-c8eb52000a88'
const card = await flightResultCard({ id: runId, telegram_id: '918310441698', status: 'completed' }, { steps: [{ output_json: output, completed_at: '2026-10-27T02:20:00Z' }], appUrl: 'https://app.askgogo.in/' })
assert.ok(card && card.url.startsWith(`https://app.askgogo.in/api/cards/flights/${runId}?o=918310441698&t=`), card?.url)
const t = new URL(card!.url).searchParams.get('t')
assert.equal(await verifyCardToken(`flights.${runId}`, '918310441698', t), true)
assert.equal(await verifyCardToken(`flights.${runId}`, '919999999999', t), false, 'another owner cannot open it')
assert.equal(await verifyCardToken('flights.00000000-0000-0000-0000-000000000000', '918310441698', t), false, 'another run cannot use it')
assert.equal(await flightResultCard({ id: runId, telegram_id: '918310441698', status: 'failed' }, { steps: [] }), null)
assert.ok(signCardToken)

// Worker: card first, once, best effort; text always sent.
const worker = readFileSync('lib/agent/travel-research-worker.ts', 'utf8')
const iCard = worker.indexOf('sendWhatsApp(actor.whatsappId,card.caption,card.url)'), iText = worker.indexOf('sendWhatsApp(actor.whatsappId,text,undefined')
assert.ok(iCard > 0 && iText > iCard, 'card is sent before the text')
assert.ok(worker.includes("if(!run.metadata_json?.result_card_sent)"), 'card sent at most once')
assert.match(worker.slice(iCard - 400, iText), /catch\(error\)\{console\.warn\('TRAVEL_RESULT_CARD_FAILED:'/, 'card failure is caught before the text send')
const route = readFileSync('app/api/cards/flights/[runId]/route.ts', 'utf8')
assert.ok(route.includes("verifyCardToken(`flights.${runId}`, owner"), 'route checks the signed link')
assert.ok(route.includes(".eq('telegram_id', owner)"), 'route reads only the owner\'s run')
console.log('FLIGHT_RESULT_CARD_OK')
