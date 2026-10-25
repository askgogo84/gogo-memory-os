import assert from 'node:assert/strict'
import { makeMiniMaxEvaluationAdapter, MINIMAX_EVAL_ENDPOINT, MINIMAX_EVAL_MODEL } from '../lib/inference/minimax-eval'

const policy = { trainsOnInputs: true, humanReview: true, retentionDays: 30 }
const originalNodeEnv = process.env.NODE_ENV
const mutableEnv = process.env as Record<string, string | undefined>
mutableEnv.NODE_ENV = 'test'
const calls: Array<{url: string; body: any}> = []
const fetchImpl: typeof fetch = async (url: any, init: any) => {
  calls.push({ url: String(url), body: JSON.parse(init.body) })
  return new Response(JSON.stringify({
    choices: [{ message: { content: 'Verified public answer' } }],
    usage: { prompt_tokens: 55, completion_tokens: 12 },
  }), { status: 200 })
}
try {
  assert.equal(makeMiniMaxEvaluationAdapter({ apiKey: 'synthetic', approvedPolicy: policy }), null)
  assert.equal(makeMiniMaxEvaluationAdapter({ apiKey: 'synthetic', enabled: true }), null)
  const adapter = makeMiniMaxEvaluationAdapter({ apiKey: 'synthetic', enabled: true, approvedPolicy: policy, fetchImpl })
  assert.ok(adapter)
  const result = await adapter.complete({ taskClass: 'public_web_research', prompt: 'Summarise public AI research.', maxOutputTokens: 512 })
  assert.equal(result.text, 'Verified public answer')
  assert.equal(result.inputTokens, 55)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, MINIMAX_EVAL_ENDPOINT)
  assert.equal(calls[0].body.model, MINIMAX_EVAL_MODEL)
  assert.equal(calls[0].body.reasoning_effort, 'low')
  for (const prompt of ['Summarise public sources about divya@example.com', '[APPROVAL id=123] paid', '']) {
    await assert.rejects(() => adapter.complete({ taskClass: 'public_web_research', prompt }))
  }
  await assert.rejects(() => adapter.complete({ taskClass: 'make_draft_nonpersonal', prompt: 'Synthetic deck' }))
  assert.equal(calls.length, 1, 'no additional provider calls on denied cases')
  mutableEnv.NODE_ENV = 'production'
  await assert.rejects(() => adapter.complete({ taskClass: 'public_web_research', prompt: 'public article' }), /production_denied/)
  assert.equal(calls.length, 1, 'an already-created adapter must also refuse production calls')
  assert.equal(makeMiniMaxEvaluationAdapter({ apiKey: 'synthetic', enabled: true, approvedPolicy: policy, fetchImpl }), null)
  console.log('minimax evaluation: default-off, synthetic public completion, outbound security checks passed')
} finally {
  if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV')
  else mutableEnv.NODE_ENV = originalNodeEnv
}
