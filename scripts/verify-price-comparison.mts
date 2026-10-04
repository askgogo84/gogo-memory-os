import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as model from '../lib/commerce/comparison-model'

// Reproduces 4 Oct: two retailers previously bypassed browser execution and a
// model invented M185 prices, sellers and free delivery. Fixtures are NOT live.
const request = 'Compare Logitech M185 wireless mouse, grey, quantity 1, on Amazon India and Flipkart. Verify price and seller. Do not buy or create a watch.'
assert.deepEqual(model.parsePriceComparison(request)?.providers, ['amazon', 'flipkart'])
assert.ok(model.parsePriceComparison('Compare Sony WH-1000XM5 black on Amazon India, Flipkart and Croma. Do not create a watch.'))
assert.deepEqual(model.parsePriceComparison('Compare grocery prices for Amul Taaza 1 litre x1 and atta 1kg on Instamart, Zepto and Blinkit.')?.providers, ['instamart', 'zepto', 'blinkit'])
assert.deepEqual(model.parsePriceComparison('Compare vegetarian burger delivery on Swiggy and Zomato')?.providers, ['swiggy', 'zomato'])
assert.equal(model.parsePriceComparison('Watch Sony prices on Amazon and Flipkart every hour and compare them'), null)
assert.equal(model.parsePriceComparison('Show my watches'), null)
assert.equal(model.parsePriceComparison('Find Sony WH-1000XM5 on Amazon'), null)
assert.equal(model.comparisonSource('amazon', 'https://amazon.in.evil.test/dp/B123'), null)
assert.equal(model.comparisonSource('amazon', 'https://user:secret@amazon.in/dp/B123'), null)
assert.equal(model.comparisonSource('amazon', 'javascript:alert(1)'), null)
assert.equal(model.comparisonSource('amazon', 'https://www.amazon.in/'), null)
assert.equal(model.comparisonSource('amazon', 'https://www.amazon.in/dp/B123?token=secret'), null)

const tables: Record<string, any[]> = {agent_runs: [], agent_steps: [], conversations: []}
let seq = 0, locked = false, calls = 0, failStart = false, auth = true, owner = '42'
const id = () => '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0')
const value = (row: any, key: string) => key.includes('->>') ? row[key.split('->>')[0]]?.[key.split('->>')[1]] : row[key]
const db = {from(table: string) {
  let patch: any, insert: any, count = Infinity, sort: any
  const filters: any[] = []
  const execute = (single = false) => {
    if (insert) {
      const rows = (Array.isArray(insert) ? insert : [insert]).map(p => ({id: id(), ...structuredClone(p)}))
      tables[table].push(...rows)
      return {data: single ? structuredClone(rows[0]) : structuredClone(rows), error: null}
    }
    let rows = tables[table].filter(r => filters.every(f => f(r)))
    if (sort) rows.sort((a, b) => String(b[sort]).localeCompare(String(a[sort])))
    rows = rows.slice(0, count)
    if (patch) rows.forEach(r => Object.assign(r, structuredClone(patch)))
    return {data: structuredClone(single ? rows[0] || null : rows), error: null}
  }
  const q: any = {select: () => q, insert(p: any) {insert = p; return q}, update(p: any) {patch = p; return q},
    eq(k: string, v: any) {filters.push((r: any) => value(r, k) === v); return q},
    in(k: string, v: any[]) {filters.push((r: any) => v.includes(value(r, k))); return q},
    is(k: string, v: any) {filters.push((r: any) => (value(r, k) ?? null) === v); return q},
    order(k: string) {sort = k; return q}, limit(n: number) {count = n; return q},
    maybeSingle: async () => execute(true), single: async () => execute(true),
    then(resolve: any, reject: any) {return Promise.resolve(execute()).then(resolve, reject)}}
  return q
}}
const lease = {acquireBrainUserLease: async () => locked ? null : {ownerToken: 'fixture'}, releaseBrainUserLease: async () => true}
const actor = {userId: 'fixture-owner', legacyTelegramId: 42, whatsappId: 'fixture', name: 'Fixture'}
const browser = {
  async prepareLinkedBrowserRead(p: any) {
    if (failStart) throw new Error('fixture_start_failed')
    assert.equal(p.parentKind, 'comparison'); assert.match(p.objective, /Do not add, remove or change cart/)
    const childId = id()
    tables.agent_runs.push({id: childId, telegram_id: '42', type: 'secure_browser', status: 'paused', metadata_json: {comparison_parent_id: p.parentRunId, mode: 'read', url: p.url}})
    return childId
  },
  async resumePausedBrowserRun(p: any) {
    calls++
    const child = tables.agent_runs.find(r => r.id === p.runId)
    await service.assertComparisonChild('42', child.metadata_json.comparison_parent_id, p.runId)
    const good = child.metadata_json.url.includes('flipkart')
    Object.assign(child, {status: good ? 'completed' : 'paused', error: good ? null : 'provider_access_limited', updated_at: new Date().toISOString()})
    tables.agent_steps.push({id: id(), run_id: child.id, telegram_id: '42', tool_name: 'secure_browser', status: good ? 'completed' : 'failed',
      output_json: {summary: good ? 'Logitech M185 grey. ₹926. Seller IT STORE INDIA.' : 'Stale unsupported ₹1299 free shipping', sourceUrl: good ? 'https://www.flipkart.com/fixture-m185/p/fixture' : 'https://www.amazon.in/dp/fixture'}})
  },
}
function load(file: string, deps: Record<string, any>) {
  const exports: any = {}
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {exports, process, Date, URL, console, require(name: string) {if (name in deps) return deps[name]; throw Error(name)}})
  return exports
}
const service = load('lib/commerce/price-comparison.ts', {'@/lib/supabase-admin': {supabaseAdmin: db}, '@/lib/agent/brain-runtime-guard': lease,
  './providers': {commerceOrigin: () => 'https://app.askgogo.in'}, './comparison-model': model, '@/lib/agent/browser-command': browser,
  '@/lib/web-search': {searchWebResults: async () => [{url: 'https://evil.test/p/fake', snippet: '₹1 free delivery'}]}})
const start = await service.tryPriceComparison({telegramId: 42, text: request, surface: 'web'})
assert.equal(start.status, 'queued'); assert.match(start.text, /Saved comparison:/)
assert.doesNotMatch(start.text, /₹|free delivery|in stock/i)
const repeat = await service.tryPriceComparison({telegramId: 42, text: request, surface: 'whatsapp'})
assert.equal(start.runId, repeat.runId, 'same request must retain the same in-flight task across channels')
assert.equal(await service.readPriceComparison('43', start.runId), null, 'another owner cannot read this report')
await assert.rejects(() => service.assertComparisonChild('43', start.runId, 'unknown'), /comparison_parent_unavailable/)
locked = true
await service.advancePriceComparison(actor, start.runId)
assert.equal(calls, 0); locked = false
let partial = await service.advancePriceComparison(actor, start.runId)
assert.equal(partial.metadata_json.providers[0].status, 'blocked')
assert.equal(partial.metadata_json.providers[0].evidence, undefined)
assert.equal(calls, 1)
// New module instance simulates loss of all worker-local state between providers.
const restarted = load('lib/commerce/price-comparison.ts', {'@/lib/supabase-admin': {supabaseAdmin: db}, '@/lib/agent/brain-runtime-guard': lease,
  './providers': {commerceOrigin: () => 'https://app.askgogo.in'}, './comparison-model': model, '@/lib/agent/browser-command': browser,
  '@/lib/web-search': {searchWebResults: async () => [{url: 'https://www.flipkart.com/fixture-m185/p/fixture', snippet: '₹1 free delivery'}]}})
partial = await restarted.advancePriceComparison(actor, start.runId)
assert.equal(partial.metadata_json.providers[1].status, 'observed')
assert.match(partial.metadata_json.providers[1].evidence, /₹926/)
assert.equal(partial.metadata_json.providers[0].status, 'blocked')
await restarted.advancePriceComparison(actor, start.runId)
assert.equal(calls, 2, 'unchanged blocked providers must not be retried')
assert.match(model.comparisonSummary(partial), /not being retried/)
assert.doesNotMatch(JSON.stringify(partial), /1299|free shipping/)

const route = load('app/api/comparisons/[id]/route.ts', {'next/server': {NextResponse: {json: (body: any, opts: any) => ({body, status: opts?.status || 200})}},
  '@/lib/agent/session': {requireAgentSession: async () => auth ? {telegramId: owner} : {status: 401}, isAgentSession: (s: any) => !!s.telegramId},
  '@/lib/commerce/price-comparison': service})
const get = () => route.GET({}, {params: Promise.resolve({id: start.runId})})
assert.equal((await get()).status, 200)
auth = false; assert.equal((await get()).status, 401); auth = true
owner = '43'; assert.equal((await get()).status, 404); owner = '42'
// Spoofing a linked child owned by another user cannot leak its evidence.
const child = tables.agent_runs.find(r => r.id === partial.metadata_json.providers[1].runId)
child.telegram_id = '43'
assert.equal((await get()).body.providers[1].evidence, undefined)
child.telegram_id = '42'

const interrupted = await service.tryPriceComparison({telegramId: 42, text: request.replace('Logitech M185', 'Sony WH-1000XM5')})
const interruptedRow = tables.agent_runs.find(r => r.id === interrupted.runId)
interruptedRow.metadata_json.providers[0] = {provider: 'amazon', status: 'checking', runId: id(), startedAt: '2020-01-01T00:00:00Z'}
tables.agent_runs.push({id: interruptedRow.metadata_json.providers[0].runId, type: 'secure_browser', telegram_id: '42', status: 'running', metadata_json: {comparison_parent_id: interrupted.runId, mode: 'read', url: model.COMPARISON_PROVIDERS.amazon.url}})
assert.equal((await service.readPriceComparison('42', interrupted.runId)).metadata_json.providers[0].status, 'failed')
failStart = true
await service.advancePriceComparison(actor, interrupted.runId)
assert.equal(tables.agent_runs.find(r => r.id === interrupted.runId).status, 'paused', 'start failure is bounded, not endlessly requeued')

for (const path of ['app/api/dashboard/chat/route.ts', 'app/api/webhooks/whatsapp/route.ts', 'app/api/agent/run/route.ts', 'lib/bot/process-message.ts']) {
  const source = readFileSync(path, 'utf8')
  assert.ok(source.indexOf('await tryPriceComparison') < source.indexOf('await tryFoodComparison'), `${path} must route comparisons before legacy fallback`)
}
const workerSource = readFileSync('app/api/cron/price-comparisons/route.ts', 'utf8')
let notifications = 0
const terminalTask = structuredClone(partial)
terminalTask.source = 'whatsapp'
const finishedParent = tables.agent_runs.find(r => r.id === terminalTask.id)
finishedParent.status = 'queued'
const worker = load('app/api/cron/price-comparisons/route.ts', {
  'next/server': {NextResponse: {json: (body: any, opts: any) => ({body, status: opts?.status || 200})}},
  '@/lib/supabase-admin': {supabaseAdmin: db}, '@/lib/agent/actor': {resolveAgentActor: async () => actor},
  '@/lib/commerce/price-comparison': {comparisonLink: service.comparisonLink, advancePriceComparison: async () => terminalTask},
  '@/lib/commerce/comparison-model': model, '@/lib/whatsapp': {sendWhatsApp: async () => {notifications++}},
})
process.env.CRON_SECRET = 'fixture-cron'
assert.equal((await worker.GET({headers: new Headers()})).status, 401)
assert.equal(notifications, 0)
const workerRequest = {headers: new Headers({authorization: 'Bearer fixture-cron'})}
assert.equal((await worker.GET(workerRequest)).status, 200)
assert.equal(notifications, 1)
assert.match(tables.conversations.at(-1).content, /Saved comparison:/)
assert.equal((await worker.GET(workerRequest)).status, 200)
assert.equal(notifications, 1, 'overlapping cron delivery cannot duplicate the terminal message')
assert.ok(JSON.parse(readFileSync('vercel.json', 'utf8')).crons.some((cron: any) => cron.path === '/api/cron/price-comparisons'))
console.log('Price comparison handler, persisted restart, evidence isolation, partial results, bounded failures and private report API fixtures passed.')
