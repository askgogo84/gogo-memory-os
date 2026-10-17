import assert from 'node:assert/strict'
// Real Google Flights labels read in Chrome on 17 Oct 2026 (BLR → DEL, 6 Nov, one way, 1 adult).
process.env.ANTHROPIC_API_KEY ||= 'test'
const t = await import('../lib/agent/travel-browser-task.ts')
const context: any = {origin: {code: 'BLR', label: 'Bengaluru'}, destination: {code: 'DEL', label: 'Delhi'}, startDate: '2026-11-06', routeLabel: 'BLR → DEL', whenLabel: '6 Nov 2026', adults: 1, cabin: 'economy'}
assert.equal(t.oneWayQuery(context), 'Flights from BLR to DEL on 2026-11-06 one way for 1 adult in economy', 'Google ignores a query that starts with "One-way"')
const rows = [
  'From 16246 Indian rupees. 1 stop flight with Air India. Leaves Kempegowda International Airport Bengaluru at 9:00 AM on Friday, November 6 and arrives at Indira Gandhi International Airport at 2:35 PM on Friday, November 6. Total duration 5 hr 35 min.  Layover (1 of 1) is a 1 hr 15 min layover at Chhatrapati Shivaji Maharaj International Airport in Mumbai.',
  'From 7215 Indian rupees. Nonstop flight with IndiGo. Leaves Kempegowda International Airport Bengaluru at 6:10 AM on Friday, November 6 and arrives at Indira Gandhi International Airport at 9:00 AM on Friday, November 6. Total duration 2 hr 50 min. Select flight',
  'From 6900 Indian rupees. Nonstop flight with IndiGo. Leaves Kempegowda International Airport Bengaluru at 6:10 AM on Saturday, November 7 and arrives at Indira Gandhi International Airport at 9:00 AM on Saturday, November 7. Total duration 2 hr 50 min.',
]
const controls = ['Where from? Bengaluru BLR', 'Where to? New Delhi DEL', 'Change ticket type. One way', 'Change seating class. Economy', '1 passenger, change number of passengers.']
const result: any = {url: 'https://www.google.com/travel/flights?hl=en&gl=in', pageText: 'Prices include required taxes + fees for 1 adult.', flightEvidence: {searchControls: controls, resultLabels: rows}}
const options = t.googleFlightOptionsFromEvidence(result, context)
assert.deepEqual(options.map((o: any) => [o.fareInr, o.stops, o.airline]), [[16246, 1, 'Air India'], [7215, 0, 'IndiGo']], 'one-stop rows count; another day is refused')
assert.match(options[0].layover, /1 hr 15 min in Mumbai/)
assert.equal(t.airportMatches('Indira Gandhi International Airport', context.destination), true, 'Delhi airport is named, not the city')
assert.equal(t.googleFlightOptionsFromEvidence({...result, flightEvidence: {...result.flightEvidence, searchControls: controls.map(c => c.replace('One way', 'Round trip'))}}, context).length, 0)
const text = t.formatBrowserFlightResult(context, options, result.url)
assert.match(text, /Cheapest: ₹7,215 on IndiGo, non-stop\./)
assert.match(text, /1\. ₹7,215 · IndiGo/)
assert.match(text, /q=Flights%20from%20BLR%20to%20DEL/)
console.log('verify-flight-one-way: ok')
