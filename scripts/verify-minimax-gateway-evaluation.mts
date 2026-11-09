import assert from 'node:assert/strict'
import { makeMiniMaxGatewayEvaluationAdapter, estimateMiniMaxUsd, MINIMAX_GATEWAY_EVAL_ENDPOINT, MINIMAX_GATEWAY_EVAL_MODEL } from '../lib/inference/minimax-gateway-eval'

const original = process.env.NODE_ENV
const env = process.env as Record<string,string|undefined>
env.NODE_ENV = 'test'
const policy = { trainsOnInputs: true, humanReview: true, retentionDays: 30 }
let outboundCalls = 0
const requestBodies: any[] = []
const fakeFetch: typeof fetch = async (url: any, init: any) => {
  outboundCalls++
  assert.equal(String(url), MINIMAX_GATEWAY_EVAL_ENDPOINT)
  requestBodies.push(JSON.parse(init.body))
  return new Response(JSON.stringify({ choices:[{message:{content:'Grounded synthetic summary'}}], usage:{prompt_tokens:1000,completion_tokens:100} }),{status:200})
}
try {
  assert.equal(makeMiniMaxGatewayEvaluationAdapter({apiKey:'fixture'}), null)
  assert.equal(makeMiniMaxGatewayEvaluationAdapter({apiKey:'fixture',enabled:true}),null)
  const model = makeMiniMaxGatewayEvaluationAdapter({apiKey:'fixture',enabled:true,approvedPolicy:policy,fetchImpl:fakeFetch})
  assert.ok(model)
  const result=await model.complete({taskClass:'public_web_research',prompt:'Summarize public technology trends.',maxOutputTokens:600})
  assert.equal(result.text,'Grounded synthetic summary')
  assert.equal(result.inputTokens,1000)
  assert.equal(outboundCalls,1)
  const body=requestBodies[0]
  assert.equal(body.model,MINIMAX_GATEWAY_EVAL_MODEL)
  assert.deepEqual(body.providerOptions.gateway.only,['minimax'])
  assert.equal(body.providerOptions.gateway.order,undefined,'do not use soft routing preference')
  assert.equal(body.reasoning.effort,'low')
  assert.equal(body.stream,false)

  for (const privatePayload of [
    'Public summary plus secret user@example.com',
    'Public summary plus [APPROVAL id=pending] write funds',
    'Public summary with [EXECUTION_RECORD run=1] complete',
    'Private note: my PAN ABCDE1234F',
    '',
  ]) {
    await assert.rejects(()=>model.complete({taskClass:'public_web_research',prompt:privatePayload}))
  }
  await assert.rejects(()=>model.complete({taskClass:'gmail' as any,prompt:'Synthetic email'}))
  assert.equal(outboundCalls,1,'denied classes and private texts produce no requests')

  // Runtime guard must also protect an adapter instantiated before environment changes.
  env.NODE_ENV='production'
  assert.equal(makeMiniMaxGatewayEvaluationAdapter({apiKey:'fixture',enabled:true,approvedPolicy:policy,fetchImpl:fakeFetch}),null)
  await assert.rejects(()=>model.complete({taskClass:'public_web_research',prompt:'Public topic'}),/production_denied/)
  assert.equal(outboundCalls,1)

  // Bookkeeping example only: no actual token-spend or latency claims.
  assert.equal(estimateMiniMaxUsd(20000,2000,0.15,0.60),0.0042)
  assert.equal(estimateMiniMaxUsd(20000,2000,0.10,0.50),0.003)
  assert.throws(()=>estimateMiniMaxUsd(-1,10,0.15,0.60))
  console.log('MiniMax Vercel Gateway offline tests: pinned provider, no private egress, disabled production, cost formula pass')
} finally {
  if (original===undefined) Reflect.deleteProperty(process.env,'NODE_ENV')
  else env.NODE_ENV=original
}
