import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const helper=readFileSync('lib/agent/shadow-router-outcome.ts','utf8')
const wa=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const web=readFileSync('app/api/dashboard/chat/route.ts','utf8')

assert.match(helper,/event_type:'shadow_router_outcome'/)
assert.match(helper,/event_id:eventId/)
assert.match(helper,/actual_handler/)
assert.match(helper,/actual_capability/)

assert.match(wa,/observeShadowBrainTurn\([\s\S]*eventId:inboundMessageSid/)
assert.match(wa,/recordShadowRouterOutcome\([\s\S]*eventId:inboundMessageSid/)
assert.match(wa,/actualHandler:'legacy-feature-intent'/)
assert.match(wa,/actualHandler:'payment-intent'/)
assert.match(wa,/actualHandler:\(result as any\)\.handledBy \|\| 'process-message'/)

assert.match(web,/const shadowEventId = `web-\$\{randomUUID\(\)\}`/)
assert.match(web,/observeShadowBrainTurn\(\{ actor, surface:'web', text, eventId:shadowEventId \}\)/)
assert.match(web,/recordShadowRouterOutcome\([\s\S]*eventId:shadowEventId/)
assert.match(web,/messageId: shadowEventId/)

assert.doesNotMatch(helper,/agent_runs'\)\.insert/)
assert.doesNotMatch(helper,/agent_approvals'\)\.insert/)

console.log('Shadow router comparison verification passed')
