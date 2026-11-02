// Synthetic provider contract tests: every fetch is intercepted; no real account or side effect.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
process.env.ANTHROPIC_API_KEY = 'fixture-anthropic'
process.env.OPENAI_API_KEY = 'fixture-openai'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service'
for (const key of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'INCEPTION_API_KEY', 'GOGO_BRAIN_MODEL']) delete process.env[key]
const policy = await import('../lib/services/anthropic-models.ts')
for (const value of [undefined, '', 'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', ' claude-sonnet-5-5 ']) {
  assert.equal(policy.resolveBrainModel(value), policy.SONNET_MODEL)
}
assert.throws(() => policy.resolveBrainModel('unknown-model'), /unsupported_brain_model/)
assert.equal(policy.messageText({ content: [{ type: 'thinking' }, { type: 'text', text: 'answer' }] }), 'answer')
for (const reason of ['refusal', 'max_tokens', 'model_context_window_exceeded']) {
  assert.equal(policy.messageText({ stop_reason: reason, content: [{ type: 'text', text: 'incomplete' }] }), '')
}
// Audit executable literals repository-wide. Historical pricing is deliberately retained for old events.
function audit(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) audit(path)
    else if (/\.(?:ts|tsx|js|mjs)$/.test(path)) {
      const source = readFileSync(path, 'utf8')
      if (path.endsWith('brain.ts')) assert.ok(!source.replace(/^.*'claude-sonnet-4-5':.*$/m, '').includes("'claude-sonnet-4-5'"), path)
      else assert.ok(!/['"]claude-sonnet-4-5(?:-20250929)?['"]/.test(source), path)
    }
  }
}
audit('lib'); audit('app')
let reply = 'answer'
let stopReason = 'end_turn'
let emitTool = true
let failStatus = 0
const requests: any[] = []
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input?.url || input)
  if (url === 'https://fixture.invalid/media') return new Response('fictional media bytes')
  assert.equal(url, 'https://api.anthropic.com/v1/messages', 'unexpected network blocked')
  const body = JSON.parse(init.body)
  requests.push(body)
  assert.ok(!body.model.startsWith('claude-sonnet-4-5'))
  assert.equal(body.messages.at(-1).role, 'user', 'no assistant prefill')
  if (body.model === policy.SONNET_MODEL) {
    assert.deepEqual(body.thinking, { type: 'between_tools' })
    assert.deepEqual(body.output_config, { effort: 'low' })
    for (const key of ['temperature', 'top_p', 'top_k', 'output_format']) assert.equal(body[key], undefined)
    if (body.tools) {
      assert.equal(body.tool_choice.type, 'auto')
      for (const tool of body.tools) {
        assert.equal(tool.strict, true); assert.equal(tool.input_schema.additionalProperties, false)
      }
    }
  }
  if (failStatus) {
    const status = failStatus; failStatus = 0
    return Response.json({ type: 'error', error: { type: 'not_found_error', message: 'fixture unavailable' } }, { status })
  }
  return Response.json({ id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'thinking', thinking: '', signature: 'fixture' }, ...(body.tools && emitTool
      ? [{ type: 'tool_use', id: 'tool_fixture', name: 'flight', input: { flight_no: 'QF1', track: true } }]
      : [{ type: 'text', text: reply }])], stop_reason: body.tools && emitTool ? stopReason === 'end_turn' ? 'tool_use' : stopReason : stopReason,
    usage: { input_tokens: 100, output_tokens: 20 } })
}) as any
try {
  const brain = await import('../lib/agent/brain.ts')
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: 'fixture', maxRetries: 0 })
  assert.equal(brain.estimateCostUsd(policy.SONNET_MODEL, { input: 5000, output: 150, cacheRead: 0, cacheCreation: 0 }), 0.0115)
  assert.equal(brain.estimateCostUsd(policy.DOCUMENT_FALLBACK_MODEL, { input: 5000, output: 150, cacheRead: 0, cacheCreation: 0 }), 0.01725)
  const ctx = { turns: [], trackedFlights: ['QF1'], sections: {}, timezone: 'Asia/Kolkata' }
  for (const model of [undefined, 'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929']) {
    const d = await brain.decide({ text: 'Did QF1 land?', ctx, client, model, meter: () => {} })
    assert.equal(d.kind, 'flight'); assert.equal((d as any).track, false, 'no tracking without consent')
  }
  const n = requests.length
  assert.equal((await brain.decide({ text: 'hello', ctx, client, model: 'unknown-model', meter: () => {} })).kind, 'skip')
  assert.equal(requests.length, n, 'unknown override fails before provider')
  process.env.GOGO_BRAIN_MODEL = 'unknown-model'
  assert.equal((await brain.decide({ text: 'hello', ctx, client, meter: () => {} })).kind, 'skip')
  assert.equal(requests.length, n, 'unknown env fails before provider')
  delete process.env.GOGO_BRAIN_MODEL
  assert.deepEqual(brain.shadowModels({ GOGO_BRAIN_SHADOW: 'claude-sonnet-4-5,claude-sonnet-4-5-20250929,claude-haiku-5-5' }), ['claude-haiku-5-5'])
  emitTool = false
  assert.equal((await brain.decide({ text: 'hello', ctx, client, meter: () => {} })).kind, 'skip', 'auto may decline to use a tool; no freeform action')
  emitTool = true
  stopReason = 'max_tokens'
  assert.equal((await brain.decide({ text: 'hello', ctx, client, meter: () => {} })).kind, 'skip')
  stopReason = 'refusal'
  assert.equal((await brain.decide({ text: 'hello', ctx, client, meter: () => {} })).kind, 'skip')
  stopReason = 'end_turn'
  // Execute the actual followup function with a fictional DB/context; never send a real message.
  const source = ts.createSourceFile('brain.ts', readFileSync('lib/agent/brain.ts', 'utf8'), ts.ScriptTarget.Latest, true)
  const followup = source.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === 'answerFollowups')!
  const compiled = ts.transpileModule(followup.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const fakeDb = { from: () => {
    const query: any = { select: () => query, eq: () => query, update: () => query,
      order: async () => ({ data: [{ id: 'fixture-step', input_json: { question: 'Which flight?' }, output_json: {} }] }),
      then: (resolve: any) => resolve({ error: null }), insert: async () => ({ error: null }) }
    return query
  } }
  const sandbox: any = { exports: {}, console: { log() {}, error() {} }, Date, process,
    supabaseAdmin: fakeDb, FOLLOWUP_TOOL: 'fixture', clean: (v: any, max = 400) => String(v ?? '').trim().slice(0, max),
    loadBrainContext: async () => ctx, MODEL: () => policy.SONNET_MODEL, modelOptions: policy.modelOptions,
    brainSystemBlocks: brain.brainSystemBlocks, BRAIN_TOOLS: brain.BRAIN_TOOLS, brainMessages: brain.brainMessages,
    brainUsage: brain.brainUsage, TIMEOUT_MS: 12000, inventedApprovalGuard: (s: string) => s }
  vm.runInNewContext(compiled, sandbox)
  for (const [name, input, stop, expected] of [
    ['reply', { text: 'Fixture answer' }, 'tool_use', 1],
    ['handle', { text: 'Unexpected answer' }, 'tool_use', 0],
    ['reply', { text: 123 }, 'tool_use', 0],
    ['reply', { text: 'Truncated answer' }, 'max_tokens', 0],
    ['reply', { text: 'Declined answer' }, 'refusal', 0],
    ['reply', { text: 'Freeform completion' }, 'end_turn', 0],
  ] as const) {
    const sent: string[] = []
    const count = await sandbox.exports.answerFollowups({ runId: 'fixture-run', telegramId: 42,
      meter: () => {}, send: async (s: string) => { sent.push(s) }, client: { messages: { create: async (request: any) => {
        assert.equal(request.tool_choice.type, 'auto')
        assert.equal(request.tools.length, 1); assert.equal(request.tools[0].name, 'reply')
        assert.equal(request.model, policy.SONNET_MODEL)
        return { stop_reason: stop, content: [{ type: 'tool_use', name, input }] }
      } } } })
    assert.equal(count, expected); assert.equal(sent.length, expected)
  }
  const claude = await import('../lib/services/claude.ts')
  assert.equal(await claude.askClaude('hello', [], [], 'Fixture'), 'answer')
  assert.equal(await claude.askClaudeFlightStatus('QF1 status?', 'fixture evidence', 'Fixture'), 'answer')
  assert.equal(await claude.askClaudeWithContext('What is it?', 'fixture evidence', 'Fixture'), 'answer')
  const pdf = await import('../lib/services/pdf-reader.ts')
  assert.equal(await pdf.readAndSummarizePdfDocument({ mediaUrl: 'https://fixture.invalid/media', accountSid: 'fixture', authToken: 'fixture' }), 'answer')
  reply = JSON.stringify({ type: 'event', title: 'Fixture', date: '2026-11-03' })
  assert.equal((await pdf.parseImageTicket('https://fixture.invalid/media', 'fixture', 'fixture') as any)?.title, 'Fixture')
  assert.equal((await pdf.parsePdfTicket('https://fixture.invalid/media', 'fixture', 'fixture') as any)?.title, 'Fixture')
  failStatus = 404
  assert.equal((await pdf.parseImageTicket('https://fixture.invalid/media', 'fixture', 'fixture') as any)?.title, 'Fixture')
  assert.equal(requests.at(-1).model, policy.DOCUMENT_FALLBACK_MODEL)
  failStatus = 400
  const before400 = requests.length
  await assert.rejects(() => pdf.parseImageTicket('https://fixture.invalid/media', 'fixture', 'fixture'))
  assert.equal(requests.length, before400 + 1, 'invalid request is not model-fallback retried')
  stopReason = 'refusal'
  const beforeRefusal = requests.length
  assert.equal(await pdf.parseImageTicket('https://fixture.invalid/media', 'fixture', 'fixture'), null)
  assert.equal(requests.length, beforeRefusal + 1, 'refusal never triggers fallback')
  stopReason = 'end_turn'
  reply = JSON.stringify({ assetType: 'generic_document', displayTitle: 'Fixture', fields: { title: 'Fixture' } })
  const assets = await import('../lib/services/asset-memory.ts')
  assert.equal((await assets.classifyAndExtractAsset({ mediaUrl: 'https://fixture.invalid/media', contentType: 'application/pdf', kind: 'pdf' }))?.displayTitle, 'Fixture')
  reply = '[]' // Empty script verifies generation without invoking audio/storage side effects.
  const voice = await import('../lib/services/voice-reply.ts')
  assert.deepEqual(await voice.createPodcast(42, 'fixture', 1), { script: [], url: null })
  reply = 'Fixture research [1]'
  const research = await import('../lib/agent/deep-research.ts')
  await research.runDeepResearch('Research fixture materials', { search: (async () => [{ title: 'Fixture', url: 'https://fixture.invalid/source', content: 'Fixture source' }]) as any })
  assert.equal(requests.at(-1).model, policy.SONNET_MODEL)
  assert.ok(requests.some(r => r.messages[0]?.content?.some?.((b: any) => b.type === 'document')), 'document contract exercised')
  console.log(`SONNET_RETIREMENT_OK requests=${requests.length}; intercepted SDK wire, brain consent/refusal, chat, PDFs, image fallback, assets, voice, research; syntheticOnly=true`)
} finally { globalThis.fetch = originalFetch }
