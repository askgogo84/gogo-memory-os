// 27 Oct live: 54 Google Flights rows were observed but the model's quotes failed verification, so the read was lost.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const { assessReadOutcome } = await import('../lib/agent/secure-computer.ts')
const { googleFlightOptionsFromEvidence } = await import('../lib/agent/travel-browser-task.ts')
const row = (fare: number, t: string, arr: string) => `From ${fare} Indian rupees. Nonstop flight with IndiGo. Leaves Kempegowda International Airport Bengaluru at ${t} on Friday, November 6 and arrives at Indira Gandhi International Airport at ${arr} on Friday, November 6. Total duration 2 hr 50 min. Select flight`
const flightEvidence = { searchControls: ['Where from? Bengaluru BLR', 'Where to? New Delhi DEL', 'Change ticket type. One way', 'Change seating class. Economy', '1 passenger, change number of passengers.'],
  resultLabels: [row(10240, '6:00 AM', '8:50 AM'), row(10712, '9:15 AM', '12:05 PM'), row(11890, '8:30 PM', '11:20 PM')] }
const page = { url: 'https://www.google.com/travel/flights?hl=en&q=x', title: 'Bengaluru to New Delhi | Google Flights', text: 'Top flights ₹10,240 6:00 AM 8:50 AM', flightEvidence, controls: [] }
const seen: string[] = []
const answer = await assessReadOutcome('Read actual flight rows for Flights from BLR to DEL on 2026-11-06 one way for 1 adult in economy.', page, d => seen.push(d.reason))
assert.ok(answer && answer.includes('From 10240 Indian rupees. Nonstop flight with IndiGo'), String(answer))
assert.deepEqual(seen, ['verified'], 'no model call needed')
const opts = googleFlightOptionsFromEvidence({ url: page.url, flightEvidence, pageText: answer }, { origin: { code: 'BLR', label: 'Bengaluru' }, destination: { code: 'DEL', label: 'New Delhi' }, startDate: '2026-11-06', adults: 1, cabin: 'economy' } as any)
assert.equal(opts.length, 3); assert.equal(opts[0].fareInr, 10240)
console.log('FLIGHT_ROWS_DIRECT_OK')
