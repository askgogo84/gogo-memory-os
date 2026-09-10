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
if (route.origin?.code !== 'BLR' || route.destination?.code !== 'BOM' || route.routeLabel !== 'BLR → BOM' || route.startDate !== '2026-09-14' || route.endDate !== '2026-09-20') {
  failed++
  console.error('✗ route/date parsing failed', route)
} else {
  console.log(`✓ route parsing → ${route.routeLabel} · ${route.whenLabel}`)
}

const results = curateTravelResults([
  { title:'Mumbai (BOM) to Bangalore (BLR) Flights', snippet:'Mumbai to Bengaluru cheap flights', url:'https://example.com/reverse' },
  { title:'Bengaluru to Mumbai Flights, Fares from ₹4190', snippet:'Bangalore to Mumbai direct flights and fares', url:'https://example.com/forward' },
  { title:'Cheap Flights from Bengaluru to Mumbai', snippet:'BLR to BOM flight options Sep 15 $52 Air India', url:'https://example.org/matched-foreign' },
  { title:'Google Flights Bengaluru to Mumbai', snippet:'Cheapest fares Sep 24 to Sep 27 ₹4384', url:'https://example.net/off-date' },
  { title:'BLR to BOM direct flight', snippet:'16 Sep 2026 fare ₹4,321 IndiGo nonstop', url:'https://example.co.in/matched-inr' },
], route)

if (results.some(r => r.url.includes('/reverse'))) {
  failed++
  console.error('✗ reverse-direction result was not excluded', results)
} else console.log('✓ reverse-direction results are excluded')

if (results.some(r => r.url.includes('/off-date'))) {
  failed++
  console.error('✗ off-date result was not excluded', results)
} else console.log('✓ off-date results are excluded')

const foreign = results.find(r => r.url.includes('/matched-foreign'))
if (!foreign || foreign.inrFare || foreign.snippet.includes('$52') || !foreign.foreignCurrencyOnly) {
  failed++
  console.error('✗ foreign-currency fare was not neutralized', foreign)
} else console.log('✓ foreign-currency fare is not presented as an INR fare')

const inr = results.find(r => r.url.includes('/matched-inr'))
if (!inr || inr.inrFare !== '₹4,321' || inr.dateRelevance !== 'matched') {
  failed++
  console.error('✗ date-matched INR fare signal was not preserved', inr)
} else console.log('✓ date-matched INR fare signal is preserved with verification caveat')

if (failed) process.exit(1)
console.log('✅ Agent travel research routing, date and fare curation checks passed')
