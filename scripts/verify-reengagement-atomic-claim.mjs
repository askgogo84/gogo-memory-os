// Executable original-function regression for the shipped re-engagement cron.
// All data, DB constraints, and WhatsApp senders are synthetic. No network or customer data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/agent/reengage.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'lib/agent/reengage.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const DAY = 86_400_000
const start = Date.parse('2026-11-04T06:00:00.000Z') // 11:30 IST
function fixture({ inactive = false } = {}) {
  let clock = start
  let latestInbound = start - 4 * DAY
  let totalSends = 0
  let insertAttempts = 0
  let generatedIds = 0
  let readerTarget = 1
  let readers = []
  const claims = new Map()

  const db = {
    from(table) {
      if (!['conversations', 'agent_activity', 'users'].includes(table)) {
        throw new Error('unexpected table ' + table)
      }
      const builder = {
        select() { return this },
        eq() { return this },
        gte() { return this },
        order() { return this },
        limit() {
          if (table === 'conversations') {
            return Promise.resolve({ data: [{ telegram_id: '101', created_at: new Date(latestInbound).toISOString() }], error: null })
          }
          assert.equal(table, 'agent_activity')
          // Take each reader's snapshot BEFORE a sender can claim anything.
          const snapshot = [...claims.values()].map(x => ({ telegram_id: x.telegram_id, created_at: x.created_at }))
          return new Promise(resolve => {
            readers.push(() => resolve({ data: snapshot, error: null }))
            if (readers.length >= readerTarget) {
              const batch = readers.splice(0)
              batch.forEach(fn => fn())
            }
          })
        },
        maybeSingle() {
          assert.equal(table, 'users')
          return Promise.resolve({ data: { whatsapp_id: 'whatsapp:+15555550101', access_status: inactive ? 'blocked' : 'active' }, error: null })
        },
        async insert(record) {
          assert.equal(table, 'agent_activity')
          insertAttempts++
          // Real agent_activity has a UUID primary key. A missing explicit id is
          // assigned a fresh random UUID by Postgres, so two inserts both win.
          const id = record.id || 'random-uuid-fixture-' + (++generatedIds)
          if (claims.has(id)) {
            return { error: { code: '23505', message: 'duplicate key value violates agent_activity_pkey' } }
          }
          claims.set(id, { ...record, id, created_at: new Date(clock).toISOString() })
          return { error: null }
        },
      }
      return builder
    },
  }
  const sandbox = { exports: {}, module: { exports: {} }, Date, Map, String, Number, Promise,
    console: { log() {} },
    require(name) {
      if (name === '@/lib/supabase-admin') return { supabaseAdmin: db }
      if (name === 'node:crypto') return { createHash }
      throw new Error('unexpected import ' + name)
    },
  }
  sandbox.module.exports = sandbox.exports
  vm.runInNewContext(compiled, sandbox, { filename: 'lib/agent/reengage.ts', timeout: 1000 })
  const module = sandbox.exports
  assert.equal(typeof module.runReengagePass, 'function', 'test executes the original exported implementation')

  return {
    module,
    setReaders(n) { readerTarget = n },
    setClock(v) { clock = v },
    setLatestInbound(v) { latestInbound = v },
    get sendCount() { return totalSends },
    get insertAttempts() { return insertAttempts },
    get claims() { return [...claims.values()] },
    async pass(sender = async () => ({ sid: 'synthetic-accepted' })) {
      return module.runReengagePass(clock, async (phone, text) => {
        assert.equal(phone, 'whatsapp:+15555550101')
        assert.match(text, /Your reminders and watches are still running/)
        totalSends++
        return sender()
      })
    },
  }
}

const f = fixture()
const iso = new Date(start - 4 * DAY).toISOString()
const id1 = f.module.reengagementClaimId('101', iso)
const id2 = f.module.reengagementClaimId('101', iso)
assert.equal(id1, id2, 'same exact actor and inbound evidence => same claim')
assert.match(id1, /^[\da-f]{8}-[\da-f]{4}-8[\da-f]{3}-a[\da-f]{3}-[\da-f]{12}$/i)
assert.notEqual(id1, f.module.reengagementClaimId('102', iso), 'different owner cannot share claim')
assert.notEqual(id1, f.module.reengagementClaimId('101', new Date(start - 5 * DAY).toISOString()), 'different quiet spell gets a new claim')

// Both independent workers read the same empty history before either inserts.
// The real agent_activity UUID PK must arbitrate the contested insert.
f.setReaders(2)
const results = await Promise.all([f.pass(), f.pass()])
assert.equal(f.insertAttempts, 2, 'both attempted their claim after the same stale snapshot')
assert.equal(f.claims.length, 1, 'one durable claim survives concurrent attempts')
assert.equal(f.sendCount, 1, 'only one WhatsApp sender may execute for the quiet spell')
assert.equal(results.filter(x => x.sent === 1).length, 1)
assert.equal(results.filter(x => x.sent === 0).length, 1)
assert.equal(results.every(x => x.errors.length === 0), true, '23505 is not a provider failure')

f.setReaders(1)
await f.pass()
assert.equal(f.sendCount, 1, 'repeated cron after an accepted claim never sends again')
f.setClock(start + 8 * DAY)
f.setLatestInbound(start + 4 * DAY) // a fresh inbound AFTER the previous nudge, now 4 days quiet
await f.pass()
assert.equal(f.sendCount, 2, 'a genuinely new quiet spell can be nudged')
assert.equal(f.claims.length, 2)

const failure = fixture()
const uncertain = await failure.pass(async () => { throw new Error('synthetic network timeout; unknown outcome') })
assert.equal(uncertain.sent, 0)
assert.equal(uncertain.errors.length, 1)
assert.equal(failure.claims.length, 1, 'claim recorded before uncertain provider outcome')
await failure.pass()
assert.equal(failure.sendCount, 1, 'unknown outcome must NOT blindly retry')

const blocked = fixture({ inactive: true })
await blocked.pass()
assert.equal(blocked.sendCount, 0, 'inactive/blocked recipients are not nudged')
assert.equal(blocked.claims.length, 0)
console.log('PASS: original reengagement uses atomic persisted UUID claim across concurrent workers, no unknown-outcome retry, exact owner/quiet-spell separation')
