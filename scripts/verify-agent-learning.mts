import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const route = read('app/api/cron/agent-learning/route.ts')
const worker = read('lib/agent/learning-worker.ts')
const insights = read('lib/bot/memory-twin/insight-generator.ts')
const vercel = JSON.parse(read('vercel.json'))

assert.match(route, /processLearningPass/)
assert.match(route, /CRON_SECRET/)
assert.match(route, /status:\s*401/)
assert.match(route, /AGENT_LEARNING_CRON_FAILED/)

const cron = vercel.crons.find((x: any) => x.path === '/api/cron/agent-learning')
assert.ok(cron, 'agent-learning cron must be registered')
assert.equal(cron.schedule, '17 * * * *')

assert.match(worker, /user_behavior_events/)
assert.match(worker, /36 \* 3600_000/)
assert.match(worker, /MAX_USERS_PER_PASS\s*=\s*80/)
assert.match(worker, /generateUserInsights/)
assert.match(worker, /failures\.slice\(0,10\)/)

assert.match(insights, /memory_enabled === false/)
assert.match(insights, /proactive_suggestions_enabled === false/)
assert.match(insights, /item\.confidence < 0\.72/)
assert.match(insights, /item\.evidence_count < 5/)
assert.match(insights, /source_refs/)
assert.match(insights, /NON_PROACTIVE_TASKS/)
assert.match(insights, /NOISY_CONTACTS/)
assert.match(insights, /function daypartForClock/)
assert.match(insights, /hour >= 5 && hour < 12.*morning/s)
assert.match(insights, /hour >= 12 && hour < 17.*afternoon/s)
assert.match(insights, /hour >= 17 && hour < 21.*evening/s)
assert.match(insights, /return 'late-night'/)
assert.match(insights, /reason:usualTimeReason\(String\(topTime\.value\)\)/)
assert.doesNotMatch(insights, /when you say [“"]morning[”"]/i, 'a learned afternoon/evening time must never be described as a morning default')




// Exact 64-bit identity regression: execute ACTUAL worker and synthesis modules
// against inert DB stubs. No provider, user table, or production access.
function loadActual(path: string, mocks: Record<string, any>) {
  const js = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const moduleExports: Record<string, any> = {}
  runInNewContext(js, {
    exports: moduleExports,
    require: (id: string) => {
      if (!(id in mocks)) throw new Error('unexpected_module:' + id)
      return mocks[id]
    },
    console, Date, Number, String, Set, Promise, BigInt, Buffer, Error,
  })
  return moduleExports
}

const ownerIdentity = loadActual('lib/dashboard/owner-identity.ts', {
  'node:crypto': { randomBytes: () => Buffer.alloc(7) },
})
const ownerOf = ownerIdentity.exactSessionOwnerId
const idA = '9007199254740992'
const idB = '9007199254740993'
assert.equal(ownerOf(idA), idA)
assert.equal(ownerOf(idB), idB)

const seen: string[] = []
const syntheticEvents = [
  { telegram_id: idA }, { telegram_id: idB }, { telegram_id: idB },
  { telegram_id: 42 }, { telegram_id: Number(idB) },
  { telegram_id: '00042' }, { telegram_id: 'not-an-owner' },
]
const workerActual = loadActual('lib/agent/learning-worker.ts', {
  '@/lib/supabase-admin': {
    supabaseAdmin: { from(table: string) {
      assert.equal(table, 'user_behavior_events')
      return {
        select(_fields: string) { return this },
        gte(_field: string, _since: string) { return this },
        order(_field: string, _options: any) { return this },
        limit(_count: number) { return Promise.resolve({ data: syntheticEvents, error: null }) },
      }
    } },
  },
  '@/lib/bot/memory-twin/insight-generator': {
    generateUserInsights: async (id: string) => { seen.push(id); return [] },
  },
  '@/lib/dashboard/owner-identity': { exactSessionOwnerId: ownerOf },
})
const pass = await workerActual.processLearningPass()
assert.deepEqual([...seen].sort(), ['42', idA, idB].sort(),
  'distinct signed-64 owners must reach distinct synthesis; unsafe rounded numeric and malformed IDs must be skipped')
assert.equal(pass.usersConsidered, 3)

const queriedOwners: Array<{ table: string; owner: unknown }> = []
const generatorActual = loadActual('lib/bot/memory-twin/insight-generator.ts', {
  '@/lib/supabase-admin': {
    supabaseAdmin: { from(table: string) {
      let eqId: unknown
      return {
        select(_fields: string) { return this },
        eq(field: string, value: unknown) {
          if (field === 'telegram_id') eqId = value
          return this
        },
        maybeSingle() {
          queriedOwners.push({ table, owner: eqId })
          return Promise.resolve({ data: null, error: null })
        },
      }
    } },
  },
  '@/lib/dashboard/owner-identity': { exactSessionOwnerId: ownerOf },
})
await generatorActual.generateUserInsights(Number(idB))
await generatorActual.generateUserInsights('00042')
assert.equal(queriedOwners.length, 0,
  'a rounded numeric or noncanonical identifier may never trigger private learning reads')
const safeResult = await generatorActual.generateUserInsights(idB)
assert.equal(safeResult.length, 0)
assert.deepEqual(queriedOwners, [
  { table: 'user_memory_profile', owner: idB },
  { table: 'user_consent_settings', owner: idB },
], 'both private learning reads must retain the exact original 64-bit owner')

console.log('agent learning verification passed — exact-owner inert worker/synthesis regressions')
