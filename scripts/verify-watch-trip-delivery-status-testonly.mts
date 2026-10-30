/**
 * Inert production-source regression: watch-status presentation must not hide
 * failed/unknown/pending trip alerts, scheduled checks, or itinerary-only steps.
 * Test-only / expected safety RED until Claude's implementation is reviewed.
 *
 * This executes the real shipped watch-command.ts function in an isolated VM.
 * ALL imports are stubs; the database is in-memory and cannot reach Supabase,
 * WhatsApp, Vercel, a browser, or any provider.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const owner = 'synthetic-owner-alpha'
const otherOwner = 'synthetic-owner-beta'
const source = readFileSync('lib/agent/watch-command.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'watch-command.ts',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText

const base = (overrides: Record<string, unknown> = {}) => ({
  id: 'synthetic-watch-1',
  telegram_id: owner,
  type: 'web_search',
  active: true,
  created_at: '2026-10-30T04:00:00Z',
  updated_at: '2026-10-30T04:00:00Z',
  last_checked_at: '2026-10-30T04:15:00Z',
  next_check_at: '2026-10-31T09:00:00Z',
  cadence_minutes: 180,
  condition_json: { title: 'Watch: laptop deals', query: 'laptop deals' },
  last_state_json: {},
  ...overrides,
})

const trip = (last_state_json: unknown = {}) => base({
  id: 'synthetic-trip-1',
  type: 'web_search',
  condition_json: {
    contextual: true,
    title: 'Trip airline news · IndiGo',
    expiresAt: '2026-11-03T00:00:00Z',
    query: 'IndiGo travel conditions',
  },
  last_state_json,
})

const step = (telegram_id = owner) => ({
  telegram_id,
  action_key: 'prepare-web-checkin',
  status: 'ready',
})

function fixture(watches: Record<string, any>[], steps: Record<string, any>[] = []) {
  const observations: Array<{ table: string; field: string; value: unknown }> = []
  const stubDb = {
    from(table: string) {
      if (!['agent_watchers', 'life_event_actions'].includes(table)) {
        throw new Error('Unexpected table access: ' + table)
      }
      let selected = [...(table === 'agent_watchers' ? watches : steps)]
      const query = {
        select(_columns: string) { return query },
        eq(field: string, value: unknown) {
          observations.push({ table, field, value })
          selected = selected.filter(row => row[field] === value)
          return query
        },
        neq(field: string, value: unknown) {
          selected = selected.filter(row => row[field] !== value)
          return query
        },
        in(field: string, values: unknown[]) {
          selected = selected.filter(row => values.includes(row[field]))
          return query
        },
        order(_field: string, _opts: unknown) { return query },
        async limit(count: number) {
          return { data: selected.slice(0, count), error: null }
        },
      }
      return query
    },
  }

  const exported: Record<string, any> = {}
  const fakeModule = { exports: exported }
  const fakeRequire = (id: string) => {
    if (id === '@/lib/supabase-admin') return { supabaseAdmin: stubDb }
    if (id === './typed-object-context') {
      return {
        rememberTypedObjects: async () => undefined,
        latestTypedContext: async () => null,
        selectedTypedObject: async () => null,
      }
    }
    if (id === './price-threshold') {
      return { parseMoneyAmount: () => null, formatRupees: (x: number) => String(x) }
    }
    // Importing anything else here would require a new explicit, inert stub.
    const permitted = [
      '@/lib/services/cost-guard',
      '@/lib/services/google-gmail',
      '@/lib/bot/handlers/followup-state',
      './watchers',
      './watch-dedupe',
      './watch-cost-policy',
    ]
    if (permitted.includes(id)) return {}
    throw new Error('Unexpected require (would break containment): ' + id)
  }
  runInNewContext(compiled, {
    module: fakeModule,
    exports: exported,
    require: fakeRequire,
    console,
    process: { env: {} },
    URL, URLSearchParams, Buffer, setTimeout, clearTimeout,
  }, { filename: 'sandboxed-watch-command.cjs', timeout: 3000 })

  return {
    fn: exported.tryGetWatcherStatusFromCommand as (p: unknown) => Promise<{ text: string }>,
    exported,
    observations,
    async status(text: string) {
      const output = await exported.tryGetWatcherStatusFromCommand({
        actor: { legacyTelegramId: owner },
        text,
      })
      assert.equal(output?.status, 'completed')
      assert.equal(typeof output?.text, 'string')
      return String(output.text)
    },
  }
}

let positives = 0
let safety = 0
let failures = 0

async function check(label: string, kind: 'positive' | 'safety', test: () => Promise<void>) {
  try {
    await test()
    if (kind === 'positive') positives += 1
    else safety += 1
    console.log('PASS [' + kind + '] ' + label)
  } catch (error) {
    failures += 1
    console.error('FAIL [' + kind + '] ' + label + ': ' +
      (error instanceof Error ? error.message.split('\n')[0] : String(error)))
  }
}

// Controls prove the test harness executes the shipped implementation and
// continues to catch normal watch-delivery warnings and owner-scoped reads.
await check('manual failed alert warning remains visible', 'positive', async () => {
  const f = fixture([base({ last_state_json: { alertDelivery: { state: 'failed' } } })])
  assert.match(await f.status('show my watches'), /last alert didn.t reach you/i)
})
await check('active contextual trip is displayed', 'positive', async () => {
  const f = fixture([trip()])
  assert.match(await f.status('show my watches'), /IndiGo airline news/i)
})
await check('watch and itinerary reads are both scoped to the requesting owner', 'positive', async () => {
  const f = fixture([
    base(),
    base({ id: 'foreign-watch', telegram_id: otherOwner, condition_json: { title: 'secret foreign monitor' } }),
  ], [step(), step(otherOwner)])
  const reply = await f.status('show my watches')
  assert.doesNotMatch(reply, /secret foreign monitor/i)
  const scoped = f.observations.filter(q => q.field === 'telegram_id')
  assert.equal(scoped.length, 2)
  assert.ok(scoped.every(q => q.value === owner))
})
await check('ISO date formatter control can format scheduled trip checks', 'positive', async () => {
  const f = fixture([trip()])
  const value = f.exported.shortCheckTime('2026-10-31T09:00:00Z', Date.parse('2026-10-30T09:00:00Z'))
  assert.match(String(value), /31 Oct,\s*2:30 pm/)
})

// Expected RED: The grouped contextual-trip block must be equally candid
// about undelivered alerts as the ordinary/manual watcher block.
await check('grouped trip watch reveals failed delivery', 'safety', async () => {
  const f = fixture([trip({ alertDelivery: { state: 'failed' } })])
  assert.match(await f.status('show my watches'), /(?:failed|could not be delivered|didn.t reach you)/i)
})
await check('grouped trip watch reveals unconfirmed delivery', 'safety', async () => {
  const f = fixture([trip({ alertDelivery: { state: 'outcome_unknown' } })])
  assert.match(await f.status('what are you watching and why'), /(?:unconfirmed|unknown|could not confirm)/i)
})
await check('grouped trip watch reveals pending alert', 'safety', async () => {
  const f = fixture([trip({ pendingAlert: { id: 'synthetic-pending' } })])
  assert.match(await f.status('show my watches'), /(?:pending|retry|waiting to be delivered)/i)
})
await check('why view shows actual trip next-check time rather than null', 'safety', async () => {
  const f = fixture([trip()])
  const reply = await f.status('what are you watching and why')
  assert.doesNotMatch(reply, /\bNext check null\b/i)
  assert.match(reply, /Next check (?:31 Oct,\s*)?2:30 pm/i)
})
await check('itinerary-only pending step is visible without contextual trip watchers', 'safety', async () => {
  const f = fixture([base()], [step()])
  assert.match(await f.status('show my watches'), /web check-in/i)
})

console.log('SUMMARY positive=' + positives + '/4 safety=' + safety + '/5 failed=' + failures)
if (failures > 0) process.exitCode = 1
