import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildTravelPresenceFacts,
  factsAt,
  lexicalScore,
  renderContextBlock,
  travelContextAt,
  type ContextPack,
} from '../lib/agent/context-brain'

assert.ok(lexicalScore('book Naru restaurant', 'Naru restaurant reservation') > 0.5)
assert.equal(lexicalScore('restaurant booking', 'Gmail follow up'), 0)

const flights=[
  {
    id:'leg-1',type:'flight',from_city:'Bengaluru',to_city:'Abu Dhabi',
    depart_at:'2026-09-27T16:45:00.000Z',arrive_at:'2026-09-27T20:30:00.000Z',
    airline:'Etihad',flight_no:'EY239',booking_group:'trip-ny',
  },
  {
    id:'leg-2',type:'flight',from_city:'Abu Dhabi',to_city:'New York',
    depart_at:'2026-09-27T22:35:00.000Z',arrive_at:'2026-09-28T12:35:00.000Z',
    airline:'Etihad',flight_no:'EY1',booking_group:'trip-ny',
  },
]
const facts=buildTravelPresenceFacts(flights,Date.parse('2026-09-26T12:00:00.000Z'),60)
assert.ok(facts.some(f=>f.source==='travel_ticket'&&f.summary.includes('Abu Dhabi → New York')))
const nyPresence=facts.find(f=>f.source==='travel_presence'&&f.location==='New York')
assert.ok(nyPresence)
assert.equal(nyPresence?.startAt,'2026-09-28T12:35:00.000Z')
assert.ok(Date.parse(String(nyPresence?.endAt)) >= Date.parse('2026-09-28T14:30:00.000Z'))

const pack:ContextPack={
  query:'Book Naru Noodle Bar for 2 at the next available slot',
  generatedAt:'2026-09-26T12:00:00.000Z',
  memoryEnabled:true,
  facts,
  provenance:{lifeEvents:0,travelTickets:facts.length,openLoops:0,semanticMemories:0,insights:0,typedContext:0},
}
const at=factsAt(pack,'2026-09-28T14:30:00.000Z',0)
assert.ok(at.some(f=>f.source==='travel_presence'&&f.location==='New York'))
const travel=travelContextAt(pack,'2026-09-28T14:30:00.000Z')
assert.ok(travel.some(f=>f.location==='New York'))

const block=renderContextBlock(pack)
assert.match(block,/evidence, never permission/i)
assert.match(block,/New York/)
assert.match(block,/INFERRED — not a recorded booking\/fact/,'inferred travel presence must be unmistakably labeled')
assert.match(block,/timestamps ending in Z are UTC, not IST/i,'context prompt must forbid UTC/IST relabeling')
assert.match(block,/Never claim the user is "back"/i,'return-location claims require recorded evidence')
assert.match(block,/Do not introduce a specific remembered venue/i,'unasked prior venue/task leakage must be suppressed')
assert.doesNotMatch(block,/PNR|password|OTP/i)

const processMessage=fs.readFileSync('lib/bot/process-message.ts','utf8')
const claude=fs.readFileSync('lib/services/claude.ts','utf8')
const planner=fs.readFileSync('lib/agent/general-planner.ts','utf8')
const restaurant=fs.readFileSync('lib/agent/restaurant-reservation.ts','utf8')
const restaurantWorker=fs.readFileSync('lib/agent/restaurant-reservation-worker.ts','utf8')
const agentRoute=fs.readFileSync('app/api/agent/run/route.ts','utf8')
const whatsappBridge=fs.readFileSync('lib/agent/whatsapp-bridge.ts','utf8')

assert.match(processMessage,/buildContextPack/)
assert.match(processMessage,/renderContextBlock/)
assert.match(processMessage,/askClaude\(incomingText, history, memories, resolvedUser\.name, preferenceBlock, contextualBlock\)/)
assert.match(claude,/contextualBlock/)
assert.match(claude,/Relevant AskGogo context|contextualContext/)
assert.match(claude,/isContextSynthesisTurn/,'context synthesis must be explicitly detected')
assert.match(claude,/historyForTurn = isContextSynthesisTurn\(userMessage\) \? \[\] : safeHistory\.slice\(-10\)/,'context synthesis must not inherit stale recent-chat entities')
assert.match(claude,/Do not introduce a named restaurant, vendor, person, product, project, or prior task/,'current-turn entity relevance must be enforced')
assert.match(claude,/Never say "when you're back"/,'return-location claims require recorded evidence')
assert.match(claude,/A prior assistant suggestion is never evidence/,'assistant history must not become factual evidence')

assert.match(planner,/prepareGeneralPlanForActor/)
assert.match(planner,/Context is evidence, not authorization/)
assert.match(planner,/known context conflicts with the requested timing\/location/)
assert.match(agentRoute,/prepareGeneralPlanForActor\(actor,text\)/)
assert.match(whatsappBridge,/prepareGeneralPlanForActor\(actor,params\.text\)/)

assert.match(restaurant,/buildContextPack/)
assert.match(restaurant,/travelContextAt/)
assert.match(restaurant,/contextWindows/)
assert.match(restaurant,/saved travel context places you/)
assert.match(restaurantWorker,/Known owner context/)
assert.match(restaurantWorker,/actual DINING SLOT/)
assert.match(restaurantWorker,/do not submit; stop and ask/)

console.log('✅ Context Brain v1 regression passed: bounded retrieval + semantic memory + temporal travel context + planner/freeform/specialist wiring')

assert.match(processMessage,/contextualizeSavedItemReply/,'saved media should run through contextual association')
const association=fs.readFileSync('lib/agent/contextual-association.ts','utf8')
assert.match(association,/Platform: \${params\.item\.platform}/,'media association must use the understood media item, not only the raw URL')
assert.match(association,/includeSemantic:true,maxFacts:10/,'media association should retrieve bounded semantic context')
assert.match(association,/f\.score>=0\.58&&f\.confidence>=0\.55/,'weak long-memory matches must be filtered')
assert.match(association,/return exactly NONE/,'association must stay silent when relevance is weak')
assert.match(association,/Do not introduce any named entity unless it appears in the supplied context/,'unrelated entity leakage must remain forbidden')
console.log('Contextual Long Memory media-association verification passed')

const mediaMemory=fs.readFileSync('lib/services/media-memory.ts','utf8')
assert.match(mediaMemory,/sourceTable:'media_saves'/,'understood media must write back into semantic long memory')
assert.match(mediaMemory,/semanticSourceId=createHash\('sha256'\)/,'media write-back must use a deterministic dedupe key')
assert.match(mediaMemory,/params\.detectedUrl\|\|''/,'canonical source URL should participate in media identity when available')
assert.match(mediaMemory,/await indexMemory\(\{/,'media write-back should be awaited so serverless completion cannot drop it')
console.log('Contextual Long Memory media write-back + semantic dedupe verification passed')

const contextBrainGoalSource=fs.readFileSync('lib/agent/context-brain.ts','utf8')
assert.match(contextBrainGoalSource,/from\('agent_goals'\)/,'active goals must be available to Context Brain')
assert.match(contextBrainGoalSource,/source:'goal'/,'goals must carry typed provenance')
assert.match(contextBrainGoalSource,/Goal: /,'goal context should be human-readable')
assert.match(contextBrainGoalSource,/score<0\.5&&lexical<0\.16/,'unrelated goals must stay out of a turn')
console.log('Contextual Long Memory goal recall verification passed')
