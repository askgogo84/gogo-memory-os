// 11 Nov 2026: one pick by a fixed rule, named by its number in the list the person sees, and "book N" books it.
import assert from 'node:assert/strict'
const { chooseFlightPick, nonstopPremiumLimit } = await import('../lib/agent/flight-pick.ts')
const t = await import('../lib/agent/travel-browser-task.ts')
const { flightBookingRequest, pickFlight } = await import('../lib/agent/flight-booking.ts')
const { flightCardModel, flightCardCaption } = await import('../lib/agent/flight-card.ts')

assert.equal(nonstopPremiumLimit(5000), 1000); assert.equal(nonstopPremiumLimit(20000), 2000)
assert.equal(chooseFlightPick([]), null)
assert.equal(chooseFlightPick([{ fareInr: null, stops: 0 }]), null)
assert.deepEqual(chooseFlightPick([{ fareInr: 5000, stops: 0 }, { fareInr: 6000, stops: 1 }]), { n: 1, reason: 'Cheapest, and non-stop.', nonstopN: null })
// A non-stop within ₹1,000 (or 10%) of the cheapest wins.
assert.deepEqual(chooseFlightPick([{ fareInr: 7552, stops: 1 }, { fareInr: 7800, stops: 1 }, { fareInr: 7962, stops: 0 }]), { n: 3, reason: 'Non-stop for ₹410 more than the cheapest (#1).', nonstopN: null })
assert.deepEqual(chooseFlightPick([{ fareInr: 7000, stops: 1 }, { fareInr: 7000, stops: 0 }]), { n: 2, reason: 'Non-stop, at the cheapest fare.', nonstopN: null })
// Beyond the limit, the cheapest wins and the non-stop is mentioned.
assert.deepEqual(chooseFlightPick([{ fareInr: 28443, stops: 1 }, { fareInr: 39203, stops: 0 }]), { n: 1, reason: 'Cheapest.', nonstopN: 2 })
assert.deepEqual(chooseFlightPick([{ fareInr: 5000, stops: 1 }, { fareInr: 6001, stops: 0 }]).n, 1)
assert.deepEqual(chooseFlightPick([{ fareInr: 5000, stops: 1 }, { fareInr: 6000, stops: 0 }]).n, 2)
// Unpriced rows never become the pick.
assert.equal(chooseFlightPick([{ fareInr: null, stops: 0 }, { fareInr: 9000, stops: 1 }]).n, 2)

// The text names the same number that booking resolves (display order is unchanged).
const context = { origin: { code: 'BLR', label: 'Bengaluru' }, destination: { code: 'GOI', label: 'Goa' }, startDate: '2026-12-20', routeLabel: 'BLR → GOI', whenLabel: '20 Dec 2026', adults: 1, cabin: 'economy' }
const opts = [
  { airline: 'IndiGo', departure: '6:00 AM', arrival: '9:30 AM', stops: 1, fareInr: 7552, route: 'BLR → GOI', evidence: 'a' },
  { airline: 'Akasa Air', departure: '8:00 AM', arrival: '11:40 AM', stops: 1, fareInr: 7800, route: 'BLR → GOI', evidence: 'b' },
  { airline: 'Air India Express', departure: '5:45 PM', arrival: '7:10 PM', stops: 0, fareInr: 7962, route: 'BLR → GOI', evidence: 'c' },
  { airline: 'SpiceJet', departure: '9:00 PM', arrival: '11:50 PM', stops: 1, fareInr: 8100, route: 'BLR → GOI', evidence: 'd' },
]
const text = t.formatBrowserFlightResult(context, opts, 'https://www.google.com/travel/flights?q=x')
assert.match(text, /^My pick: #3, ₹7,962 on Air India Express, 5:45 PM → 7:10 PM, non-stop\. Non-stop for ₹410 more than the cheapest \(#1\)\.$/m)
assert.match(text, /Reply \*book 3\* to book it/)
assert.match(text, /^4\. ₹8,100 · SpiceJet · 9:00 PM → 11:50 PM · 1 stop$/m, 'every bookable row is shown, one line each')
assert.equal(t.oneWayDisplayOrder(opts)[2].airline, 'Air India Express', '"book 3" resolves to the pick')
assert.deepEqual(flightBookingRequest('book 3'), { kind: 'number', n: 3 })
assert.ok(text.length < 700, `short: ${text.length}`)
// Natural replies book the recommended flight; "cheapest" still means the cheapest.
const order = t.oneWayDisplayOrder(opts)
for (const say of ['book it', 'yes book it', 'book that', 'Book', 'book the best one', 'book my pick', 'book your pick', 'book the recommended one', 'book the one you picked']) {
  const req = flightBookingRequest(say); assert.deepEqual(req, { kind: 'pick' }, say)
  assert.equal(pickFlight(order, req!)?.airline, 'Air India Express', say)
}
assert.equal(pickFlight(order, flightBookingRequest('book the cheapest')!)?.airline, 'IndiGo')
assert.equal(flightBookingRequest('book my dentist'), null)
// The card highlights the text's pick, or nothing; never a different flight.
const cardOut = (flights: any[]) => flightCardModel({ inventoryType: 'browser-verified', context: { origin: { code: 'BLR' }, destination: { code: 'GOI' }, startDate: '2026-12-20', adults: 1 }, flights })
const m1 = cardOut(opts)!
assert.deepEqual(m1.rows.filter(r => r.pick).map(r => r.airline), ['Air India Express'])
assert.equal(flightCardCaption(m1), "BLR → GOI · Sun 20 Dec: I'd pick Air India Express at 5:45 PM, non-stop for a little more. Details below.")
// Reviewer case: the cheapest row has unverified stops, so the card drops it; the text picks it (#1, cheapest).
const tricky = [{ airline: 'IndiGo', departure: '6:00 AM', arrival: '9:00 AM', stops: null, fareInr: 5000 }, { airline: 'Akasa Air', departure: '7:00 AM', arrival: '10:00 AM', stops: 1, fareInr: 5500 }, { airline: 'Air India', departure: '8:00 AM', arrival: '9:20 AM', stops: 0, fareInr: 6200 }]
const tt = t.formatBrowserFlightResult(context, tricky.map(f => ({ ...f, route: 'x', evidence: 'x' })) as any, 'https://www.google.com/travel/flights?q=x')
assert.match(tt, /My pick: #1, ₹5,000 on IndiGo/)
const m2 = cardOut(tricky)!
assert.equal(m2.rows.some(r => r.pick), false, 'the card does not recommend a different flight')
assert.match(flightCardCaption(m2), /My pick is in the message below\./)
console.log('PASS flight pick rule, numbering and booking binding')
