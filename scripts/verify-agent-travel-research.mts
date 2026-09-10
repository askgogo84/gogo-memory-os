import { buildTravelResearchContext, curateTravelResults, isPublicTravelResearchRequest } from '../lib/agent/travel-research'

const cases: Array<[string, boolean]> = [
  ['find a cheap flight to mumbai next week from bangalore', true],
  ['compare flight prices from BLR to BOM next week', true],
  ['cheapest airfare to Dubai next month', true],
  ['show me available hotels in Goa this week', true],
  ['find my flight ticket', false],
  ['show my PNR', false],
  ['open my saved boarding pass', false],
  ['what time is my flight tomorrow', false],
]

let failed = 0
for (const [text, expected] of cases) {
  const got = isPublicTravelResearchRequest(text)
  if (got !== expected) {
    failed++
    console.error(`✗ ${JSON.stringify(text)} got=${got} expected=${expected}`)
  } else {
    console.log(`✓ ${JSON.stringify(text)} → ${got ? 'live research' : 'saved/private travel'}`)
  }
}

const fixedNow = new Date('2026-09-10T04:00:00Z')
const route = buildTravelResearchContext('find a cheap flight to mumbai next week from bangalore', fixedNow)
if (route.origin?.code !== 'BLR' || route.destination?.code !== 'BOM' || route.routeLabel !== 'BLR → BOM') {
  failed++
  console.error('✗ route parsing failed', route)
} else {
  console.log(`✓ route parsing → ${route.routeLabel} · ${route.whenLabel}`)
}

const results = curateTravelResults([
  { title:'Mumbai (BOM) to Bangalore (BLR) Flights', snippet:'Mumbai to Bengaluru cheap flights', url:'https://example.com/reverse' },
  { title:'Bengaluru to Mumbai Flights, Fares from ₹4190', snippet:'Bangalore to Mumbai direct flights and fares', url:'https://example.com/forward' },
  { title:'Cheap Flights from Bengaluru to Mumbai', snippet:'BLR to BOM flight options', url:'https://example.org/forward' },
], route)
if (results.some(r => r.url.includes('/reverse')) || results.length !== 2) {
  failed++
  console.error('✗ reverse-direction filtering failed', results)
} else {
  console.log('✓ reverse-direction results are excluded')
}

if (failed) process.exit(1)
console.log('✅ Agent travel research routing and curation checks passed')
