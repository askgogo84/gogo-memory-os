import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// TEST ONLY. Execute the deployed watch-command implementation against fake
// in-memory rows. No Supabase, WhatsApp, provider, network, or real watch action.
type Row = Record<string, any>
const tables: Record<string, Row[]> = { agent_watchers: [], agent_ideas: [] }

function database() {
  return {
    from(table: string) {
      let filters: Array<[string, any]> = []
      let updateData: Row | null = null
      let orderColumn = ''
      let descending = false
      let limitCount = Number.POSITIVE_INFINITY
      let fromIndex = 0
      let toIndex = Number.POSITIVE_INFINITY
      const q: any = {
        select() { return q },
        eq(column: string, value: any) { filters.push([column, value]); return q },
        in() { return q },
        contains() { return q },
        order(column: string, opts?: { ascending?: boolean }) {
          orderColumn = column
          descending = opts?.ascending === false
          return q
        },
        limit(count: number) { limitCount = count; return q },
        range(start: number, end: number) { fromIndex = start; toIndex = end + 1; return q },
        update(value: Row) { updateData = value; return q },
        maybeSingle: async () => execute(true),
        single: async () => execute(true),
        then: (yes: any, no: any) => Promise.resolve(execute(false)).then(yes, no),
      }
      function matched() {
        return (tables[table] || []).filter(row =>
          filters.every(([column, value]) => String(row[column]) === String(value)))
      }
      function execute(single: boolean) {
        const matching = matched()
        if (updateData) {
          for (const row of matching) Object.assign(row, updateData)
        }
        let results = [...matching]
        if (orderColumn) {
          results.sort((a, b) => {
            const compare = String(a[orderColumn] || '').localeCompare(String(b[orderColumn] || ''))
            return descending ? -compare : compare
          })
        }
        results = results.slice(fromIndex, Math.min(toIndex, fromIndex + limitCount))
        return { data: single ? results[0] || null : results, error: null }
      }
      return q
    },
  }
}

const source = readFileSync(new URL('../lib/agent/watch-command.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exported: any = {}
const mocks: Record<string, any> = {
  '@/lib/supabase-admin': { supabaseAdmin: database() },
  './price-threshold': {},
  './typed-object-context': {},
  '@/lib/services/cost-guard': {},
  '@/lib/services/google-gmail': {},
  '@/lib/bot/handlers/followup-state': {},
  './watchers': {},
  './watch-dedupe': {},
  './watch-cost-policy': {},
}
runInNewContext(javascript, {
  exports: exported,
  require: (name: string) => mocks[name] || {},
  console, Buffer, URL, process: { env: {} },
})
assert.equal(typeof exported.tryStopWatcherFromCommand, 'function', 'real shipped handler must load')

const actor = { legacyTelegramId: 42 }
type Fixture = { id: string; name: string; owner?: number }
function arrange(fixtures: Fixture[]) {
  tables.agent_watchers = fixtures.map((row, index) => ({
    id: row.id, telegram_id: String(row.owner ?? 42), type: 'web_search',
    condition_json: { title: row.name, query: row.name },
    active: true, next_check_at: '2026-11-01T00:00:00.000Z',
    created_at: new Date(Date.UTC(2026, 9, 30, 0, 0, index)).toISOString(),
  }))
  tables.agent_ideas = []
}
function active(id: string) {
  const row = tables.agent_watchers.find(row => row.id === id)
  assert.ok(row, 'fixture row exists: ' + id)
  return row.active === true
}
async function stop(text: string) {
  return exported.tryStopWatcherFromCommand({ actor, text })
}

let positive = 0
let negative = 0
const failed: string[] = []
async function check(label: string, expectedSafeControl: boolean, run: () => Promise<void>) {
  try {
    await run()
    if (expectedSafeControl) positive++
    else negative++
    console.log('PASS [' + (expectedSafeControl ? 'positive' : 'safety') + '] ' + label)
  } catch (error) {
    failed.push(label)
    console.error('FAIL [' + (expectedSafeControl ? 'positive' : 'safety') + '] ' + label + ': ' +
      (error instanceof Error ? error.message : String(error)))
  }
}

// Positive controls: exact unique match, distinct-owner boundary, identical
// duplicate identities and unmatched names must keep existing working behavior.
await check('exact variant stops only S24, not S25', true, async () => {
  arrange([{ id: 's24', name: 'Samsung Galaxy S24' }, { id: 's25', name: 'Samsung Galaxy S25' }])
  const result = await stop('stop the Samsung Galaxy S24 alert')
  assert.equal(result.status, 'completed')
  assert.equal(active('s24'), false)
  assert.equal(active('s25'), true)
})
await check('one matching name may stop the only watcher', true, async () => {
  arrange([{ id: 'only', name: 'Samsung Galaxy S24' }])
  const result = await stop('stop the Samsung Galaxy alert')
  assert.equal(result.status, 'completed')
  assert.equal(active('only'), false)
})
await check('exact duplicated identity may stop both duplicate rows', true, async () => {
  arrange([{ id: 'dup1', name: 'Sony WH-1000XM5' }, { id: 'dup2', name: 'Sony WH-1000XM5' }])
  const result = await stop('stop the Sony WH-1000XM5 alert')
  assert.equal(result.status, 'completed')
  assert.equal(active('dup1'), false)
  assert.equal(active('dup2'), false)
})
await check('different owner watcher is never selected', true, async () => {
  arrange([{ id: 'own', name: 'Samsung Galaxy S24' },
           { id: 'other', name: 'Samsung Galaxy S24', owner: 99 }])
  const result = await stop('stop the Samsung Galaxy S24 alert')
  assert.equal(result.status, 'completed')
  assert.equal(active('own'), false)
  assert.equal(active('other'), true)
})
await check('unmatched named watch fails closed', true, async () => {
  arrange([{ id: 's24', name: 'Samsung Galaxy S24' }])
  const result = await stop('stop the Pixel 9 alert')
  assert.equal(result.status, 'paused')
  assert.equal(active('s24'), true)
})

// Safety contract: different product, storage, or color variants sharing all
// command tokens MUST remain active pending disambiguation; never bulk stop them.
await check('Samsung Galaxy S24 vs S25: two-word stop requests disambiguation', false, async () => {
  arrange([{ id: 's24', name: 'Samsung Galaxy S24' }, { id: 's25', name: 'Samsung Galaxy S25' }])
  const result = await stop('stop the Samsung Galaxy alert')
  assert.equal(result.status, 'paused', 'distinct product variants must prompt, not complete')
  assert.equal(active('s24'), true, 'S24 must remain active')
  assert.equal(active('s25'), true, 'S25 must remain active')
})
await check('S24 128GB vs 256GB: partial model stop requests disambiguation', false, async () => {
  arrange([{ id: '128', name: 'Samsung Galaxy S24 128GB' },
           { id: '256', name: 'Samsung Galaxy S24 256GB' }])
  const result = await stop('stop the Samsung Galaxy S24 alert')
  assert.equal(result.status, 'paused', 'distinct storage variants must prompt')
  assert.equal(active('128'), true)
  assert.equal(active('256'), true)
})
await check('Sony headphone color variants: short name cannot bulk stop both', false, async () => {
  arrange([{ id: 'black', name: 'Sony WH-1000XM5 Black' },
           { id: 'silver', name: 'Sony WH-1000XM5 Silver' }])
  const result = await stop('stop the Sony WH-1000XM5 alert')
  assert.equal(result.status, 'paused', 'distinct color variants must prompt')
  assert.equal(active('black'), true)
  assert.equal(active('silver'), true)
})

console.log('Actual watch-command.ts synthetic results: ' + positive +
  ' positive controls passed; ' + negative + ' safety assertions passed; ' +
  failed.length + ' failures.')
if (failed.length) {
  console.error('EXPECTED RED on vulnerable source, NOT a real account or watch operation: ' + failed.join('; '))
  process.exitCode = 1
}
