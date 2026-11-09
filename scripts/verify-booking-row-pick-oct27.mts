// 27 Oct live booking b1ba0f1e: the planner clicked a list container six times; the approved row is clicked directly.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const { googleFlightRowControl } = await import('../lib/agent/secure-computer.ts')
const { flightBookingObjective } = await import('../lib/agent/flight-booking.ts')
const objective = flightBookingObjective({ context: { origin: { code: 'BLR' }, destination: { code: 'DEL' }, startDate: '2026-11-09' }, option: { airline: 'SpiceJet', departure: '6:10 AM', fareInr: 9436 } as any, travellers: [{ name: 'Divya Rao' }] })
const row = (fare: number, airline: string, t: string, day = 'Monday, November 9') => `From ${fare} Indian rupees. Nonstop flight with ${airline}. Leaves Kempegowda International Airport Bengaluru at ${t} on ${day} and arrives at Indira Gandhi International Airport at 9:00 AM on ${day}. Total duration 2 hr 50 min. Select flight`.slice(0, 180)
const controls = [{ selector: '#list', label: 'Top flights' }, { selector: '#r1', label: row(9800, 'IndiGo', '6:10 AM') }, { selector: '#r2', label: row(9436, 'SpiceJet', '6:10 AM', 'Tuesday, November 10') },
  { selector: '#r3', label: row(9436, 'SpiceJet', '6:10 AM') }, { selector: '#d3', label: 'Flight details. Leaves Kempegowda International Airport' }]
assert.equal(googleFlightRowControl(controls, objective), '#r3', 'airline, time and day must all match')
assert.equal(googleFlightRowControl(controls.filter(c => c.selector !== '#r3'), objective), null)
assert.equal(googleFlightRowControl(controls, 'Provider booking up to payment for tennis:'), null)
const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
assert.ok(src.includes('flightRowPicks<3'), 'bounded to three tries')
console.log('BOOKING_ROW_PICK_OK')
{
  const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('!onGoogle&&!flightHandoff&&loggedOutCue(page)'), 'a flight hand-off never presses Login on the airline site')
  console.log('FLIGHT_GUEST_OK')
}
{
  // 27 Oct 10:08: IndiGo's redirect page said "Loading..." and the run gave up; it now waits a few times.
  const { pageStillLoading } = await import('../lib/agent/secure-computer.ts')
  assert.equal(pageStillLoading({ url: 'https://www.goindigo.in/flight-select-redirection.html', text: 'Book Trips Login Loading... COMPANY About us', controls: [] }), true)
  assert.equal(pageStillLoading({ url: 'https://www.goindigo.in/book/passenger-edit.html', text: 'Passenger details', controls: [{ tag: 'input' }] }), false)
  const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('handoffLoadingWaits<4&&pageStillLoading(page)'), 'bounded to four waits')
  const { browserPageAllowlist } = await import('../lib/agent/browser-page-network.ts')
  const flights = browserPageAllowlist('https://www.google.com/travel/flights?q=x')
  assert.ok('cdn-app6.securiti.ai' in flights && 'app.securiti.ai' in flights && !('*.securiti.ai' in flights))
  assert.ok(!('cdn-app6.securiti.ai' in browserPageAllowlist('https://www.croma.com/p/1')), 'other sites unchanged')
  console.log('HANDOFF_LOADING_OK')
}
{
  // 27 Oct 10:52: fewer wasted waves (direct airline Continue, cookie banner declined) and a 9-minute booking budget.
  const { googleAirlineContinueControl, cookieDeclineControl } = await import('../lib/agent/secure-computer.ts')
  const obj = 'Flight booking up to payment on Google Flights: one-way BLR to MAA, depart 2026-11-15, 1 adult, economy. Choose the IndiGo result that leaves 7:10 AM on 2026-11-15 (about ₹3,892 one-way)'
  const google = [{ selector: '#ly', label: 'Continue to book with ly.com for 3880 Indian rupees' }, { selector: '#6e', label: 'Continue to book with IndiGo airline for 3892 Indian rupees. Includes 49 Indian rupees convenience fee' }, { selector: '#ct', label: 'Continue to book with Cleartrip for 3900 Indian rupees' }]
  assert.equal(googleAirlineContinueControl(google, obj), '#6e')
  assert.equal(googleAirlineContinueControl(google.filter(c => c.selector !== '#6e'), obj), null, 'never an agency in place of the airline')
  assert.equal(cookieDeclineControl([{ selector: '#all', label: 'Accept All' }, { selector: '#ess', label: 'Accept Essential Only' }]), '#ess')
  assert.equal(cookieDeclineControl([{ selector: '#r', label: 'Reject All' }]), '#r')
  assert.equal(cookieDeclineControl([{ selector: '#all', label: 'Accept All' }, { selector: '#c', label: 'Customize Preferences' }]), null, 'never accepts all')
  const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('const BOOKING_BUDGET_MS=540_000'))
  const route = (await import('node:fs')).readFileSync(new URL('../app/api/agent/approved-browser/route.ts', import.meta.url), 'utf8')
  assert.ok(/export const maxDuration = 800/.test(route), 'route budget covers the booking budget plus start-up')
  console.log('BOOKING_FEWER_WAVES_OK')
}
{
  // 27 Oct 12:09: goindigo.in showed "No flights found" (its flight API failed in the cloud browser); go back to Google.
  const { airlineShowsNoFlights } = await import('../lib/agent/secure-computer.ts')
  assert.equal(airlineShowsNoFlights({ url: 'https://www.goindigo.in/book/flight-select.html/', text: 'Select Flight From Bengaluru to Chennai ... No flights found for the selected date' }), true)
  assert.equal(airlineShowsNoFlights({ url: 'https://www.goindigo.in/book/flight-select.html/', text: '6E 6031 7:10 AM 8:15 AM ₹3,843 Select' }), false)
  assert.equal(airlineShowsNoFlights({ url: 'https://www.goindigo.in/about-us.html', text: 'no flights found' }), false, 'only on a flight-select page')
  const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('(edgeBlockedPage(page)||airlineShowsNoFlights(page))&&edgeBlockedHosts.length<2'), 'same bounded fallback as an edge block')
  assert.ok(src.includes("console.warn('BROWSER_FAILED_WHY:'"), 'failure reasons are logged (hostnames + error codes)')
  console.log('AIRLINE_NO_FLIGHTS_OK')
}
{
  // 27 Oct 13:13: after the airline fallback, Gogo presses the next Indian agency itself (planner re-picked IndiGo).
  const { googleAgencyContinueControl } = await import('../lib/agent/secure-computer.ts')
  const opts = [{ selector: '#6e', label: 'Continue to book with IndiGo airline for 3892 Indian rupees' }, { selector: '#gi', label: 'Continue to book with Goibibo for 3900 Indian rupees' }, { selector: '#ct', label: 'Continue to book with Cleartrip for 3910 Indian rupees' }, { selector: '#bk', label: 'Continue to book with Booking.com for 4600 Indian rupees' }]
  assert.deepEqual(googleAgencyContinueControl(opts), { selector: '#ct', name: 'cleartrip' }, 'preference order: MakeMyTrip, Cleartrip, Goibibo…')
  assert.deepEqual(googleAgencyContinueControl(opts, ['cleartrip']), { selector: '#gi', name: 'goibibo' })
  assert.equal(googleAgencyContinueControl(opts, ['cleartrip', 'goibibo']), null, 'never the airline again or an unlisted agency')
  console.log('AGENCY_FALLBACK_OK')
}
{
  const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
  assert.ok(src.includes("(providerBooking||(params.mode==='read'&&params.recoverFlightSearch===true))&&onGoogle&&!bookingStartReloaded"), '27 Oct 15:50: a fare read reloads a blank Google form once')
  console.log('READ_BLANK_RELOAD_OK')
}
{
  // 27 Oct 17:15: back on Google after the fallback, "Getting prices" — wait, then reload the booking page once.
  const { googleBookingStillPricing } = await import('../lib/agent/secure-computer.ts')
  assert.equal(googleBookingStillPricing({ text: 'Itinerary summary Bengaluru Chennai One way Getting prices Language', controls: [{ label: 'Sign in' }] }), true)
  assert.equal(googleBookingStillPricing({ text: 'Getting prices', controls: [{ label: 'Continue to book with Cleartrip for 3900 Indian rupees' }] }), false)
  const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('googlePriceWaits<5&&googleBookingStillPricing(page)') && src.includes('googlePriceWaits===3&&!googleBookingReloaded&&googleBookingUrl'), 'bounded waits and one reload')
  console.log('GOOGLE_PRICING_WAIT_OK')
}
