// Actual metering, persistence writer and authenticated route. All transport/database I/O is inert.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as core from '../lib/metering/core'
import { percentile, summarizeMeteredTasks, loadTaskMeasurements } from '../lib/metering/task-measurements'

const { currentMeterContext, runMeteredTask, runMeteredAs, rawUsageFromBody, priceMeasuredEvent, DEFAULT_RATES } = core
function load(path: string, mocks: Record<string, any>, extra: Record<string, any> = {}) {
  const exports: any = {}
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { if (!(name in mocks)) throw Error('Unexpected dependency ' + name); return mocks[name] },
      console, Date, process: { env: {} }, URL, Response, Request, ...extra })
  return exports
}
const checks: string[] = []
async function check(name: string, work: () => unknown | Promise<unknown>) { await work(); checks.push(name); console.log('PASS ' + name) }

await check('parallel task/owner contexts remain isolated through async work', async () => {
  const results = await Promise.all(['owner-a', 'owner-b'].map((owner, i) => runMeteredTask(owner, { runId: 'run-' + i, stepId: 'step-' + i, attempt: i + 1 }, async () => {
    await Promise.resolve()
    const before = currentMeterContext()
    await runMeteredAs(owner, async () => assert.equal(currentMeterContext()?.runId, 'run-' + i), 'web')
    await runMeteredAs('foreign', async () => assert.equal(currentMeterContext()?.runId, undefined))
    return before
  })))
  assert.deepEqual(results.map(r => r?.telegramId), ['owner-a', 'owner-b'])
  assert.deepEqual(results.map(r => r?.runId), ['run-0', 'run-1'])
  assert.equal(currentMeterContext(), null)
})
await check('raw provider cache counters preserve billing semantics', () => {
  const a = rawUsageFromBody({ usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 } })
  assert.equal(a.input, 100); assert.equal(a.cachedReadTokens, 200); assert.equal(a.cachedWriteTokens, 50); assert.equal(a.inputIncludesCached, false)
  const o = rawUsageFromBody({ usage: { prompt_tokens: 300, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 200 } } })
  assert.equal(o.input, 300); assert.equal(o.cachedReadTokens, 200); assert.equal(o.inputIncludesCached, true)
  assert.equal(rawUsageFromBody({}).input, null)
})
await check('unpriced or missing usage is unknown; explicit free service remains zero', () => {
  assert.equal(priceMeasuredEvent({ vendor: 'unknown', category: 'x' }, DEFAULT_RATES), null)
  assert.equal(priceMeasuredEvent({ vendor: 'anthropic', category: 'llm', model: 'haiku' }, DEFAULT_RATES), null)
  assert.equal(priceMeasuredEvent({ vendor: 'anthropic', category: 'llm', model: 'haiku', inputTokens: 100, outputTokens: 20, cachedReadTokens: 200 }, DEFAULT_RATES), null)
  assert.deepEqual(priceMeasuredEvent({ vendor: 'resend', category: 'email' }, DEFAULT_RATES), { inr: 0, usd: 0 })
  const rates = { ...DEFAULT_RATES, 'anthropic.haiku.cache_read': { usd: .1 }, 'anthropic.haiku.cache_write': { usd: 1.25 } }
  const price = priceMeasuredEvent({ vendor: 'anthropic', category: 'llm', model: 'haiku', inputTokens: 100, outputTokens: 20, cachedReadTokens: 200, cachedWriteTokens: 50 }, rates)
  assert.equal(price?.usd, .000283)
})
await check('writer binds trusted trace and marks unknown pricing without forging free cost', async () => {
  const rows: any[] = []
  const writer = load('lib/metering/record.ts', {
    '@/lib/supabase-admin': { supabaseAdmin: { from: (table: string) => table === 'admin_rate_card' ? { select: async () => ({ data: [], error: null }) } : { insert: async (row: any) => { rows.push(row); return { error: null } } } } },
    './core': core,
  })
  await runMeteredTask('owner-a', { runId: 'run-a', stepId: 's-a', attempt: 2 }, () => writer.recordMeterEvent({ vendor: 'unknown', category: 'x', metadata: { run_id: 'forged', step_id: 'forged' } }))
  assert.equal(rows[0].metadata.run_id, 'run-a'); assert.equal(rows[0].metadata.attempt, 2)
  assert.equal(rows[0].metadata.pricing_status, 'unavailable')
  await runMeteredTask('owner-a', { runId: 'private-run' }, () => writer.recordMeterEvent({ vendor: 'resend', category: 'email' }, 'owner-b'))
  assert.equal(rows[1].metadata.run_id, null); assert.equal(rows[1].telegram_id, 'owner-b')
})
const runs = [1, 2, 3, 4].map(n => ({ id: 'r' + n, telegram_id: 'owner', status: 'completed', started_at: '2026-10-01T00:00:00Z', completed_at: `2026-10-01T00:00:0${n}Z` }))
const events: any[] = [
  { id: 1, telegram_id: 'owner', vendor: 'openai', category: 'llm', model: 'fixture', input_tokens: 100, output_tokens: 10, cost_inr: '2.5', ok: true, metadata: { run_id: 'r1', pricing_status: 'estimated', cached_read_tokens: 60, latency_ms: 100 } },
  { id: 2, telegram_id: 'owner', vendor: 'openai', category: 'llm', model: 'fixture', input_tokens: null, output_tokens: null, cost_inr: 0, ok: false, metadata: { run_id: 'r2', pricing_status: 'unavailable', latency_ms: 300 } },
  { id: 3, telegram_id: 'foreign', vendor: 'secret', category: 'llm', cost_inr: 999, metadata: { run_id: 'r1', pricing_status: 'estimated' } },
]
await check('latency percentiles and cost coverage include failures and exclude missing/foreign observations', () => {
  const report = summarizeMeteredTasks('owner', runs, [...events, events[0]])
  assert.equal(report.attributedEvents, 2); assert.equal(report.pricedAttributedTasks, 1); assert.equal(report.unpricedTasks, 1); assert.equal(report.missingCompletedTasks, 2)
  assert.equal(report.meanAttributedCostInrPerPricedTask, 2.5)
  assert.equal(report.elapsedMs.p50, 2000); assert.equal(report.elapsedMs.p95, 4000)
  assert.equal(report.modelLatencyMs.p95, 300); assert.equal(report.failedAttempts, 1)
  assert.equal(report.cachedReadTokens.total, 60); assert.equal(report.cachedWriteTokens.total, null)
  assert.equal(report.observedCostCoverageComplete, false)
  assert.doesNotMatch(JSON.stringify(report), /foreign|secret|owner|r1/)
  assert.equal(summarizeMeteredTasks('owner', runs, events, true).meanAttributedCostInrPerPricedTask, null)
  assert.equal(summarizeMeteredTasks('owner', [], []).elapsedMs.p50, null)
  assert.equal(percentile([1, 2, 3, 4, NaN], .95), 4)
})
await check('bounded owner reads fail closed and flag truncation', async () => {
  const db = { from: (table: string) => {
    const q: any = { select: () => q, eq: (key: string, owner: string) => { assert.equal(key, 'telegram_id'); assert.equal(owner, 'owner'); return q }, gte: () => q, order: () => q, limit: (n: number) => { assert.ok(n === 101 || n === 5001); return Promise.resolve({ data: table === 'agent_runs' ? Array.from({ length: 101 }, () => runs[0]) : [], error: null }) } }; return q
  } }
  assert.equal((await loadTaskMeasurements('owner', db)).truncated, true)
  const broken = { from: () => { const q: any = { select: () => q, eq: () => q, gte: () => q, order: () => q, limit: async () => ({ data: null, error: { message: 'down' } }) }; return q } }
  await assert.rejects(loadTaskMeasurements('owner', broken), /unavailable/)
})
await check('authenticated metrics endpoint exposes aggregates only and no false zero on storage failure', async () => {
  let authed = false, fail = false, reads = 0
  const route = load('app/api/dashboard/agent/metrics/route.ts', {
    'next/server': { NextResponse: { json: (data: any, init: any = {}) => new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json', ...init.headers } }) } },
    '@/lib/agent/session': { requireAgentSession: async () => authed ? { telegramId: 'owner' } : new Response('unauthorized', { status: 401 }), isAgentSession: (s: any) => !(s instanceof Response) },
    '@/lib/supabase-admin': { supabaseAdmin: {} },
    '@/lib/metering/task-measurements': { loadTaskMeasurements: async (owner: string) => { reads++; assert.equal(owner, 'owner'); if (fail) throw Error('db down'); return { completedTasks: 2 } } },
  })
  assert.equal((await route.GET(new Request('https://fixture.invalid'))).status, 401); assert.equal(reads, 0)
  authed = true
  const response = await route.GET(new Request('https://fixture.invalid'))
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { measurements: { completedTasks: 2 } })
  fail = true; assert.equal((await route.GET(new Request('https://fixture.invalid'))).status, 503)
})
await check('fetch meter preserves response and error while recording actual usage/transport failures', async () => {
  const rows: any[] = [], pending: Promise<any>[] = []
  const response = new Response(JSON.stringify({ model: 'fixture', usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 80 } } }), { headers: { 'content-type': 'application/json' } })
  const originalError = new Error('timeout after request')
  let fails = false
  const g: any = { fetch: async () => { if (fails) throw originalError; return response } }
  const meter = load('lib/metering/fetch-meter.ts', {
    './core': core, './record': { keepAlive: (p: Promise<any>) => { pending.push(p); return p }, recordMeterEvent: async (row: any) => { rows.push(row) } },
  }, { globalThis: g })
  meter.installFetchMeter()
  assert.equal(await g.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' }), response)
  await Promise.all(pending)
  assert.equal(rows[0].inputTokens, 100); assert.equal(rows[0].cachedReadTokens, 80)
  assert.equal((await response.json()).model, 'fixture', 'caller can still read the original body')
  fails = true
  await assert.rejects(g.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' }), e => e === originalError)
  assert.equal(rows[1].ok, false); assert.equal(rows[1].metadata.outcome, 'transport_unknown')
})
console.log(`Task observability: ${checks.length} actual-module groups passed; no live provider acceptance inferred`)
