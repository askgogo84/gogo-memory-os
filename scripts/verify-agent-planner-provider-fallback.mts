import assert from 'node:assert/strict'
import { completePlannerPromptWithFallback } from '../lib/agent/planner-provider'

let primaryCalls=0
let fallbackCalls=0
const output=await completePlannerPromptWithFallback(
  'plan this',
  async()=>{primaryCalls++;throw Object.assign(new Error('credit balance too low'),{status:400,type:'invalid_request_error'})},
  async prompt=>{fallbackCalls++;assert.equal(prompt,'plan this');return '{"title":"Fallback plan","steps":[{"tool":"memory","title":"Read","instruction":"Read context"},{"tool":"tasks","title":"Do","instruction":"Create task: test"}]}'},
)
assert.match(output,/Fallback plan/)
assert.equal(primaryCalls,1)
assert.equal(fallbackCalls,1)

fallbackCalls=0
const primaryOutput=await completePlannerPromptWithFallback(
  'primary works',
  async()=>'{"title":"Primary"}',
  async()=>{fallbackCalls++;return 'should not run'},
)
assert.equal(primaryOutput,'{"title":"Primary"}')
assert.equal(fallbackCalls,0)

console.log('agent planner provider fallback verification passed')
