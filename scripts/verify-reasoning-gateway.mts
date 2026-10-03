import assert from 'node:assert/strict'
import { completeReasoningWithProviders, type ReasoningRequest } from '../lib/services/reasoning-gateway'

const request:ReasoningRequest={
  purpose:'freeform',
  system:'AskGogo owns context and policy.',
  messages:[{role:'user',content:'Help me plan this.'}],
  maxTokens:200,
  temperature:0,
}

let anthropicCalls=0
let openaiCalls=0
const fallback=await completeReasoningWithProviders(
  request,
  'anthropic',
  'openai',
  {
    anthropic:async()=>{anthropicCalls++;throw Object.assign(new Error('provider unavailable'),{status:400})},
    openai:async(req)=>{
      openaiCalls++
      assert.equal(req.messages[0].content,'Help me plan this.')
      return {text:'provider-independent answer',model:'test-openai'}
    },
  },
)
assert.equal(fallback.text,'provider-independent answer')
assert.equal(fallback.provider,'openai')
assert.equal(fallback.fallbackUsed,true)
assert.equal(anthropicCalls,1)
assert.equal(openaiCalls,1)

anthropicCalls=0
openaiCalls=0
const primary=await completeReasoningWithProviders(
  request,
  'openai',
  'anthropic',
  {
    anthropic:async()=>{anthropicCalls++;return {text:'should not run',model:'test-anthropic'}},
    openai:async()=>{openaiCalls++;return {text:'swapped primary works',model:'test-openai'}},
  },
)
assert.equal(primary.text,'swapped primary works')
assert.equal(primary.provider,'openai')
assert.equal(primary.fallbackUsed,false)
assert.equal(openaiCalls,1)
assert.equal(anthropicCalls,0)

await assert.rejects(
  completeReasoningWithProviders(
    request,
    'anthropic',
    'openai',
    {
      anthropic:async()=>{throw new Error('down')},
      openai:async()=>{throw new Error('down')},
    },
  ),
  /reasoning_providers_unavailable/,
)

console.log('AskGogo reasoning gateway provider-independence verification passed')
