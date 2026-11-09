// Phase OR-1 synthetic acceptance matrix (handoff 26 Oct): mocked HTTP only, no network, no key.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as g from '../lib/inference/openrouter-gateway'

const on: g.GatewayConfig = { enabled: true, apiKey: 'test-key', model: 'pinned/model', providers: ['approved-provider'], maxTokensPerCall: 4000, timeoutMs: 1000 }
const publicText = 'Summarise this public article: The Reserve Bank kept the repo rate unchanged at its October meeting.'
const calls: any[] = []
const ok = (content = 'The repo rate was unchanged.'): typeof fetch => (async (url: any, init: any) => {
  calls.push({ url: String(url), init })
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 30, completion_tokens: 8 } }), { status: 200 })
}) as any

// OR-K: disabled by default; with no env, every call takes the existing primary route unchanged.
const off = g.gatewayConfigFromEnv({})
assert.equal(off.enabled, false)
assert.equal(g.gatewayConfigFromEnv({ GOGO_OPENROUTER_GATEWAY: 'approved', OPENROUTER_API_KEY: 'k' }).enabled, false, 'model and provider must be pinned too')
assert.equal(g.gatewayConfigFromEnv({ GOGO_OPENROUTER_GATEWAY: 'yes', OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm', OPENROUTER_PROVIDER_ONLY: 'p' }).enabled, false, "only the literal 'approved' enables it")
let primaryRuns = 0
const viaOff = await g.completeViaGatewayOrPrimary({ taskClass: 'public_web_research', containsPersonalData: false, text: publicText }, async () => { primaryRuns++; return 'primary' }, r => r.text, { config: off, fetchImpl: ok() })
assert.deepEqual([viaOff.route, viaOff.value, viaOff.reason, primaryRuns, calls.length], ['primary', 'primary', 'gateway_disabled', 1, 0])

// OR-A: public text allowed; body carries ZDR / no data collection / pinned provider / attribution, no PII session id.
const viaOn = await g.completeViaGatewayOrPrimary({ taskClass: 'public_web_research', containsPersonalData: false, text: publicText }, async () => 'primary', r => r.text, { config: on, fetchImpl: ok() })
assert.deepEqual([viaOn.route, viaOn.value], ['gateway', 'The repo rate was unchanged.'])
const sent = calls.at(-1)
assert.equal(sent.url, 'https://openrouter.ai/api/v1/chat/completions')
assert.equal(sent.init.headers['HTTP-Referer'], 'https://askgogo.in')
assert.equal(sent.init.headers['X-OpenRouter-Title'], 'AskGogo')
assert.equal(sent.init.headers['X-OpenRouter-Categories'], 'personal-agent,general-chat')
const body = JSON.parse(sent.init.body)
assert.deepEqual(body.provider, { only: ['approved-provider'], allow_fallbacks: false, zdr: true, data_collection: 'deny', require_parameters: true })
assert.equal(body.model, 'pinned/model')
assert.match(body.session_id, /^ag-[0-9a-f-]{36}$/, 'OR-H: opaque random session id')
assert.equal(body.tools, undefined, 'no tools are ever offered')

// OR-B / OR-C: personal data, owner context and protected records are refused before any call.
const before = calls.length
for (const [text, reason] of [
  ['Summarise: reach me at divya@example.com', 'detected_personal_data'],
  ['Classify: call +91 98450 12345 today', 'detected_personal_data'],
  ['Summarise my inbox from today', 'owner_context'],
  ['[GMAIL thread=1] Summarise this public article', 'detected_personal_data'],
  ['[APPROVAL id=apv_1] booking ok', 'contains_approval_or_execution_record'],
] as const) assert.equal((g.gatewayRoute({ taskClass: 'public_web_research', containsPersonalData: false, text }, on) as any).reason, reason, text)
assert.equal((g.gatewayRoute({ taskClass: 'gmail', containsPersonalData: false, text: publicText }, on) as any).reason, 'class_not_permitted', 'OR-C: a private class is refused even if the text looks public')
assert.equal((g.gatewayRoute({ taskClass: 'make_draft_nonpersonal', containsPersonalData: false, text: publicText }, on) as any).reason, 'class_not_permitted', 'drafts stay on the direct route')
assert.equal((g.gatewayRoute({ taskClass: 'public_web_research', containsPersonalData: true, text: publicText }, on) as any).reason, 'declared_personal_data')
assert.equal(calls.length, before)

// OR-D / OR-I: a tool call or empty content is never accepted as an answer; the caller falls back.
const toolCall: typeof fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok', tool_calls: [{ id: 't' }] } }] }), { status: 200 })) as any
const viaTool = await g.completeViaGatewayOrPrimary({ taskClass: 'safe_classification', containsPersonalData: false, text: 'Label the topic: cricket scores today' }, async () => 'primary', r => r.text, { config: on, fetchImpl: toolCall })
assert.deepEqual([viaTool.route, viaTool.reason], ['primary', 'gateway_invalid_response'])

// OR-F: 429 / outage → primary once, no retry on the gateway; the breaker opens after repeated failures.
let hits = 0
const limited: typeof fetch = (async () => { hits++; return new Response('', { status: 429 }) }) as any
const breaker = new g.CircuitBreaker(2, 60_000)
for (let i = 0; i < 2; i++) assert.equal((await g.completeViaGatewayOrPrimary({ taskClass: 'public_web_research', containsPersonalData: false, text: publicText }, async () => 'primary', r => r.text, { config: on, fetchImpl: limited, breaker })).route, 'primary')
assert.equal(hits, 2, 'one call per request, no retry')
const afterOpen = await g.completeViaGatewayOrPrimary({ taskClass: 'public_web_research', containsPersonalData: false, text: publicText }, async () => 'primary', r => r.text, { config: on, fetchImpl: limited, breaker })
assert.deepEqual([afterOpen.reason, hits], ['circuit_open', 2], 'open breaker skips the gateway entirely')

// OR-G: over budget → refused before any call, typed reason, no fake answer.
assert.equal((g.gatewayRoute({ taskClass: 'public_web_research', containsPersonalData: false, text: 'word '.repeat(20000) }, on) as any).reason, 'budget_exceeded')

// The module is not wired: nothing in app/ or lib/ imports it, and cheap.ts still forbids gateways.
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [] })
const importers = [...walk('app'), ...walk('lib')].filter(f => !f.endsWith('openrouter-gateway.ts') && /openrouter-gateway/.test(readFileSync(f, 'utf8')))
assert.deepEqual(importers, [], 'no runtime code imports the gateway yet')
assert.match(readFileSync('lib/inference/cheap.ts', 'utf8'), /no gateways/)
console.log('OpenRouter gateway synthetic matrix (OR-A..OR-K) passed')
