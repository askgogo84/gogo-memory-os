import assert from 'node:assert/strict'
import { managedAllowedDomains, managedSessionConfig } from '../lib/agent/managed-browser'
import { FLIGHT_BOOKING_HANDOFF_SITES } from '../lib/agent/browser-page-network'
import { flightBookingObjective } from '../lib/agent/flight-booking'

// 26 Oct live run 412f5a03: Browserbase blocked Google Flights' hand-off to Air India (session allowed only google.com).
const flights = managedAllowedDomains('https://www.google.com/travel/flights/search?tfs=abc')
assert.equal(flights[0], 'google.com')
for (const site of ['airindia.com', 'goindigo.in', 'makemytrip.com', 'cleartrip.com']) assert.ok(flights.includes(site), site)
// Unknown agencies never receive traveller details.
for (const site of ['ly.com', 'mytrip.com', 'gotogate.com', 'kiwi.com']) {
  assert.ok(!flights.includes(site), site)
  assert.ok(!FLIGHT_BOOKING_HANDOFF_SITES.includes(site), site)
}
// Every other page keeps its single-site scope, including other Google pages.
assert.deepEqual(managedAllowedDomains('https://www.google.com/search?q=x'), ['google.com'])
assert.deepEqual(managedAllowedDomains('https://www.croma.com/p/1'), ['croma.com'])
assert.deepEqual(managedSessionConfig('p', 'c', 'o', 'croma.com', 300, true, 'production', false).browserSettings.allowedDomains, ['croma.com'])
assert.deepEqual(managedSessionConfig('p', 'c', 'o', 'google.com', 300, true, 'production', false, false, flights).browserSettings.allowedDomains, flights)

// The booking objective names the airline first and keeps the payment stop even with four long names.
const travellers = Array.from({ length: 4 }, (_, i) => ({ name: `Goverdhan Mandyam Dommane Traveller${i}` }))
const objective = flightBookingObjective({ context: { origin: { code: 'BLR' }, destination: { code: 'DEL' }, startDate: '2026-11-20', adults: 4 }, option: { airline: 'Air India', departure: '12:15 AM', fareInr: 10327 } as any, travellers })
assert.match(objective, /Continue to book with Air India/)
assert.match(objective, /Never pick any other agency/)
assert.match(objective, /never press Pay\.$/)
console.log('Flight hand-off domains passed')
