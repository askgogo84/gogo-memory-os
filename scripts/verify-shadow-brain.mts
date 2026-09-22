import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shadowActionFamily, shadowNeedsContext } from '../lib/agent/shadow-brain'
import { buildJevShadowRequest, parseJevShadowResponse } from '../lib/typesafe/jev-shadow'

const shadow=readFileSync('lib/agent/shadow-brain.ts','utf8')
const whatsapp=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const dashboard=readFileSync('app/api/dashboard/chat/route.ts','utf8')

assert.match(shadow,/event_type:'shadow_brain_observation'/)
assert.match(shadow,/shadow_version:'shadow-brain-v1'/)
assert.match(shadow,/needsContext/)
assert.match(shadow,/focusKind/)
assert.match(shadow,/ambiguous/)
assert.match(shadow,/runJevShadow/)
assert.match(shadow,/jev_shadow/)

assert.match(whatsapp,/await observeShadowBrainTurn/)
assert.match(dashboard,/await observeShadowBrainTurn/)

// Observe-only invariant: production handlers still receive the original text.
assert.match(whatsapp,/routeFeatureIntent\(from, text/)
assert.match(whatsapp,/tryRunWhatsAppAgent\(\{[\s\S]*text,/)
assert.match(dashboard,/tryRunAppointmentResearch\(\{ actor, surface:'web', text \}/)
assert.match(dashboard,/tryRunTrainResearch\(\{ actor, surface:'web', text \}/)

// Shadow output is intentionally not assigned or passed to a production router.
assert.doesNotMatch(whatsapp,/const\s+\w+\s*=\s*await observeShadowBrainTurn/)
assert.doesNotMatch(dashboard,/const\s+\w+\s*=\s*await observeShadowBrainTurn/)
assert.doesNotMatch(shadow,/\.from\('agent_runs'\)\.insert/)
assert.doesNotMatch(shadow,/\.from\('agent_approvals'\)\.insert/)

console.log('Shadow Brain observe-only verification passed')

assert.equal(shadowNeedsContext('Order my usual pizza'),true)
assert.equal(shadowNeedsContext('Same as last time'),true)
assert.equal(shadowNeedsContext('Save it to my calendar'),true)
assert.equal(shadowNeedsContext('Monitor it and tell me if anything changes'),true)
assert.equal(shadowNeedsContext('Book the second one'),true)
assert.equal(shadowActionFamily('Save it to my calendar'),'calendar')
assert.equal(shadowActionFamily('Monitor it and tell me if anything changes'),'monitor')
assert.equal(shadowActionFamily('Book it'),'book')

assert.equal(shadowActionFamily('Order my usual pizza'),'buy')

const jevRequest=buildJevShadowRequest({
  text:'Move it to 11 AM instead.',
  currentCapability:'reminders',
  currentActionFamily:'remind',
  needsContext:true,
  focusKind:'mission',
  focusSummary:'Call Vikram about Project Neptune',
})
assert.equal(jevRequest.model,'jev-latest')
assert.equal((jevRequest.questions.intent as any).type,'choice')
assert.ok('reminder_mutation' in (jevRequest.questions.intent as any).criteria)
assert.ok('calendar_mutation' in (jevRequest.questions.intent as any).criteria)
assert.equal((jevRequest.questions.referent_kind as any).type,'choice')

const parsed=parseJevShadowResponse({answers:{
  intent:{type:'choice',choice:'reminder_mutation',confidence:0.94,probabilities:{reminder_mutation:0.94,calendar_mutation:0.03}},
  action_mode:{type:'choice',choice:'private_write',confidence:0.91,probabilities:{private_write:0.91}},
  referent_kind:{type:'choice',choice:'reminder',confidence:0.89,probabilities:{reminder:0.89}},
}},17)
assert.equal(parsed.intent.choice,'reminder_mutation')
assert.equal(parsed.actionMode.choice,'private_write')
assert.equal(parsed.referentKind.choice,'reminder')
assert.equal(parsed.latencyMs,17)
console.log('Jev shadow request/response verification passed')
