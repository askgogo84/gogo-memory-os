// Inert original-function regression; no real providers, messages, database or account access.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const full = readFileSync('lib/agent/brain.ts', 'utf8')
const start = full.indexOf('export async function answerFollowups(')
const end = full.indexOf('// ---------------------------------------------------------------- shadow models', start)
assert.ok(start >= 0 && end > start, 'original function boundary')
const js = ts.transpileModule(full.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

function harness(send: () => Promise<unknown>, failHistory = false) {
  const state = { answered: false, sends: 0, messages: [] as string[], updates: 0, historyWrites: 0, errors: [] as string[] }
  const step = { id: 'synthetic-step', input_json: { question: 'What did flight option one cost?' } }
  const db = {
    from(table: string) {
      if (table === 'agent_steps') {
        const q: any = {
          patch: null,
          select() { return q },
          update(value: any) { q.patch = value; return q },
          eq() { return q },
          order() { return Promise.resolve({ data: [{ ...step, output_json: { answered: state.answered } }], error: null }) },
          // A Supabase update query remains a thenable after its filters.
          then(resolve: any, reject: any) {
            state.updates++
            assert.equal(q.patch?.output_json?.answered, true)
            state.answered = true
            return Promise.resolve({ error: null }).then(resolve, reject)
          },
        }
        return q
      }
      if (table === 'conversations') return {
        insert(value: any) {
          state.historyWrites++
          assert.equal(value.telegram_id, 4500000001)
          assert.equal(value.role, 'assistant')
          if (failHistory) return Promise.resolve({ error: { message: 'synthetic persistence failure' } })
          state.messages.push(String(value.content))
          return Promise.resolve({ error: null })
        },
      }
      throw new Error('unexpected table in inert fixture: ' + table)
    },
  }
  const exported: Record<string, any> = {}
  runInNewContext(js, {
    exports: exported, module: { exports: exported },
    supabaseAdmin: db, FOLLOWUP_TOOL: 'brain_followup',
    clean: (v: any) => String(v ?? '').trim(),
    loadBrainContext: async () => ({ turns: [] }),
    MODEL: () => 'fixture-model', TIMEOUT_MS: 1000,
    brainSystemBlocks: () => [], brainMessages: () => [],
    brainUsage: () => ({}), meterBrainCall: () => {},
    inventedApprovalGuard: (v: any) => String(v ?? '').trim(),
    console: { log() {}, warn() {}, error(...args: any[]) { state.errors.push(args.map(String).join(' ')) } },
    process: { env: {} }, Date, Promise, JSON, Number, String,
  })
  assert.equal(typeof exported.answerFollowups, 'function')
  const run = () => exported.answerFollowups({
    runId: 'synthetic-run',
    telegramId: 4500000001,
    client: { messages: { create: async () => ({ content: [{ type: 'tool_use', input: { text: 'The first flight option costs 6000 rupees.' } }] }) } },
    meter: () => {},
    send: async (_text: string) => { state.sends++; return send() },
  })
  return { state, run }
}

// Provider SID is merely provider acceptance, not proof of eventual delivery.
// Missing outcomes must not create invented assistant turns.
for (const [label, receipt] of [
  ['null', null], ['undefined', undefined], ['empty', {}], ['false', false],
  ['blank_sid', { sid: '   ' }], ['malformed_sid', { sid: null }],
] as Array<[string, unknown]>) {
  const h = harness(async () => receipt)
  assert.equal(await h.run(), 0, label + ' must not count answered')
  assert.equal(h.state.messages.length, 0, label + ' must not persist a reply')
  assert.equal(h.state.answered, true, label + ' retains no-blind-retry marker')
  assert.equal(await h.run(), 0, label + ' remains non-retriable')
  assert.equal(h.state.sends, 1, label + ' sends only once | ' + h.state.errors.join(' | '))
}
console.log('PASS no provider acceptance never claims an answered follow-up or retries')

{
  const h = harness(async () => { throw new Error('synthetic transport uncertainty') })
  assert.equal(await h.run(), 0)
  assert.equal(h.state.messages.length, 0)
  assert.equal(h.state.answered, true)
  assert.equal(await h.run(), 0)
  assert.equal(h.state.sends, 1)
}
console.log('PASS provider exception preserves no-retry without false history')

{
  const h = harness(async () => ({ sid: 'SMsynthetic-accepted', status: 'queued' }))
  assert.equal(await h.run(), 1)
  assert.equal(h.state.messages.length, 1)
  assert.match(h.state.messages[0], /first flight option costs/)
  assert.equal(await h.run(), 0)
  assert.equal(h.state.sends, 1)
}
console.log('PASS accepted SID plus saved history counts once; not delivery proof')

{
  const h = harness(async () => ({ sid: 'SMsynthetic-accepted' }), true)
  assert.equal(await h.run(), 0)
  assert.equal(h.state.messages.length, 0)
  assert.equal(h.state.historyWrites, 1)
  assert.equal(h.state.answered, true)
  assert.equal(await h.run(), 0)
  assert.equal(h.state.sends, 1)
}
console.log('PASS history persistence failure is not reported as answered')
