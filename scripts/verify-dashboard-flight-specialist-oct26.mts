// 26 Oct live (dashboard): "Find the cheapest one-way flight from Bengaluru to Delhi on 20 November for 1 adult…"
// went to the general planner (23.6s) and answered with snippet fares (no airline, times or date-specific price).
// WhatsApp and /api/agent/run already prefer the specialist travel engine; the dashboard now does too, before the
// planner. Offline. Run: npx --yes tsx scripts/verify-dashboard-flight-specialist-oct26.mts
// Also runs the share-price watch checks (registered here to keep package.json free of merge conflicts).
import './verify-stock-watch-oct26.mts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldPreferSpecialistTravel } from '../lib/agent/specialist-routing'

const LIVE = 'Find the cheapest one-way flight from Bengaluru to Delhi on 20 November for 1 adult. Show airline, times, price and source link. Research only; do not book.'
assert.equal(shouldPreferSpecialistTravel(LIVE), true, 'the live flight ask is pure travel research')
assert.equal(shouldPreferSpecialistTravel('Check Singapore flight from Bangalore on 27th October'), true)
assert.equal(shouldPreferSpecialistTravel('Find flights to Goa next Friday and remind me to book tomorrow'), false, 'cross-feature asks keep the planner')
assert.equal(shouldPreferSpecialistTravel('Is my flight 6E 6240 on time?'), false, 'flight status is not a search')

const route = readFileSync(new URL('../app/api/dashboard/chat/route.ts', import.meta.url), 'utf8')
const specialist = route.indexOf("shouldPreferSpecialistTravel(text)) {")
const planner = route.indexOf('await tryRunGeneralPlan({')
const places = route.indexOf("import('@/lib/agent/places-search')")
assert.ok(specialist > 0 && planner > 0 && specialist < planner, 'specialist travel runs before the general planner')
assert.ok(places > 0 && places < specialist, 'hotel/restaurant place asks are still answered by places search first')
const block = route.slice(specialist, planner)
assert.match(block, /await tryRunTravelResearch\(\{ actor, surface:'web', text \}\)/)
assert.match(block, /await hardenTravelResearchResult\(travel, text\)/, 'the same sanitiser as every other travel path')
assert.match(route, /tryRunTravelResearch, shouldPreferSpecialistTravel \} from '@\/lib\/agent\/travel-research'/)
const tr = await import('../lib/agent/travel-research')
assert.equal(tr.shouldPreferSpecialistTravel(LIVE), true, 'the dashboard reads the same rule')
// 26 Oct (owner, 16:02): typing in the remote Take Control view is hard on a phone; every hand-back also gives the
// plain page link, and says plainly that Gogo won't see what happens in the person's own browser.
const bc = readFileSync(new URL('../lib/agent/browser-command.ts', import.meta.url), 'utf8')
assert.equal((bc.match(/Typing is easier in your own browser\? Open the page directly \(Gogo won't see what you do there\)/g) || []).length, 2)
console.log('Dashboard flight research goes to the specialist travel engine before the general planner')
