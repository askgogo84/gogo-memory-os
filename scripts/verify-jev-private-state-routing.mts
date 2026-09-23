import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseJevShadowResponse } from '../lib/typesafe/jev-shadow'
import { promotedJevIntent } from '../lib/agent/jev-router'

const base=(intent:string)=>parseJevShadowResponse({answers:{
  intent:{type:'choice',choice:intent,confidence:0.97,probabilities:{[intent]:0.97}},
  action_mode:{type:'choice',choice:'private_write',confidence:0.95,probabilities:{private_write:0.95}},
  attention_state:{type:'choice',choice:'none',confidence:0.99,probabilities:{none:0.99}},
  decision_readiness:{type:'choice',choice:'ready',confidence:0.98,probabilities:{ready:0.98}},
}},15,false)

assert.equal(promotedJevIntent(base('list_task') as any),'list_task')
assert.equal(promotedJevIntent(base('memory_context') as any),'memory_context')

const bridge=readFileSync(new URL('../lib/agent/whatsapp-bridge.ts',import.meta.url),'utf8')
const wa=readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts',import.meta.url),'utf8')
assert.match(bridge,/params\.intent==='list_task'\|\|params\.intent==='memory_context'/)
assert.match(bridge,/dispatchThroughSameBrain/)
assert.match(wa,/list_task/)
assert.match(wa,/memory_context/)

console.log('Jev private-state first-refusal routing passed')
