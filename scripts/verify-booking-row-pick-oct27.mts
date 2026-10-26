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
