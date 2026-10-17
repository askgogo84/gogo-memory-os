import assert from 'node:assert/strict'
// Rows are the real Google Flights labels read from Chrome on 17 Oct 2026 (BLR to SIN, 28 Oct, back 2 Nov, 1 adult).
process.env.ANTHROPIC_API_KEY ||= 'test'
const t = await import('../lib/agent/travel-browser-task.ts')
const context: any = {origin: {code: 'BLR', label: 'Bengaluru'}, destination: {code: 'SIN', label: 'Singapore'}, startDate: '2026-10-28', returnDate: '2026-11-02',
  roundTrip: true, routeLabel: 'BLR to SIN', whenLabel: '28 Oct to 2 Nov', cabin: 'economy', adults: 1}
const rows = [
  'From 28443 Indian rupees round trip total. 1 stop flight with Air India. Leaves Kempegowda International Airport Bengaluru at 7:00 PM on Wednesday, October 28 and arrives at Singapore Changi Airport at 8:40 AM on Thursday, October 29. Total duration 11 hr 10 min. Layover (1 of 1) is a 3 hr 15 min layover at Chhatrapati Shivaji Maharaj International Airport in Mumbai. Select flight',
  'From 39203 Indian rupees round trip total. Nonstop flight with IndiGo. Leaves Kempegowda International Airport Bengaluru at 10:20 AM on Wednesday, October 28 and arrives at Singapore Changi Airport at 5:40 PM on Wednesday, October 28. Total duration 4 hr 50 min. Select flight',
  'From 28443 Indian rupees. Nonstop flight with IndiGo. Leaves Kempegowda International Airport Bengaluru at 10:20 AM on Wednesday, October 28 and arrives at Singapore Changi Airport at 5:40 PM on Wednesday, October 28. Total duration 4 hr 50 min.',
  'From 31000 Indian rupees round trip total. Nonstop flight with IndiGo. Leaves Kempegowda International Airport Bengaluru at 10:20 AM on Thursday, October 29 and arrives at Singapore Changi Airport at 5:40 PM on Thursday, October 29. Total duration 4 hr 50 min. Select flight',
]
const controls = ['Where from? Bengaluru BLR', 'Where to? Singapore SIN', 'Change ticket type. Round trip', '1 passenger, change number of passengers.',
  'Track prices from Bengaluru to Singapore departing 2026-10-28 and returning 2026-11-02']
const result: any = {url: 'https://www.google.com/travel/flights?hl=en&curr=INR&q=x', pageText: 'Prices include required taxes + fees for 1 adult. Optional charges and bag fees may apply.',
  flightEvidence: {searchControls: controls, resultLabels: rows}}
const options = t.googleRoundTripOptionsFromEvidence(result, context)
assert.equal(options.length, 2, 'a one-way label and a row for another day are refused')
assert.deepEqual(options.map((o: any) => [o.fareInr, o.stops, o.airline, o.roundTrip]), [[28443, 1, 'Air India', true], [39203, 0, 'IndiGo', true]])
assert.match(options[0].layover, /3 hr 15 min in Mumbai/)
assert.equal(options[0].fareBasis, 'party_total')
// The dates must be the ones Google shows, the trip type must be round trip, the page must be Google Flights.
assert.equal(t.googleRoundTripOptionsFromEvidence({...result, flightEvidence: {...result.flightEvidence, searchControls: controls.map(c => c.replace('2026-11-02', '2026-11-03'))}}, context).length, 0, 'return date not confirmed')
assert.equal(t.googleRoundTripOptionsFromEvidence({...result, flightEvidence: {...result.flightEvidence, searchControls: controls.map(c => c.replace('Round trip', 'One way'))}}, context).length, 0, 'not a round-trip search')
assert.equal(t.googleRoundTripOptionsFromEvidence({...result, url: 'https://www.google.com.evil.example/travel/flights'}, context).length, 0)
assert.equal(t.googleRoundTripOptionsFromEvidence(result, {...context, roundTrip: false}).length, 0)
assert.equal(t.googleRoundTripOptionsFromEvidence(result, {...context, nonStop: true}).length, 1, 'non-stop only keeps the non-stop row')
// 2-adult party total needs Google's explicit statement.
assert.equal(t.googleRoundTripOptionsFromEvidence({...result, pageText: 'Prices include required taxes + fees for 2 adults.'}, context)[0].fareBasis, 'unverified')
const text = t.formatRoundTripResult(context, options, result.url)
assert.match(text, /Cheapest round trip: ₹28,443 on Air India, 1 stop/)
assert.match(text, /Cheapest non-stop: ₹39,203 on IndiGo/)
assert.match(text, /28 Oct → back 2 Nov/)
assert.match(text, /fares move/)
assert.ok(text.indexOf('₹28,443') < text.indexOf('₹39,203'), 'cheapest first')
assert.doesNotMatch(text, /CreditIQ|reward|points/i)
assert.throws(() => t.formatRoundTripResult(context, options, 'https://www.google.com.evil.example/travel/flights'))
console.log('verify-flight-round-trip: ok')
// 17 Oct: the cloud browser runs outside India and Google priced the search for the US (the cheaper Air India
// fares were missing). The search link must set India as the country, with INR.
import { readFileSync } from 'node:fs'
assert.match(readFileSync('lib/agent/travel-browser-task.ts', 'utf8'), /travel\/flights\?hl=en&gl=in&curr=INR/)
assert.match(readFileSync('lib/agent/travel-research.ts', 'utf8'), /travel\/flights\?hl=en&gl=in&curr=INR/)
// The reply links to the exact search (both dates, India pricing), not the bare Google Flights home.
assert.match(text, /https:\/\/www\.google\.com\/travel\/flights\?hl=en&gl=in&curr=INR&q=Round%20trip%20flights%20from%20BLR%20to%20SIN%20departing%202026-10-28%20returning%202026-11-02/)
