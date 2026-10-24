// Inert privacy regression: forwarded bodies expire without any fresh inbound mail.
// No service-role credentials, real database, provider calls, or test email content.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  forwardedEmailCutoff, pruneForwardedEmailBatch,
  FORWARDED_EMAIL_PRUNE_BATCH, FORWARDED_EMAIL_RETENTION_DAYS,
  type ForwardedEmailRetentionStore,
} from '../lib/email/retention.ts'

const errors: string[] = []
async function check(title: string, verify: () => unknown) {
  try { await verify(); console.log('PASS', title) }
  catch (error) { errors.push(title + ': ' + String((error as Error)?.message || error)) }
}

const NOW = Date.parse('2026-10-24T09:00:00.000Z')
const DAY = 86_400_000
const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
type Row = { id: string; owner: string; receivedAt: number; body: string }

function fixture(rows: Row[]) {
  const stored = rows.map(row => ({ ...row }))
  const inspected: string[] = []
  const deleted: string[] = []
  let reads = 0
  let writes = 0
  const store: ForwardedEmailRetentionStore = {
    async findExpired(cutoff, limit) {
      reads++
      inspected.push(cutoff + ':' + limit)
      const time = Date.parse(cutoff)
      return stored.filter(row => row.receivedAt < time)
        .sort((a, b) => a.receivedAt - b.receivedAt)
        .slice(0, limit).map(row => ({ id: row.id }))
    },
    async deleteExpired(ids, cutoff) {
      writes++
      const time = Date.parse(cutoff)
      let count = 0
      for (const id of ids) {
        const index = stored.findIndex(row => row.id === id && row.receivedAt < time)
        if (index < 0) continue
        deleted.push(id)
        stored.splice(index, 1)
        count++
      }
      return count
    },
  }
  return { store, stored, inspected, deleted, get reads() { return reads }, get writes() { return writes } }
}

await check('30-day cutoff is UTC, deterministic and strict', () => {
  assert.equal(FORWARDED_EMAIL_RETENTION_DAYS, 30)
  assert.equal(forwardedEmailCutoff(NOW), new Date(NOW - 30 * DAY).toISOString())
  assert.throws(() => forwardedEmailCutoff(NaN), /invalid_clock/)
  assert.throws(() => forwardedEmailCutoff(-1), /invalid_clock/)
})

await check('old private bodies are pruned across owners without any new inbound event', async () => {
  const f = fixture([
    { id: uuid(1), owner: 'alice', receivedAt: NOW - 31 * DAY, body: 'confidential-A' },
    { id: uuid(2), owner: 'bob', receivedAt: NOW - 50 * DAY, body: 'confidential-B' },
    { id: uuid(3), owner: 'alice', receivedAt: NOW - 30 * DAY, body: 'cutoff exactly' },
    { id: uuid(4), owner: 'bob', receivedAt: NOW - 29 * DAY, body: 'still current' },
    { id: uuid(5), owner: 'charlie', receivedAt: NOW + DAY, body: 'future' },
  ])
  const r = await pruneForwardedEmailBatch(f.store, NOW)
  assert.deepEqual({ examined: r.examined, deleted: r.deleted }, { examined: 2, deleted: 2 })
  assert.deepEqual(f.deleted.sort(), [uuid(1), uuid(2)])
  assert.deepEqual(f.stored.map(row => row.id), [uuid(3), uuid(4), uuid(5)])
  assert.equal(f.inspected[0], forwardedEmailCutoff(NOW) + ':100')
  assert.equal(f.writes, 1)
})

await check('repeated empty sweeps are safe and do not execute a delete', async () => {
  const f = fixture([{ id: uuid(6), owner: 'owner', receivedAt: NOW - DAY, body: 'recent' }])
  assert.equal((await pruneForwardedEmailBatch(f.store, NOW)).deleted, 0)
  assert.equal((await pruneForwardedEmailBatch(f.store, NOW)).deleted, 0)
  assert.equal(f.writes, 0)
})

await check('each cron pass has a hard cap and repeated passes drain old backlog', async () => {
  const f = fixture(Array.from({ length: 245 }, (_, i) => ({
    id: uuid(i + 100), owner: String(i % 4), receivedAt: NOW - (31 + i) * DAY, body: 'old',
  })))
  const one = await pruneForwardedEmailBatch(f.store, NOW, 10_000)
  assert.deepEqual([one.examined, one.deleted], [FORWARDED_EMAIL_PRUNE_BATCH, FORWARDED_EMAIL_PRUNE_BATCH])
  const two = await pruneForwardedEmailBatch(f.store, NOW)
  const three = await pruneForwardedEmailBatch(f.store, NOW)
  const four = await pruneForwardedEmailBatch(f.store, NOW)
  assert.deepEqual([two.deleted, three.deleted, four.deleted], [100, 45, 0])
  assert.equal(f.stored.length, 0)
  assert.equal(f.writes, 3)
})

await check('a row made newer after read is protected by the delete cutoff recheck', async () => {
  const f = fixture([{ id: uuid(7), owner: 'owner', receivedAt: NOW - 33 * DAY, body: 'updated after selection' }])
  const originalRead = f.store.findExpired
  f.store.findExpired = async (cutoff, limit) => {
    const ids = await originalRead(cutoff, limit)
    f.stored[0].receivedAt = NOW - DAY
    return ids
  }
  const result = await pruneForwardedEmailBatch(f.store, NOW)
  assert.deepEqual({ examined: result.examined, deleted: result.deleted }, { examined: 1, deleted: 0 })
  assert.equal(f.stored.length, 1)
})

await check('corrupt candidate sets and impossible receipts fail closed', async () => {
  let sends = 0
  const fail = async (ids: Array<{ id: string }>, deleted = 1) => {
    const store: ForwardedEmailRetentionStore = {
      findExpired: async () => ids,
      deleteExpired: async () => { sends++; return deleted },
    }
    return pruneForwardedEmailBatch(store, NOW)
  }
  await assert.rejects(() => fail([{ id: 'invalid' }]), /invalid_candidate_id/)
  await assert.rejects(() => fail([{ id: uuid(1) }, { id: uuid(1) }]), /invalid_candidate_id/)
  await assert.rejects(() => fail([{ id: uuid(1) }], 2), /invalid_delete_receipt/)
  assert.equal(sends, 1)
  await assert.rejects(() => pruneForwardedEmailBatch({
    findExpired: async () => { throw new Error('read_unavailable') },
    deleteExpired: async () => { throw new Error('must_not_delete') },
  }, NOW), /read_unavailable/)
  await assert.rejects(() => pruneForwardedEmailBatch({
    findExpired: async () => [{ id: uuid(1) }],
    deleteExpired: async () => { throw new Error('delete_unavailable') },
  }, NOW), /delete_unavailable/)
})

await check('existing authorised briefing cron invokes retention independently of new mail', () => {
  const cron = readFileSync('app/api/cron/daily-briefings/route.ts', 'utf8')
  const schedule = JSON.parse(readFileSync('vercel.json', 'utf8'))
  assert.match(cron, /isCronAuthorized\(req\)/)
  assert.match(cron, /pruneForwardedEmailInDb\(\)/)
  assert.ok(schedule.crons.some((cron: {path: string}) => cron.path === '/api/cron/daily-briefings'))
  assert.ok(!cron.includes('processInboundEmail('), 'sweeping must not require a new inbound message')
})

if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log('forwarded email retention: all inert checks passed')
