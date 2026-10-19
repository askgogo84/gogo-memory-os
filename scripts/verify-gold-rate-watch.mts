// Gold-rate watch (19 Oct live): "Alert me if gold rate drips by 10% from the current rate" got a one-off
// gold quote and no alert. Parser, routing order, creation from a verified baseline, honest refusal, and
// the background check (crossing alerts once, silence otherwise). Inert DB and transport throughout.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://gold-watch.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'

const rule = await import('../lib/agent/gold-rate-rule')
const goldQuotes = await import('../lib/bot/handlers/gold-quotes')
const costPolicy = await import('../lib/agent/watch-cost-policy')
const watcherQuality = await import('../lib/agent/watcher-quality')
const priceThreshold = await import('../lib/agent/price-threshold')
const { detectIntent } = await import('../lib/bot/detect-intent')

const failures: string[] = []
async function check(label: string, fn: () => unknown) {
  try { await fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(label + ': ' + (e?.stack || e?.message)) }
}

// ── 1. Parser ────────────────────────────────────────────────────────────────
await check('live typo "drips" parses as a 10% drop on 24K (defaulted)', () => {
  const p = rule.parseGoldRateWatchCommand('Alert me if gold rate drips by 10% from the current rate')
  assert.deepEqual(p, { metal: 'gold', karat: '24', karatDefaulted: true, direction: 'down', mode: 'percent', value: 10, unitGrams: null, place: null })
})
await check('drops / dips / falls / drps / dorps all read down', () => {
  for (const verb of ['drops', 'dips', 'falls', 'drps', 'dorps', 'falls by']) {
    const p = rule.parseGoldRateWatchCommand(`alert me if gold rate ${verb} 10%`)
    assert.equal(p?.direction, 'down', verb); assert.equal(p?.mode, 'percent'); assert.equal(p?.value, 10)
  }
})
await check('22K absolute per-gram threshold', () => {
  const p = rule.parseGoldRateWatchCommand('tell me when 22K gold goes below ₹13,000 per gram')
  assert.equal(p?.karat, '22'); assert.equal(p?.karatDefaulted, false); assert.equal(p?.direction, 'down')
  assert.equal(p?.mode, 'absolute'); assert.equal(p?.value, 13000); assert.equal(p?.unitGrams, 1)
})
await check('rise by 5% from today', () => {
  const p = rule.parseGoldRateWatchCommand('notify me if gold price rises by 5% from today')
  assert.equal(p?.direction, 'up'); assert.equal(p?.mode, 'percent'); assert.equal(p?.value, 5)
})
await check('place before the rule', () => {
  const p = rule.parseGoldRateWatchCommand('watch gold rate in Bangalore and alert me if it falls 3%')
  assert.equal(p?.place, 'Bangalore'); assert.equal(p?.value, 3); assert.equal(p?.direction, 'down')
})
await check('per 10 g lakh amount', () => {
  const p = rule.parseGoldRateWatchCommand('alert me if 22 carat gold goes under 1.3 lakh per 10 grams')
  assert.equal(p?.value, 130000); assert.equal(p?.unitGrams, 10); assert.equal(p?.karat, '22')
})
await check('silver parses as silver with no karat', () => {
  const p = rule.parseGoldRateWatchCommand('tell me if silver rate falls below ₹90 per gram')
  assert.equal(p?.metal, 'silver'); assert.equal(p?.karat, null)
})
await check('quote asks and non-alerts are not claimed', () => {
  for (const t of ['what is the gold rate today', 'what is the gold rate in Bangalore today?', 'gold rate', 'gold coin price on amazon',
    'alert me if gold coin price on amazon drops below 7000', 'Remind me to check gold rate at 9am', 'is gold rate going to drop?',
    'Alert me if the iPhone drops below 50000', 'tell me the gold rate every morning', 'Alert me when there is news about gold loans']) {
    assert.equal(rule.parseGoldRateWatchCommand(t), null, t)
  }
  for (const t of ['what is the gold rate today', 'gold coin price on amazon', 'tell me the gold rate every morning'])
    assert.equal(rule.isGoldRateAlertPhrasing(t), false, t)
})

// ── 2. Routing order ─────────────────────────────────────────────────────────
await check('detect-intent: alert phrasing is not answered by gold_live; quote asks still are', () => {
  for (const t of ['Alert me if gold rate drips by 10% from the current rate', 'notify me if gold price rises by 5% from today',
    'watch gold rate in Bangalore and alert me if it falls 3%', 'alert me if gold rate changes by 5%'])
    assert.notEqual(detectIntent(t).type, 'gold_live', t)
  for (const t of ['what is the gold rate today', 'gold rate in bangalore', 'silver price today'])
    assert.equal(detectIntent(t).type, 'gold_live', t)
})
await check('WhatsApp: deterministic watcher gate includes gold alerts; agent tries gold before goals/planners', () => {
  const route = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
  const gate = route.slice(route.indexOf('const isDeterministicWatcherCommand'), route.indexOf('if(isDeterministicWatcherCommand)'))
  assert.match(gate, /isGoldRateAlertPhrasing\(text\)/)
  assert.ok(route.indexOf('if(isDeterministicWatcherCommand)') < route.indexOf('processIncomingMessage({ channel: \'whatsapp\', externalUserId: from, text'))
  const bridge = readFileSync('lib/agent/whatsapp-bridge.ts', 'utf8')
  const agent = bridge.slice(bridge.indexOf('export async function tryRunWhatsAppAgent'))
  const gold = agent.indexOf('tryCreateGoldRateWatchFromCommand(')
  assert.ok(gold > 0 && gold < agent.indexOf('tryCreateGoal(') && gold < agent.indexOf('tryRunPriceWatchClarification(') && gold < agent.indexOf('tryCreateWebWatchFromCommand('))
  const jev = bridge.slice(bridge.indexOf("if(params.intent==='watcher'){"))
  assert.ok(jev.indexOf('tryCreateGoldRateWatchFromCommand(') < jev.indexOf('tryRunPriceWatchClarification('))
})
await check('dashboard chat and the shared processIncomingMessage path try gold before quote/search handlers', () => {
  const chat = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
  const post = chat.slice(chat.indexOf('export async function POST'))
  const gold = post.indexOf('tryCreateGoldRateWatchFromCommand(')
  assert.ok(gold > 0 && gold < post.indexOf('tryRunPriceWatchClarification(') && gold < post.indexOf('tryCreateWebWatchFromCommand(') && gold < post.indexOf('processIncomingMessage('))
  const pim = readFileSync('lib/bot/process-message.ts', 'utf8')
  const pgold = pim.indexOf('tryCreateGoldRateWatchFromCommand(')
  assert.ok(pgold > 0 && pgold < pim.indexOf('const detectedIntent=detectIntent(incomingText)') && pgold < pim.indexOf("intent.type === 'gold_live'"))
})

// ── Inert DB ────────────────────────────────────────────────────────────────
type Row = Record<string, any>
const tables: Record<string, Row[]> = {}
let nextId = 0
function reset() { for (const k of Object.keys(tables)) delete tables[k]; nextId = 0; delivered.length = 0; searches.length = 0 }
function colValue(row: Row, col: string) {
  if (col.includes('->>')) { const [a, b] = col.split('->>'); const v = row[a]?.[b]; return v === undefined || v === null ? null : String(v) }
  return row[col]
}
const db = {
  from(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let insert: Row[] | null = null, patch: Row | null = null, upsert: Row | null = null, count = false
    const list = () => (tables[table] ||= [])
    const matched = () => list().filter((r) => filters.every((f) => f(r)))
    const run = () => {
      if (insert) { const rows = insert.map((r) => ({ id: r.id || `${table}-${++nextId}`, created_at: new Date(Date.UTC(2026, 9, 19, 6, 0, nextId)).toISOString(), ...structuredClone(r) })); list().push(...rows); return { data: rows, error: null } }
      if (upsert) { if (!list().some((r) => r.id === upsert!.id)) list().push(structuredClone(upsert)); return { data: null, error: null } }
      if (patch) { const rows = matched(); rows.forEach((r) => Object.assign(r, structuredClone(patch))); return { data: rows, error: null } }
      if (count) return { count: matched().length, data: null, error: null }
      return { data: matched(), error: null }
    }
    const b: any = {
      select(_c?: string, opts?: any) { if (opts?.count) count = true; return b },
      eq(col: string, val: any) { filters.push((r) => col === 'condition_json' ? JSON.stringify(r.condition_json) === String(val) : String(colValue(r, col)) === String(val)); return b },
      in(col: string, vals: any[]) { filters.push((r) => vals.map(String).includes(String(colValue(r, col)))); return b },
      lte(col: string, val: any) { filters.push((r) => r[col] != null && String(r[col]) <= String(val)); return b },
      is(col: string, val: any) { filters.push((r) => r[col] === val || (val === null && r[col] == null)); return b },
      order() { return b }, limit() { return b },
      insert(row: Row | Row[]) { insert = Array.isArray(row) ? row : [row]; return b },
      update(row: Row) { patch = row; return b },
      upsert(row: Row) { upsert = row; return b },
      single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error } },
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error } },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    }
    return b
  },
}

const NOW = Date.parse('2026-10-19T06:00:00Z') // 11:30 IST
class FixedDate extends Date {
  constructor(...args: any[]) { super(...((args.length ? args : [NOW]) as [])) }
  static now() { return NOW }
}
let searchContext = ''
const searches: string[] = []
const delivered: Array<{ key: string; message: string }> = []
const budget = { planCode: 'pro', activeWebWatchersMax: 5, baseWatcherCadenceMinutes: 60, maxWatcherCadenceMinutes: 1440, burstHours: 0, burstWatcherCadenceMinutes: 15 }
const block = (url: string, line: string) => `1. Gold rate today\n${line}\nSource: ${url}`
const resultsFrom = (ctx: string) => ctx.split(/\n\s*\n/).filter(Boolean).map((b) => {
  const lines = b.split('\n'); return { title: lines[0].replace(/^\d+\.\s*/, ''), snippet: lines.slice(1, -1).join(' '), url: lines.at(-1)!.replace(/^Source:\s*/, '') }
})

function load(file: string, mocks: Record<string, any>) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: any = {}
  runInNewContext(code, {
    exports, module: { exports }, Date: FixedDate, URL, Buffer, console: { log() {}, error() {}, warn() {} }, structuredClone,
    require: (name: string) => { if (name in mocks) return mocks[name]; if (name === 'node:crypto') return crypto; return {} },
  })
  return exports
}
const costGuard = {
  getCostBudget: async () => budget,
  checkCostAllowance: async () => ({ allowed: true, state: { usageRatio: 0 } }),
  COST_ESTIMATES_PAISE: { web_search_basic: 100 },
  recordCostEvent: async () => {},
}
const watchers = load('lib/agent/watchers.ts', {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/web-search': { searchWebResults: async (q: string) => { searches.push(q); return resultsFrom(searchContext) } },
  '@/lib/services/cost-guard': costGuard,
  './watch-alert-delivery': {
    deliverWatchAlert: async (p: any) => {
      // The notification ledger is keyed: a repeated key is never sent twice.
      if (delivered.some((d) => d.key === p.key)) return { state: 'suppressed', accepted: false, providerId: null }
      delivered.push({ key: p.key, message: p.message }); return { state: 'provider_accepted', accepted: true, providerId: 'SM1' }
    },
  },
  './watch-cost-policy': costPolicy,
  './watcher-quality': watcherQuality,
  './price-threshold': priceThreshold,
  '@/lib/bot/handlers/gold-quotes': goldQuotes,
  './gold-rate-rule': rule,
})
const goldWatch = load('lib/agent/gold-watch.ts', {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/web-search': { searchWeb: async (q: string) => { searches.push(q); return searchContext } },
  '@/lib/services/cost-guard': costGuard,
  '@/lib/bot/handlers/gold-quotes': goldQuotes,
  './watchers': watchers,
  './watch-cost-policy': costPolicy,
  './gold-rate-rule': rule,
})
const actor = { userId: 'u1', legacyTelegramId: 42, whatsappId: '9199', name: 'Gogo' }
const create = (text: string) => goldWatch.tryCreateGoldRateWatchFromCommand({ actor, surface: 'whatsapp', text, now: NOW })
const today = (price: number, url = 'https://rates.example/blr') => block(url, `As of 19 October 2026: 24K gold per gram ₹${price}; 22K gold per gram ₹${Math.round(price * 0.916)}`)
function seedUser() { tables.users = [{ telegram_id: 42, whatsapp_id: '9199' }] }

// ── 3. Creation ─────────────────────────────────────────────────────────────
await check('creation: baseline + threshold persisted, read back, honest confirmation', async () => {
  reset(); seedUser(); searchContext = today(14000)
  const r = await create('Alert me if gold rate drips by 10% from the current rate')
  assert.equal(r?.status, 'completed', r?.text)
  const rows = tables.agent_watchers || []
  assert.equal(rows.length, 1)
  assert.equal(rows[0].type, 'web_search'); assert.equal(rows[0].telegram_id, '42'); assert.equal(rows[0].active, true)
  const g = rows[0].condition_json.goldRule
  assert.equal(g.baselinePerGram, 14000); assert.equal(g.thresholdPerGram, 12600); assert.equal(g.karat, '24')
  assert.equal(g.direction, 'down'); assert.equal(g.mode, 'percent'); assert.equal(g.value, 10)
  assert.equal(g.baselineDate, '2026-10-19'); assert.equal(g.baselineSource, 'https://rates.example/blr')
  assert.ok(rows[0].cadence_minutes >= 360, 'daily-changing price is not polled every 15 minutes')
  assert.match(searches[0], /gold rate per gram today in india 24 carat 22 carat/)
  assert.match(r.text, /Gold watch set: 24K in India, baseline ₹14,000\/g \(rates\.example, 2026-10-19\)/)
  assert.match(r.text, /falls below ₹12,600 \(10% drop\)/)
  assert.match(r.text, /Default karat 24K — say "22K" to change/)
  assert.match(r.text, /never buy or sell/)
  assert.equal(r.handledBy, 'gold-rate-watch')
})
await check('creation: the same rule again is reported, not duplicated', async () => {
  const r = await create('alert me if gold rate drops by 10%')
  assert.match(r?.runId || '', /^gold-watch-existing-/)
  assert.equal(tables.agent_watchers.length, 1)
})
await check('creation refused when sources differ by more than 1%', async () => {
  reset(); seedUser()
  searchContext = today(14000, 'https://a.example/r') + '\n\n' + today(14500, 'https://b.example/r')
  const r = await create('Alert me if gold rate drips by 10% from the current rate')
  assert.equal(r?.status, 'paused'); assert.equal(r?.runId, 'gold-watch-baseline-unverified')
  assert.match(r.text, /couldn't verify a current 24K per-gram rate to measure 10% from/)
  assert.match(r.text, /exact level/)
  assert.equal((tables.agent_watchers || []).length, 0)
})
await check('creation refused when the only quote is not dated today, or there is none', async () => {
  reset(); seedUser()
  searchContext = block('https://old.example/r', 'As of 17 October 2026: 24K gold per gram ₹14000')
  const stale = await create('alert me if gold rate drops 5%')
  assert.equal(stale?.runId, 'gold-watch-baseline-unverified')
  searchContext = ''
  const none = await create('alert me if gold rate drops 5%')
  assert.equal(none?.runId, 'gold-watch-baseline-unverified')
  assert.equal((tables.agent_watchers || []).length, 0)
})
await check('absolute threshold works without a verified baseline; silver is refused honestly', async () => {
  reset(); seedUser(); searchContext = ''
  const r = await create('tell me when 22K gold goes below ₹12,000 per gram')
  assert.equal(r?.status, 'completed', r?.text)
  const g = tables.agent_watchers[0].condition_json.goldRule
  assert.equal(g.thresholdPerGram, 12000); assert.equal(g.baselinePerGram, null); assert.equal(g.karat, '22')
  assert.doesNotMatch(r.text, /Default karat/)
  const s = await create('tell me if silver rate falls below ₹90 per gram')
  assert.equal(s?.runId, 'gold-watch-silver-unsupported')
  assert.equal(tables.agent_watchers.length, 1)
})
await check('plan gate: free plan cannot create a background watch', async () => {
  reset(); seedUser(); searchContext = today(14000)
  const before = budget.activeWebWatchersMax; budget.activeWebWatchersMax = 0
  try {
    const r = await create('alert me if gold rate drops by 10%')
    assert.equal(r?.runId, 'gold-watch-plan-blocked'); assert.equal((tables.agent_watchers || []).length, 0)
  } finally { budget.activeWebWatchersMax = before }
})
await check('non-alert messages return null (falls through to normal routing)', async () => {
  assert.equal(await create('what is the gold rate today'), null)
  const clarify = await create('alert me if gold rate changes by 5%')
  assert.equal(clarify?.runId, 'gold-watch-clarify')
})

// ── 4. Background poll ──────────────────────────────────────────────────────
async function poll(price: string) {
  searchContext = price
  for (const w of tables.agent_watchers) w.next_check_at = new Date(NOW - 1000).toISOString()
  return await watchers.processDueAgentWatchers()
}
await check('poll: non-crossing silent, crossing alerts once, repeat crossing deduped, ambiguous silent, re-arm', async () => {
  reset(); seedUser(); searchContext = today(14000)
  const r = await create('Alert me if gold rate drips by 10% from the current rate')
  assert.equal(r?.status, 'completed')
  const w = tables.agent_watchers[0]

  await poll(today(13000))
  assert.equal(delivered.length, 0, 'not crossed stays silent')
  assert.equal(w.last_state_json.lastGoldReason, 'not_crossed')
  assert.ok(w.condition_json.goldRule, 'gold rule survives the condition write-back')

  await poll(today(12500))
  assert.equal(delivered.length, 1, 'strict crossing alerts')
  assert.match(delivered[0].message, /24K is ₹12,500\/g \(rates\.example, as of 2026-10-19\), below your ₹12,600\/g threshold \(10% under the ₹14,000 baseline/)
  assert.match(delivered[0].message, /not financial advice/)
  assert.equal(w.last_state_json.goldArmed, false)
  assert.equal((tables.agent_ideas || []).length, 1)

  await poll(today(12400))
  assert.equal(delivered.length, 1, 'still below: no repeat alert')
  assert.equal(w.last_state_json.lastGoldReason, 'already_alerted')

  await poll(today(12000, 'https://a.example/r') + '\n\n' + today(12600 * 1.05, 'https://b.example/r'))
  assert.equal(delivered.length, 1, 'ambiguous sources stay silent')
  assert.equal(w.last_state_json.lastGoldReason, 'sources_differ')
  assert.equal(w.last_state_json.goldArmed, false, 'ambiguous evidence never re-arms')

  await poll(block('https://old.example/r', 'As of 17 October 2026: 24K gold per gram ₹12000'))
  assert.equal(delivered.length, 1, 'stale quote stays silent')
  assert.equal(w.last_state_json.lastGoldReason, 'not_current')

  await poll(today(12600))
  assert.equal(delivered.length, 1, 'equal to threshold is not a crossing')
  assert.equal(w.last_state_json.goldArmed, true, 'verified value back at/above threshold re-arms')

  await poll(today(12550))
  assert.equal(delivered.length, 2, 're-armed crossing alerts again')
  const runs = w.last_state_json.goldRuns
  assert.equal(runs.length, 7)
  assert.deepEqual(runs.map((x: any) => x.outcome), ['sent_nothing', 'alert', 'sent_nothing', 'unverified', 'unverified', 'sent_nothing', 'alert'])
  assert.ok(w.cadence_minutes >= 360)
})

if (failures.length) {
  console.error(failures.join('\n\n'))
  process.exit(1)
}
console.log('gold-rate watch: parser, routing order, verified-baseline creation, honest refusal and dedupe-safe polling pass')
