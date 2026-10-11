import assert from 'node:assert/strict'
import { SPECIALIST_AGENTS, selectSpecialistRoute } from '../lib/agent/specialist-registry.ts'

const cases:[string,string][]=[
  ['Book a Mumbai to Rajkot train tomorrow after 6','travel'],
  ['Find flights to New York and compare the best options','travel'],
  ['Find tickets for a concert this weekend','ticketing'],
  ['BookMyShow movie tickets for tonight','ticketing'],
  ['Order my usual biryani but compare Swiggy and Zomato first','food'],
  ['Get this grocery list from the cheapest service between Blinkit and Zepto','grocery'],
  ['Find this phone on Amazon and Flipkart and tell me the best deal','shopping'],
  ['Find me a salon appointment tomorrow','local_services'],
  ['Check my latest Gmail for the confirmation','communications'],
  ['Find my passport PDF and tell me when it expires','documents'],
  ['Remind me before my subscription renews','life_events'],
]
for(const [text,expected] of cases)assert.equal(selectSpecialistRoute(text).primary,expected,`${text} should route to ${expected}`)

for(const def of Object.values(SPECIALIST_AGENTS)){
  assert.ok(def.memories.includes('working'),`${def.id} must have working memory`)
  assert.ok(def.memories.length<=7,`${def.id} memory policy must be explicit and bounded`)
}

for(const id of ['travel','ticketing','food','grocery','shopping','local_services','payments'] as const){
  const d=SPECIALIST_AGENTS[id]
  assert.equal(d.externalMutationRequiresApproval,true,`${id} external mutation must require approval`)
  assert.equal(d.paymentBoundary,'approval_then_handoff',`${id} must not inherit payment authority implicitly`)
}

assert.ok(!SPECIALIST_AGENTS.secure_browser.surfaces.includes('payment_handoff'),'secure browser must not own payment authority')
assert.equal(SPECIALIST_AGENTS.secure_browser.paymentBoundary,'prepare_only')
assert.ok(SPECIALIST_AGENTS.life_events.memories.includes('prospective'),'life-event agent must own prospective memory')
assert.ok(SPECIALIST_AGENTS.documents.memories.includes('retrieval'),'documents agent must use exact retrieval memory')
assert.ok(SPECIALIST_AGENTS.travel.memories.includes('episodic'),'travel should learn from prior verified runs')

console.log('✅ Specialist agent + seven-memory routing regression passed')
