import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shadowActionFamily, shadowNeedsContext } from '../lib/agent/shadow-brain'

const shadow=readFileSync('lib/agent/shadow-brain.ts','utf8')
const whatsapp=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const dashboard=readFileSync('app/api/dashboard/chat/route.ts','utf8')

assert.match(shadow,/event_type:'shadow_brain_observation'/)
assert.match(shadow,/shadow_version:'shadow-brain-v1'/)
assert.match(shadow,/needsContext/)
assert.match(shadow,/focusKind/)
assert.match(shadow,/ambiguous/)

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
