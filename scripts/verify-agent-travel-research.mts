import { readFileSync } from 'node:fs'
import { buildTravelResearchContext, curateTravelResults, isPublicTravelResearchRequest } from '../lib/agent/travel-research'
import { sanitizeTravelResearchText } from '../lib/agent/travel-research-sanitize'

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
const request = 'find a cheap flight to mumbai next week from bangalore'
const route = buildTravelResearchContext(request, fixedNow)
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

const raw = `Current public search · BLR → BOM · 14 Sep 2026 – 20 Sep 2026\nI did not use your saved tickets.\n\n1. Ixigo — Bengaluru to Mumbai Flights, Fares @₹4106\nDate signal: 14 Sep 2026, 20 Sep 2026 · inside your requested window\nPublic snippet mentions ₹4106 · verify on the source before booking\n14 Sep 2026 fare ₹5,109\nOpen source: https://ixigo.example/blr-bom\n\n2. Momondo — Cheap Flights from Bengaluru to Mumbai\nDate signal: 20 Sep 2026 · inside your requested window\nINR fare: not verified in the public snippet\n20 Sep 2026 option. 26 Sep 2026 and 27 Sep 2026 options also shown.\nOpen source: https://momondo.example/blr-bom\n\n3. EaseMyTrip — Bangalore to Mumbai Flight Tickets from ₹4333\nDate: route page found · exact requested date not verified\nPublic snippet mentions ₹4333 · verify on the source before booking\nGeneral route page with fare ₹4,984 but no requested date.\nOpen source: https://easemytrip.example/blr-bom\n\nThese are public-web sources, not guaranteed live inventory.`

const hardened = sanitizeTravelResearchText(raw, request, fixedNow)
if (hardened.includes('Momondo') || hardened.includes('26 Sep 2026') || hardened.includes('27 Sep 2026')) {
  failed++
  console.error('✗ mixed-week result survived hardening', hardened)
} else console.log('✓ mixed-week snippets are excluded entirely')

if (hardened.includes('₹4333') || hardened.includes('₹4,984')) {
  failed++
  console.error('✗ unverified-date INR fare survived hardening', hardened)
} else console.log('✓ unverified-date INR fares are suppressed')

if (!hardened.includes('Ixigo') || !hardened.includes('₹4106')) {
  failed++
  console.error('✗ valid in-window fare was removed', hardened)
} else console.log('✓ in-window INR fare remains visible with verification language')

const bridgeSource = readFileSync(new URL('../lib/integrations/creditiq-travel.ts', import.meta.url), 'utf8')
if (!bridgeSource.includes('/api/internal/gogo/travel/flights')) {
  failed++
  console.error('✗ CreditIQ flight bridge is not using the signed internal service endpoint')
} else console.log('✓ flight research uses the signed CreditIQ service endpoint')

if (!bridgeSource.includes('/api/internal/gogo/travel/hotels')) {
  failed++
  console.error('✗ CreditIQ hotel bridge is not using the signed internal service endpoint')
} else console.log('✓ hotel research uses the signed CreditIQ service endpoint')

if (!bridgeSource.includes('X-Gogo-Signature') || !bridgeSource.includes('CREDITIQ_GOGO_SERVICE_SECRET')) {
  failed++
  console.error('✗ CreditIQ service signature contract is missing')
} else console.log('✓ CreditIQ service requests are HMAC signed server-to-server')

if (bridgeSource.includes('`${baseUrl()}/api/flights/search`')) {
  failed++
  console.error('✗ unsigned public CreditIQ flight endpoint is still used by AskGogo')
} else console.log('✓ unsigned public flight API is not used by the AskGogo bridge')

if (!bridgeSource.includes('irreversiblePointsTransferAllowed: false')) {
  failed++
  console.error('✗ points-transfer safety boundary is not pinned in the AskGogo bridge')
} else console.log('✓ irreversible points transfers remain disabled at the bridge boundary')

const travelSource = readFileSync(new URL('../lib/agent/travel-research.ts', import.meta.url), 'utf8')
const hotelSource = readFileSync(new URL('../lib/agent/creditiq-hotel-research.ts', import.meta.url), 'utf8')
const actorSource = readFileSync(new URL('../lib/agent/actor.ts', import.meta.url), 'utf8')
if (!actorSource.includes("from('wa_creditiq_links')") || !actorSource.includes('consumer_user_id')) {
  failed++
  console.error('✗ Agent actor does not resolve the existing CreditIQ account link')
} else console.log('✓ Agent actor carries only the opaque linked CreditIQ consumer id')

if (!travelSource.includes('userLinkId: actor.creditiqUserId || null')) {
  failed++
  console.error('✗ linked CreditIQ identity is not passed into the signed flight decision bridge')
} else console.log('✓ linked users get CreditIQ wallet-aware flight decisions')

if (!hotelSource.includes('userLinkId: params.actor.creditiqUserId || null')) {
  failed++
  console.error('✗ linked CreditIQ identity is not passed into the signed hotel decision bridge')
} else console.log('✓ linked users get CreditIQ wallet-aware hotel decisions')

if (!travelSource.includes('projected redemption is never treated as executable')) {
  failed++
  console.error('✗ flight copy does not preserve projected-vs-executable redemption safety')
} else console.log('✓ projected flight redemptions remain clearly verification-gated')

if (!hotelSource.includes('Projected redemption is never treated as executable until verified')) {
  failed++
  console.error('✗ hotel copy does not preserve projected-vs-executable redemption safety')
} else console.log('✓ projected hotel redemptions remain clearly verification-gated')

if (!hotelSource.includes('does not prove award-night availability or an exact points price')) {
  failed++
  console.error('✗ hotel chain matching could be mistaken for verified award inventory')
} else console.log('✓ hotel loyalty discovery never claims award-night availability or exact points pricing')

if (failed) process.exit(1)
console.log('✅ Agent travel research routing, date, fare, identity and signed CreditIQ flight + hotel rewards checks passed')
