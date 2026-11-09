// Inert original-source regression for signed owner precision in live flight-leg alerts.
// No production database, internet request, personal records, device push, or provider send.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const trackerSource = readFileSync('lib/agent/flight-leg-tracker.ts', 'utf8')
const identitySource = readFileSync('lib/dashboard/owner-identity.ts', 'utf8')
let controls = 0
let safety = 0

function compileOriginal(source, imports, extras = {}) {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'original.ts',
    reportDiagnostics: true,
  })
  assert.equal(js.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length || 0, 0)
  const module = { exports: {} }
  const context = vm.createContext({
    exports: module.exports, module,
    require: (id) => {
      if (Object.hasOwn(imports, id)) return imports[id]
      throw new Error('Unexpected import in sealed fixture: ' + id)
    },
    console: { error() {}, log() {} },
    process: { env: { AERODATABOX_RAPIDAPI_KEY: 'synthetic-only' } },
    URL, Date, Intl, AbortSignal, ...extras,
  })
  vm.runInContext(js.outputText, context, { timeout: 4000 })
  return module.exports
}

const identity = compileOriginal(identitySource, { 'node:crypto': require('node:crypto') })
const exact = identity.exactSessionOwnerId
assert.equal(exact('9007199254740992'), '9007199254740992'); controls++
assert.equal(exact('9007199254740993'), '9007199254740993'); controls++
assert.equal(exact('-2251799813685249'), '-2251799813685249'); controls++
assert.equal(Number('9007199254740992'), Number('9007199254740993'))
assert.equal(exact(Number('9007199254740993')), null); safety++
assert.equal(exact(null), null); safety++

assert.match(trackerSource, /exactSessionOwnerId\(row\.telegram_id\)/)
assert.match(trackerSource, /telegramId: ownerId/)
assert.match(trackerSource, /insert\(\{ telegram_id: leg\.telegramId, role: 'assistant'/)
assert.doesNotMatch(trackerSource, /Number\(leg\.telegramId\)/)
assert.ok(
  trackerSource.indexOf('const ownerId = exactSessionOwnerId(row.telegram_id)')
    < trackerSource.indexOf('const raw: any = row.raw || {}', trackerSource.indexOf('export async function runFlightLegTracker')),
  'owner must fail closed before any per-leg monitor or provider lookup',
)
safety++

const now = Date.parse('2026-10-12T20:40:00Z')
const fixtureLeg = owner => ({
  id: 'fixture-flight-001', telegram_id: owner, from_city: 'New York', to_city: 'Amsterdam',
  depart_at: '2026-10-12T20:40:00Z', arrive_at: '2026-10-12T23:00:00Z',
  airline: 'KLM', flight_no: 'KL0642', raw: {},
})

async function runCase(rawOwner, receipt = { accepted: true, state: 'provider_accepted' }) {
  const calls = { watchers: [], messages: [], alerts: [], updates: [], provider: 0, cost: 0 }
  const rows = [fixtureLeg(rawOwner)]
  const db = {
    from(table) {
      let action = 'select'
      let value = null
      const filters = []
      const query = {
        select() { return query },
        eq(key, val) { filters.push([key, val]); return query },
        not() { return query },
        gte() { return query },
        lte() { return query },
        limit() { return query },
        update(patch) { action = 'update'; value = patch; return query },
        insert(entry) {
          assert.equal(table, 'conversations', 'only conversation receipt writes allowed')
          calls.messages.push(entry)
          return Promise.resolve({ data: null, error: null })
        },
        async maybeSingle() {
          assert.equal(table, 'agent_watchers')
          calls.watchers.push(filters)
          return { data: { id: 'fixture-watcher', condition_json: {} }, error: null }
        },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            assert.equal(table, 'travel_tickets')
            if (action === 'update') {
              calls.updates.push({ patch: value, filters })
              return { data: null, error: null }
            }
            return { data: rows, error: null }
          }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const modules = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId: exact },
    '@/lib/web-search': { searchWebResults: async () => { throw Error('Unexpected real web search') } },
    '@/lib/services/cost-guard': {
      checkCostAllowance: async () => { calls.cost++; return { allowed: false } },
      COST_ESTIMATES_PAISE: { web_search_basic: 1 },
      recordCostEvent: async () => {},
    },
    '@/lib/bot/handlers/flight-status': {
      FLIGHT_TRACKER_DOMAINS: [], isFareShoppingResult: () => true,
      classifyOccurrence: () => ({ usable: false }), stripNegatedStates: text => text,
    },
    '@/lib/agent/watcher-quality': { extractDateTokens: () => [] },
    '@/lib/services/travel-time': {
      ticketTimezone: () => 'UTC', withTicketYears: value => value, flightInstants: () => ({}),
    },
    './watch-alert-delivery': {
      async deliverWatchAlert(input) {
        calls.alerts.push(input)
        return receipt
      },
    },
  }
  const mockFetch = async () => {
    calls.provider++
    return { ok: true, json: async () => [{
      status: 'Expected', departure: {
        scheduledTime: { utc: '2026-10-12 20:40Z' }, gate: 'B31', terminal: '4',
      }, arrival: {},
    }] }
  }
  const tracker = compileOriginal(trackerSource, modules, { fetch: mockFetch })
  const result = await tracker.runFlightLegTracker(now)
  return { calls, result }
}

for (const owner of ['9007199254740992', '9007199254740993', '-2251799813685249']) {
  const { calls, result } = await runCase(owner)
  assert.equal(result.checked, 1, 'exactly one checked tracked leg')
  assert.equal(calls.provider, 1, 'sealed fake source called once')
  assert.equal(calls.watchers.length, 1)
  assert.ok(calls.watchers[0].some(([key, value]) => key === 'telegram_id' && value === owner),
    'watcher lookup requires full exact decimal owner')
  assert.equal(calls.alerts.length, 1)
  assert.equal(calls.alerts[0].owner, owner, 'notification recipient must not round')
  assert.equal(calls.messages.length, 1)
  assert.equal(calls.messages[0].telegram_id, owner, 'conversation receipt must use exact owner string')
  assert.equal(calls.updates.length, 1)
  assert.ok(calls.updates[0].filters.some(([key, value]) => key === 'telegram_id' && value === owner))
  controls++
}

for (const owner of [Number('9007199254740993'), null, '00042', 'not-an-owner', 0, 1.5]) {
  const { calls, result } = await runCase(owner)
  assert.equal(result.skipped, 1, 'unsafe stored owner must be refused')
  assert.equal(calls.watchers.length, 0, 'no owner-aliased private watcher lookup')
  assert.equal(calls.provider, 0, 'no provider network even through sealed transport')
  assert.equal(calls.alerts.length, 0, 'no alert or cross-account notification')
  assert.equal(calls.messages.length, 0, 'no conversation write for unknown owner')
  assert.equal(calls.updates.length, 0, 'no flight ticket modification for unknown owner')
  safety++
}

// Unknown send outcome must remain one-shot; no blind replay or inferred delivery.
const unknown = await runCase('42', { accepted: false, state: 'outcome_unknown' })
assert.equal(unknown.calls.alerts.length, 1)
assert.equal(unknown.calls.provider, 1)
assert.equal(unknown.calls.messages.length, 1, 'existing unknown-outcome conversation behavior preserved for review')
assert.equal(unknown.calls.updates.length, 1)
safety++

console.log('flight leg original-source owner isolation: ' + controls + ' benign controls, ' + safety + ' mandatory safety assertions PASS')
