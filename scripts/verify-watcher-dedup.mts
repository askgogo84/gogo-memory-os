/**
 * G5 / Bug C — duplicate web_search / price watchers.
 *
 * Drives the REAL tryCreateWebWatchFromCommand (the single create path both the
 * direct web-watch and finalizePriceWatch funnel through) against an in-memory
 * Supabase, using the same VM-load harness as verify-price-watch-clarifier.mts.
 *
 *   1) first create            -> a new active web_search row (count 1)
 *   2) identical repeat create -> returns the EXISTING watcher, 0 new rows (count still 1)
 *   3) NEGATIVE CONTROL: a genuinely different query -> a new row (count 2),
 *      proving the guard is query-specific, not a blanket "never create twice".
 *
 * Prints WATCHER_DEDUP_OK only after every assertion passes.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as priceThreshold from '../lib/agent/price-threshold'

type Row = Record<string, any>
const stores: Record<string, any> = { agent_watchers: [], agent_runs: [], agent_activity: [], _id: 0, _wid: 0 }

function makeDb() {
  return {
    from(table: string) {
      const b: any = {
        _filters: [] as Array<[string, string, any]>,
        _count: false,
        _insert: null as Row | null,
        _update: null as Row | null,
        select(_cols?: any, opts?: any) { if (opts && opts.count) b._count = true; return b },
        eq(col: string, val: any) { b._filters.push(['eq', col, val]); return b },
        in(col: string, vals: any[]) { b._filters.push(['in', col, vals]); return b },
        order() { return b },
        limit() { return b },
        insert(row: Row) { b._insert = row; return b },
        update(row: Row) { b._update = row; return b },
        single: async () => resolveSingle(),
        maybeSingle: async () => resolveSingle(),
        then: (res: any, rej: any) => Promise.resolve(resolveTerminal()).then(res, rej),
      }
      function rows(): Row[] {
        let r: Row[] = stores[table] || []
        for (const [op, col, val] of b._filters) {
          if (op === 'eq') r = r.filter((x) => String(x[col]) === String(val))
          if (op === 'in') r = r.filter((x) => (val as any[]).map(String).includes(String(x[col])))
        }
        return [...r].sort((a, z) => String(z.created_at || '').localeCompare(String(a.created_at || '')))
      }
      function applyInsert(): Row {
        const row = { id: 'row' + (++stores._id), ...(b._insert as Row) }
        ;(stores[table] = stores[table] || []).push(row)
        return row
      }
      function resolveSingle() {
        if (b._insert) { const row = applyInsert(); return { data: { id: row.id, ...row }, error: null } }
        if (b._update) { for (const x of rows()) Object.assign(x, b._update) }
        const r = rows(); return { data: r[0] || null, error: null }
      }
      function resolveTerminal() {
        if (b._insert) { const row = applyInsert(); return { data: [row], error: null } }
        if (b._update) { for (const x of rows()) Object.assign(x, b._update); return { data: rows(), error: null } }
        if (b._count) { return { count: rows().length, data: null, error: null } }
        return { data: rows(), error: null }
      }
      return b
    },
  }
}

const db = makeDb()

function normalizeWebSearchWatcher(input: any) {
  const title = String(input?.title || '').trim().slice(0, 180)
  const query = String(input?.query || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!title || !query) return null
  return { title, query, triggerKeywords: [], delivery: 'both', cadenceMinutes: 60, burstUntil: null, contextual: input?.contextual === true }
}

const watchersMock = {
  normalizeWebSearchWatcher,
  normalizeWebPageWatcher: () => null,
  normalizeProductStockWatcher: () => null,
  createWebSearchWatcher: async ({ telegramId, condition }: any) => {
    const row = {
      id: 'w' + (++stores._wid),
      telegram_id: String(telegramId),
      type: 'web_search',
      condition_json: { ...condition },
      active: true,
      created_at: new Date(Date.now() + stores._wid).toISOString(),
    }
    stores.agent_watchers.push(row)
    return row
  },
  createWebPageWatcher: async () => ({}),
  createProductStockWatcher: async () => ({}),
  createInboxTriageWatcher: async () => ({}),
}

function loadWatchCommand() {
  const source = readFileSync(new URL('../lib/agent/watch-command.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mocks: Record<string, any> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    './typed-object-context': {
      latestTypedContext: async () => null,
      selectedTypedObject: () => null,
      rememberTypedObjects: async () => {},
    },
    '@/lib/services/cost-guard': {
      getCostBudget: async () => ({
        activeWebWatchersMax: 5, planCode: 'pro', baseWatcherCadenceMinutes: 60,
        burstHours: 0, maxWatcherCadenceMinutes: 1440,
      }),
    },
    '@/lib/services/google-gmail': { buildGmailConnectUrl: () => '' },
    '@/lib/bot/handlers/followup-state': {
      saveFollowupState: async () => {}, getLatestFollowupState: async () => null,
      clearFollowupState: async () => {}, isStrictlyFreshFollowupState: () => true, isFreshFollowupState: () => true,
    },
    './actor': {}, './orchestrator': {},
    './watchers': watchersMock,
    './price-threshold': priceThreshold,
    './watch-cost-policy': {
      initialWatcherCadence: () => 15,
      isUrgentWatchRequest: () => false,
      watcherUpgradeMessage: () => 'upgrade your plan',
      adaptiveWatcherCadence: () => 60,
    },
  }
  const exportsObj: any = {}
  runInNewContext(code, { exports: exportsObj, require: (name: string) => mocks[name] || {}, process: { env: {} }, Buffer, URL, console })
  return exportsObj
}

const wc = loadWatchCommand()
const actor = { userId: 'u1', legacyTelegramId: 42, whatsappId: '9111', name: 'Gogo' }
const actor2 = { userId: 'u2', legacyTelegramId: 99, whatsappId: '9222', name: 'Other' }
const surface = 'whatsapp'
const activeWebFor = (tg: number) =>
  stores.agent_watchers.filter((w: any) => w.type === 'web_search' && w.active && String(w.telegram_id) === String(tg)).length

const Q1 = 'watch the web for sony wh-1000xm5 price in india below 22000 excluding bank card offers'
// Same watch as Q1 but different case + collapsed/extra whitespace.
const Q1_VARIANT = '  Watch  the   WEB  for  SONY WH-1000XM5   price in INDIA below 22000 EXCLUDING bank card offers '
const Q2 = 'watch the web for bose qc45 price in india below 25000'

// 1) first create -> one new active row for user 42
const r1 = await wc.tryCreateWebWatchFromCommand({ actor, surface, text: Q1 })
assert.ok(r1 && r1.status === 'completed', 'first create completes')
assert.equal(r1.handledBy, 'background-web-watch', 'first create is a fresh web watch')
assert.doesNotMatch(String(r1.runId), /existing/, 'first create is NOT a dedup hit')
assert.equal(activeWebFor(42), 1, 'exactly one active web_search watcher after first create')

// 2) identical repeat -> returns existing, zero new rows, and a distinct reply
const r2 = await wc.tryCreateWebWatchFromCommand({ actor, surface, text: Q1 })
assert.ok(r2 && r2.status === 'completed', 'repeat returns a completed result')
assert.match(String(r2.runId), /^web-watch-existing-/, 'repeat is served from the existing watcher, not a new create')
assert.match(r2.text, /already watching/i, 'repeat says the watch already exists')
assert.match(r2.text, /set up \d/i, 'repeat reply states when the watch was set up')
assert.doesNotMatch(r2.text, /now watching|is now watching|your request is saved/i, 'repeat must NOT use the fresh "watching now" confirmation')
assert.equal(activeWebFor(42), 1, 'BUG C FIX: identical repeat created ZERO new rows (still 1)')

// 3) case/whitespace variant -> treated as the SAME watch (no second row)
const rVar = await wc.tryCreateWebWatchFromCommand({ actor, surface, text: Q1_VARIANT })
assert.ok(rVar && rVar.status === 'completed', 'variant returns a completed result')
assert.match(String(rVar.runId), /^web-watch-existing-/, 'case/whitespace variant is deduped to the same watch')
assert.equal(activeWebFor(42), 1, 'case/whitespace variant created ZERO new rows (normalised match)')

// 4) negative control (different query) -> a new row for user 42
const r3 = await wc.tryCreateWebWatchFromCommand({ actor, surface, text: Q2 })
assert.ok(r3 && r3.status === 'completed', 'different query create completes')
assert.doesNotMatch(String(r3.runId), /existing/, 'negative control: a different query is NOT deduped')
assert.equal(activeWebFor(42), 2, 'negative control: a genuinely different query adds a second row')

// 5) cross-user control -> user 99 with the SAME query as user 42 gets their OWN row
const rUser2 = await wc.tryCreateWebWatchFromCommand({ actor: actor2, surface, text: Q1 })
assert.ok(rUser2 && rUser2.status === 'completed', 'second user create completes')
assert.doesNotMatch(String(rUser2.runId), /existing/, 'cross-user: user 99 is NOT deduped against user 42')
assert.equal(activeWebFor(99), 1, 'cross-user: user 99 gets their own watcher row')
assert.equal(activeWebFor(42), 2, 'cross-user: user 42 is unaffected by user 99')

console.log(`create#1  user42 runId=${r1.runId}  -> user42 rows=1`)
console.log(`repeat#2  user42 runId=${r2.runId}  -> user42 rows=1 (deduped, 0 new)`)
console.log(`variant#3 user42 runId=${rVar.runId}  -> user42 rows=1 (case/whitespace deduped)`)
console.log(`diff#4    user42 runId=${r3.runId}  -> user42 rows=2 (new row)`)
console.log(`xuser#5   user99 runId=${rUser2.runId}  -> user99 rows=1, user42 rows=2`)
console.log('--- exact repeat reply text ---')
console.log(r2.text)
console.log('-------------------------------')
console.log('WATCHER_DEDUP_OK')
