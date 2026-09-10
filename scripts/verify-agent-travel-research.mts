import { isPublicTravelResearchRequest } from '../lib/agent/travel-research'

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

if (failed) process.exit(1)
console.log('✅ Agent travel research routing checks passed')
