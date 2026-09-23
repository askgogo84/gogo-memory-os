import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildJevShadowRequest, parseJevShadowResponse } from '../lib/typesafe/jev-shadow'
import { promotedJevIntent } from '../lib/agent/jev-router'

const req=buildJevShadowRequest({
  text:'Draft a reply to the latest email from Ravi saying Thanks',
  currentCapability:'email',
  currentActionFamily:'send',
  needsContext:false,
  focusKind:'none',
})
assert.ok('email_read' in (req.questions.intent as any).criteria)
assert.ok('email_mutation' in (req.questions.intent as any).criteria)

const parsed=parseJevShadowResponse({answers:{
  intent:{type:'choice',choice:'email_mutation',confidence:0.98,probabilities:{email_mutation:0.98,email_read:0.01}},
  action_mode:{type:'choice',choice:'consequential_write',confidence:0.97,probabilities:{consequential_write:0.97}},
  attention_state:{type:'choice',choice:'none',confidence:0.99,probabilities:{none:0.99}},
  decision_readiness:{type:'choice',choice:'ready',confidence:0.98,probabilities:{ready:0.98,clarify:0.02}},
}},22,false)
assert.equal(promotedJevIntent(parsed as any),'email_mutation')

const bridge=readFileSync(new URL('../lib/agent/whatsapp-bridge.ts',import.meta.url),'utf8')
const wa=readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts',import.meta.url),'utf8')
assert.match(bridge,/params\.intent==='email_mutation'/)
assert.match(bridge,/tryRunGmailSendCommand/)
assert.match(bridge,/params\.intent==='email_read'/)
assert.match(bridge,/dispatchThroughSameBrain/)
assert.match(wa,/email_read/)
assert.match(wa,/email_mutation/)

console.log('Jev email semantic routing first-refusal passed')
