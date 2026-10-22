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
const watchDedupe = await import('../lib/agent/watch-dedupe')
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

// ── 1b. Review regressions (19 Oct independent review) ──────────────────────
await check('"by <amount>" is a change from the baseline, never a level', () => {
  const up = rule.parseGoldRateWatchCommand('notify me if gold rate goes up by ₹1000')
  assert.equal(up?.mode, 'change'); assert.equal(up?.direction, 'up'); assert.equal(up?.value, 1000); assert.equal(up?.unitGrams, null)
  const down = rule.parseGoldRateWatchCommand('alert me if 22K gold drops by 500 rupees')
  assert.equal(down?.mode, 'change'); assert.equal(down?.direction, 'down'); assert.equal(down?.value, 500); assert.equal(down?.karat, '22')
  const per10 = rule.parseGoldRateWatchCommand('alert me if gold drops by Rs 2000 per 10g')
  assert.equal(per10?.mode, 'change'); assert.equal(per10?.unitGrams, 10)
  const bare = rule.parseGoldRateWatchCommand('alert me if gold falls 800 rupees')
  assert.equal(bare?.mode, 'change')
  // Levels stay levels.
  assert.equal(rule.parseGoldRateWatchCommand('alert me if gold rate goes above 13000')?.mode, 'absolute')
  assert.equal(rule.parseGoldRateWatchCommand('keep an eye on gold rate and message me if it dips under 12,500')?.mode, 'absolute')
  assert.equal(rule.parseGoldRateWatchCommand('alert me if gold crosses 1.5 lakh')?.mode, 'absolute')
  assert.equal(rule.parseGoldRateWatchCommand('alert me if gold drops to ₹12,000 per gram')?.mode, 'absolute')
})
await check('"below 2025 levels" is flagged year-like (never a ₹2,025/g level)', () => {
  const p = rule.parseGoldRateWatchCommand('alert me if gold drops below 2025 levels')
  assert.equal(p?.yearLike, true)
  assert.equal(rule.parseGoldRateWatchCommand('alert me if gold rate goes above 13000')?.yearLike, undefined)
  assert.equal(rule.parseGoldRateWatchCommand('alert me if gold goes below ₹2050 per gram')?.yearLike, undefined)
})
const STATUS_QUESTIONS = [
  'Can you tell me if gold rate increased today?',
  'Let me know if gold price has dropped this week',
  'tell me if the gold price fell today in Bangalore',
  'Should I buy gold now? let me know if it is cheaper than last week',
  'I sold my gold when price dropped, tell me if I did right',
  'watch out, gold rate dropped 2% today, tell me if I should buy',
  'tell me if gold rate went up yesterday',
  'let me know if the gold rate is higher than yesterday',
]
await check('past-tense / status / advice questions are not claimed as gold watches', () => {
  for (const t of STATUS_QUESTIONS) {
    assert.equal(rule.isGoldRateAlertPhrasing(t), false, t)
    assert.equal(rule.parseGoldRateWatchCommand(t), null, t)
  }
})
await check('rate questions naming the gold rate/price keep detect-intent gold_live', () => {
  for (const t of ['Can you tell me if gold rate increased today?', 'Let me know if gold price has dropped this week',
    'tell me if the gold price fell today in Bangalore', 'watch out, gold rate dropped 2% today, tell me if I should buy',
    'tell me if gold rate went up yesterday'])
    assert.equal(detectIntent(t).type, 'gold_live', t)
})
await check('future/conditional rules are still claimed', () => {
  for (const t of ['alert me once gold has dropped 5%', 'tell me when 22K gold goes below ₹13,000 per gram', 'notify me if gold price rises by 5% from today',
    'alert me if gold drops 5% in next week', 'let me know as soon as gold rate falls below 12000'])
    assert.ok(rule.parseGoldRateWatchCommand(t), t)
})
await check('stop / change / negation never parse as a new gold watch', () => {
  for (const t of ['Stop the gold watch that alerts me if it drops 10%', "Don't alert me if gold drops 5%", 'do not notify me if gold rate falls 3%',
    'cancel my gold watch, the one to alert me if gold drops 10%', 'change my gold watch: alert me if it drops 5%',
    'update my gold watch to alert me if it drops 5%', 'no longer tell me if gold drops 5%', 'never alert me if gold rate falls 2%',
    'pause the gold watch that alerts me if gold drops 5%', 'delete my gold alert for when gold drops 5%', 'edit the gold alert: tell me if it falls 4%']) {
    assert.equal(rule.parseGoldRateWatchCommand(t), null, t)
    assert.equal(rule.isGoldRateAlertPhrasing(t), false, t)
  }
  assert.equal(rule.isGoldWatchEditCommand('change my gold watch: alert me if it drops 5%'), true)
  assert.equal(rule.isGoldWatchEditCommand('update my gold watch to alert me if it drops 5%'), true)
  assert.equal(rule.isGoldWatchEditCommand('Stop the gold watch that alerts me if it drops 10%'), false)
  assert.equal(rule.isGoldWatchEditCommand('alert me if gold rate changes by 5%'), false)
  assert.equal(rule.isGoldWatchEditCommand('alert me if gold rate drops by 10%'), false)
})
await check('time phrases are never places; instruments are not the metal rate', () => {
  assert.equal(rule.parseGoldRateWatchCommand('alert me if gold drops 5% in next week')?.place, null)
  for (const t of ['alert me if gold drops 5% in the next month', 'alert me if gold falls 3% in coming days', 'alert me if gold drops 5% in this week',
    'tell me if gold rate falls 2% in tomorrow morning'])
    assert.equal(rule.parseGoldRateWatchCommand(t)?.place ?? null, null, t)
  assert.equal(rule.parseGoldRateWatchCommand('watch gold rate in Bangalore and alert me if it falls 3%')?.place, 'Bangalore')
  // 19 Oct live: "Alert me when 22K gold in Bangalore drops 10%" saved the place as "Bangalore Drops".
  for (const t of ['Alert me when 22K gold in Bangalore drops 10%', 'alert me when gold in Mumbai falls by 5%', 'tell me when 24K gold in Chennai rises 3%', 'alert me if gold in Bangalore is below 12000', 'alert me when gold in New Delhi drops 10%'])
    assert.equal(rule.parseGoldRateWatchCommand(t)?.place, t.match(/in ((?:New )?[A-Z]\w+)/)![1], t)
  for (const t of ['track my gold sip and tell me if it falls 5%', 'alert me if digital gold drops 5%', 'alert me if my gold ETF drops 5%',
    'alert me if SGB price drops 5%', 'tell me if gold bond falls 3%', 'alert me if gold jewellery price drops 5%', 'alert me if my gold sips fall 5%',
    'alert me if sovereign gold falls 2%']) {
    assert.equal(rule.parseGoldRateWatchCommand(t), null, t)
    assert.equal(rule.isGoldRateAlertPhrasing(t), false, t)
  }
})
await check('a stated base price is read ("drops by 10% from 1,30,000")', () => {
  const p = rule.parseGoldRateWatchCommand('alert me if gold rate drops by 10% from 1,30,000')
  assert.equal(p?.mode, 'percent'); assert.equal(p?.value, 10); assert.equal(p?.baseValue, 130000); assert.equal(p?.baseUnitGrams, null)
  const g = rule.parseGoldRateWatchCommand('alert me if gold rises by ₹500 from ₹13,000 per gram')
  assert.equal(g?.mode, 'change'); assert.equal(g?.value, 500); assert.equal(g?.baseValue, 13000); assert.equal(g?.baseUnitGrams, 1)
  assert.equal(rule.parseGoldRateWatchCommand('notify me if gold price rises by 5% from today')?.baseValue, undefined)
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
  // A gold-watch edit reaches the agent's gold handler (no second watch), and stop phrasing reaches the stop handler.
  assert.match(gate, /isGoldWatchEditCommand\(text\)/)
  assert.match(gate, /\^\(\?:stop\|cancel\|remove\|disable\)/)
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
  assert.match(pim, /isGoldRateAlertPhrasing\(incomingText\)\|\|g\.isGoldWatchEditCommand\(incomingText\)/)
  const pgold = pim.indexOf('tryCreateGoldRateWatchFromCommand(')
  assert.ok(pgold > 0 && pgold < pim.indexOf('const detectedIntent=detectIntent(incomingText)') && pgold < pim.indexOf("intent.type === 'gold_live'"))
})

// ── Inert DB ────────────────────────────────────────────────────────────────
type Row = Record<string, any>
const tables: Record<string, Row[]> = {}
let nextId = 0
function reset() { for (const k of Object.keys(tables)) delete tables[k]; nextId = 0; delivered.length = 0; searches.length = 0; attempts.length = 0; deliveryMode = 'ok' }
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
      order() { return b }, limit() { return b }, contains() { return b }, range() { return b },
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
// 'ok' = provider accepts; 'unknown' = the send started but its outcome is unknown (ledger keeps the key).
let deliveryMode: 'ok' | 'unknown' = 'ok'
const attempts: string[] = []
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
      attempts.push(p.key)
      if (deliveryMode === 'unknown') return { state: 'outcome_unknown', accepted: false, providerId: null }
      // The notification ledger is keyed: a repeated key is never sent twice.
      if (delivered.some((d) => d.key === p.key)) return { state: 'suppressed', accepted: false, providerId: null }
      delivered.push({ key: p.key, message: p.message }); return { state: 'provider_accepted', accepted: true, providerId: 'SM1' }
    },
  },
  './watch-cost-policy': costPolicy,
  './watcher-quality': watcherQuality,
  './price-threshold': priceThreshold,
  './watch-dedupe': watchDedupe,
  '@/lib/bot/handlers/gold-quotes': goldQuotes,
  './gold-rate-rule': rule,
})
const goldWatch = load('lib/agent/gold-watch.ts', {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/web-search': { searchWeb: async (q: string) => { searches.push(q); return searchContext } },
  '@/lib/services/cost-guard': costGuard,
  '@/lib/bot/handlers/gold-quotes': goldQuotes,
  './watchers': watchers,
  './watch-dedupe': watchDedupe,
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
  assert.match(r.text, /Gold alert set: 24K in India, starting ₹14,000\/g \(rates\.example, 2026-10-19\)/)
  assert.match(r.text, /alert you at ₹12,600\/g or below \(10% drop\)/)
  assert.ok(r.text.length < 330, 'short confirmation: ' + r.text.length)
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

// ── 3b. Creation regressions (19 Oct review) ────────────────────────────────
const watchCommand = load('lib/agent/watch-command.ts', {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  './typed-object-context': { latestTypedContext: async () => null, selectedTypedObject: () => null, rememberTypedObjects: async () => {} },
  './price-threshold': priceThreshold,
  '@/lib/services/cost-guard': costGuard,
  '@/lib/bot/handlers/followup-state': { getLatestFollowupState: async () => null, isStrictlyFreshFollowupState: () => false, saveFollowupState: async () => {}, clearFollowupState: async () => {} },
  './watchers': watchers,
  './watch-cost-policy': costPolicy,
})
const goldRows = () => (tables.agent_watchers || []).filter((w) => w.active && w.condition_json?.goldRule)
await check('"goes up by ₹1000" = baseline + ₹1,000/g; never "already past"', async () => {
  reset(); seedUser(); searchContext = today(14000)
  const r = await create('notify me if gold rate goes up by ₹1000')
  assert.equal(r?.status, 'completed', r?.text)
  const g = goldRows()[0].condition_json.goldRule
  assert.equal(g.mode, 'change'); assert.equal(g.direction, 'up'); assert.equal(g.value, 1000); assert.equal(g.baselinePerGram, 14000); assert.equal(g.thresholdPerGram, 15000)
  assert.match(r.text, /alert you at ₹15,000\/g or above \(₹1,000\/g rise\)/)
  assert.match(r.text, /I read ₹1,000 as a change per gram/)
  assert.doesNotMatch(r.text, /already past/)
  assert.match(goldRows()[0].condition_json.title, /24K gold rises above ₹15,000\/g \(₹1,000\/g rise from ₹14,000\)/)
})
await check('"22K drops by 500 rupees" = 22K baseline − ₹500/g; "by Rs 2000 per 10g" = −₹200/g', async () => {
  reset(); seedUser(); searchContext = today(14000)
  const r = await create('alert me if 22K gold drops by 500 rupees')
  assert.equal(r?.status, 'completed', r?.text)
  const g = goldRows()[0].condition_json.goldRule
  assert.equal(g.karat, '22'); assert.equal(g.baselinePerGram, 12824); assert.equal(g.thresholdPerGram, 12324); assert.equal(g.mode, 'change')
  const r2 = await create('alert me if gold drops by Rs 2000 per 10g')
  assert.equal(r2?.status, 'completed', r2?.text)
  const g2 = goldRows().find((w) => w.condition_json.goldRule.karat === '24').condition_json.goldRule
  assert.equal(g2.value, 200); assert.equal(g2.thresholdPerGram, 13800)
  // A large unitless change is read per 10 g, and said so.
  const r3 = await create('alert me if gold rises by ₹5000')
  assert.equal(r3?.status, 'completed', r3?.text)
  assert.match(r3.text, /I read ₹5,000 as a change per 10 g/)
  assert.match(r3.text, /₹14,500\/g or above/)
})
await check('a change with no verified baseline is refused, no watch', async () => {
  reset(); seedUser(); searchContext = ''
  const r = await create('notify me if gold rate goes up by ₹1000')
  assert.equal(r?.runId, 'gold-watch-baseline-unverified'); assert.match(r.text, /won't guess a starting price/)
  assert.equal((tables.agent_watchers || []).length, 0)
})
await check('implausible or year-like levels ask to confirm and create nothing', async () => {
  for (const ctx of [today(14000), '']) {
    reset(); seedUser(); searchContext = ctx
    const year = await create('alert me if gold drops below 2025 levels')
    assert.equal(year?.runId, 'gold-watch-confirm-level', year?.text); assert.match(year.text, /looks like a year/)
    const low = await create('tell me when gold goes below ₹900 per gram')
    assert.equal(low?.runId, 'gold-watch-confirm-level', low?.text)
    assert.equal((tables.agent_watchers || []).length, 0)
  }
  reset(); seedUser(); searchContext = today(14000)
  for (const t of ['alert me if gold rate goes above 5000', 'alert me if gold rate goes above ₹40,000 per gram', 'alert me if gold goes below ₹2000 per 10g']) {
    const r = await create(t)
    assert.equal(r?.runId, 'gold-watch-confirm-level', t + ' -> ' + r?.text)
    assert.match(r.text, /far from today's verified 24K rate of ₹14,000\/g/)
  }
  // A change as big as half the rate is confirmed, not set.
  const big = await create('alert me if gold drops by ₹7500 per gram')
  assert.equal(big?.runId, 'gold-watch-confirm-level')
  assert.equal((tables.agent_watchers || []).length, 0)
  // Plausible levels still work (per gram and per 10 g).
  const ok = await create('alert me if gold crosses 1.5 lakh')
  assert.equal(ok?.status, 'completed', ok?.text)
  assert.equal(goldRows()[0].condition_json.goldRule.thresholdPerGram, 15000)
})
await check('a stated base price is the baseline, said so ("drops by 10% from 1,30,000")', async () => {
  reset(); seedUser(); searchContext = today(14000)
  const r = await create('alert me if gold rate drops by 10% from 1,30,000')
  assert.equal(r?.status, 'completed', r?.text)
  const g = goldRows()[0].condition_json.goldRule
  assert.equal(g.baselinePerGram, 13000); assert.equal(g.thresholdPerGram, 11700); assert.equal(g.baselineSource, rule.GOLD_STATED_BASELINE)
  assert.match(r.text, /starting ₹13,000\/g \(the price you gave\)/)
  assert.match(r.text, /measuring from the ₹1,30,000 you gave \(read as per 10 g, ₹13,000\/g\), not today's rate/)
  // No verified rate is needed when the person gave the base.
  reset(); seedUser(); searchContext = ''
  const r2 = await create('alert me if gold rate drops by 10% from 1,30,000')
  assert.equal(r2?.status, 'completed', r2?.text)
  assert.equal(goldRows()[0].condition_json.goldRule.thresholdPerGram, 11700)
})
await check('"in next week" is not a place', async () => {
  reset(); seedUser(); searchContext = today(14000)
  const r = await create('alert me if gold drops 5% in next week')
  assert.equal(r?.status, 'completed', r?.text)
  assert.equal(goldRows()[0].condition_json.goldRule.place, null)
  assert.match(r.text, /24K in India/)
  assert.doesNotMatch(r.text, /Next Week/)
})
await check('status questions and instruments fall through (null), no clarify, no watch', async () => {
  reset(); seedUser(); searchContext = today(14000)
  for (const t of [...STATUS_QUESTIONS, 'track my gold sip and tell me if it falls 5%', "Don't alert me if gold drops 5%", 'do not notify me if gold rate falls 3%'])
    assert.equal(await create(t), null, t)
  assert.equal((tables.agent_watchers || []).length, 0)
})
await check('stop by name stops the gold watch; change never adds a second watch', async () => {
  reset(); seedUser(); searchContext = today(14000)
  const first = await create('alert me if gold rate drops by 10%')
  assert.equal(first?.status, 'completed')
  const change = await create('change my gold watch: alert me if it drops 5%')
  assert.equal(change?.runId, 'gold-watch-edit-unsupported'); assert.match(change.text, /haven't changed anything or added a new watch/)
  const update = await create('update my gold watch to alert me if it drops 5%')
  assert.equal(update?.runId, 'gold-watch-edit-unsupported')
  assert.equal(goldRows().length, 1)
  // The generic update handler never rewrites a gold watch's query.
  const generic = await watchCommand.tryUpdateWebWatchFromCommand({ actor, text: 'update my gold watch to alert me if it drops 5%' })
  assert.equal(generic?.runId, 'watcher-update-clarify')
  assert.equal(goldRows()[0].condition_json.goldRule.value, 10)

  const stopText = 'Stop the gold watch that alerts me if it drops 10%'
  assert.equal(await create(stopText), null, 'gold creation leaves stop to the stop handler')
  assert.equal(watchCommand.parsePriceWatchCommand(stopText), null, 'price clarifier does not claim it')
  assert.equal(await watchCommand.tryUpdateWebWatchFromCommand({ actor, text: stopText }), null)
  const stop = await watchCommand.tryStopWatcherFromCommand({ actor, text: stopText })
  assert.equal(stop?.status, 'completed', stop?.text)
  assert.match(stop.text, /Stopped Gold rate: 24K gold falls below ₹12,600/)
  assert.equal(goldRows().length, 0)

  await create('alert me if gold rate drops by 10%')
  assert.equal(goldRows().length, 1)
  const stop2 = await watchCommand.tryStopWatcherFromCommand({ actor, text: 'stop the gold watch' })
  assert.equal(stop2?.status, 'completed', stop2?.text)
  assert.equal(goldRows().length, 0)
  await create('alert me if gold rate drops by 10%')
  const stop3 = await watchCommand.tryStopWatcherFromCommand({ actor, text: 'cancel my gold watch, the one to alert me if gold drops 10%' })
  assert.equal(stop3?.status, 'completed', stop3?.text)
  assert.equal(goldRows().length, 0)
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

await check('poll: dedupe key is a stable episode identity; outcome_unknown retry reuses it (no double-send)', async () => {
  reset(); seedUser(); searchContext = today(14000)
  const r = await create('Alert me if gold rate drips by 10% from the current rate')
  assert.equal(r?.status, 'completed')
  const w = tables.agent_watchers[0]
  const g = w.condition_json.goldRule
  deliveryMode = 'unknown'
  await poll(today(12500))
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0], watchers.goldAlertDeliveryKey(String(w.id), g, 0), 'key = watch id + rule identity + episode only')
  assert.equal(w.last_state_json.goldAlertCount, 0, 'unknown outcome does not advance the episode')
  assert.equal(w.last_state_json.goldArmed, true)
  // The condition_json is rewritten and the observed value moves; the retry key must not change.
  w.condition_json = { ...w.condition_json, cadenceMinutes: 720 }
  await poll(today(12400))
  assert.equal(attempts.length, 2)
  assert.equal(attempts[1], attempts[0], 'retry after outcome_unknown reuses the ledger key')
  deliveryMode = 'ok'
  await poll(today(12300))
  assert.equal(attempts[2], attempts[0])
  assert.equal(delivered.length, 1)
  assert.equal(w.last_state_json.goldAlertCount, 1)
  await poll(today(12700)) // re-arm
  await poll(today(12500)) // new episode
  assert.equal(delivered.length, 2)
  assert.equal(delivered[1].key, watchers.goldAlertDeliveryKey(String(w.id), g, 1))
  assert.notEqual(delivered[1].key, delivered[0].key)
  const src = readFileSync('lib/agent/watchers.ts', 'utf8')
  const fn = src.slice(src.indexOf('export function goldAlertDeliveryKey'), src.indexOf('// One check of a gold-rate watch'))
  assert.doesNotMatch(fn, /condition_json|observed/)
})

if (failures.length) {
  console.error(failures.join('\n\n'))
  process.exit(1)
}
console.log('gold-rate watch: parser, routing order, verified-baseline creation, honest refusal and dedupe-safe polling pass')
