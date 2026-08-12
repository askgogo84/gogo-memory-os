// Offline unit tests for the lists CAS core (Phase 6).
// Run: node --test lib/data/lists-core.test.mjs
//
// Imports lists-core.ts directly (zero imports → Node v24 loads it via native
// type-stripping). A fake Supabase-shaped db is injected, so no network and no client.
// The whole point of these tests is the compare-and-swap race — a failure mode you
// cannot reliably reproduce by hand.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const core = await import('./lists-core.ts')
const { mutateListItems, ListWriteConflictError, CAS_MAX_ATTEMPTS } = core

// ── Fake db ───────────────────────────────────────────────────────────────────
// Emulates exactly the two chains mutateListItems drives:
//   read:  db.from('lists').select('items, updated_at').eq('id', id).single()
//   write: db.from('lists').update(patch).eq('id', id).eq|is('updated_at', tok).select('id')
//
// `reads` is a queue of { data, error } the successive .single() calls return (the CAS
// re-reads once per attempt). `applyWrite(patch, gate)` decides each write's outcome and
// returns the { data, error } that .select('id') resolves to — data:[{id}] means "won the
// race" (1 row), data:[] means "lost" (0 rows). Every read and write is recorded.
function makeFakeDb({ reads, applyWrite }) {
  const readQueue = [...reads]
  const log = { reads: 0, writes: [] }

  function selectChain() {
    // .select('items, updated_at').eq('id', id).single()
    return {
      eq() {
        return this
      },
      single() {
        log.reads += 1
        const r = readQueue.shift()
        if (!r) throw new Error('fake db: no more reads queued')
        return Promise.resolve(r)
      },
    }
  }

  function updateChain(patch) {
    const gate = {}
    const builder = {
      eq(col, val) {
        // first .eq is ('id', id); a second .eq is the ('updated_at', token) CAS gate
        if (col === 'updated_at') gate.updatedAt = val
        return this
      },
      is(col, val) {
        if (col === 'updated_at') gate.updatedAtIsNull = val === null
        return this
      },
      select() {
        const res = applyWrite(patch, gate)
        log.writes.push({ patch, gate, res })
        return Promise.resolve(res)
      },
    }
    return builder
  }

  return {
    __log: log,
    from() {
      return {
        select: selectChain,
        update: patch => updateChain(patch),
      }
    },
  }
}

const row = (items, updatedAt) => ({ data: { items, updated_at: updatedAt }, error: null })
const item = (text, done = false) => ({ text, done, added_at: `t-${text}` })

// ── CAS win: single attempt, write lands ───────────────────────────────────────
test('CAS win — one read, one write, mutate applied', async () => {
  const db = makeFakeDb({
    reads: [row([item('milk'), item('eggs')], '2026-08-11T10:00:00.000Z')],
    // Token matches → 1 row updated.
    applyWrite: () => ({ data: [{ id: 1 }], error: null }),
  })

  const result = await mutateListItems(db, 1, items =>
    items.map(i => (i.text === 'milk' ? { ...i, done: true } : i)),
  )

  assert.equal(db.__log.reads, 1)
  assert.equal(db.__log.writes.length, 1)
  // The write was gated on the token we read (CAS), not blind.
  assert.equal(db.__log.writes[0].gate.updatedAt, '2026-08-11T10:00:00.000Z')
  assert.deepEqual(
    result.map(i => [i.text, i.done]),
    [['milk', true], ['eggs', false]],
  )
})

// ── CAS lose-then-retry-succeed: first write 0 rows, second wins ────────────────
test('CAS lose then retry — re-reads fresh, applies to the NEW array, second write wins', async () => {
  let writeAttempt = 0
  const db = makeFakeDb({
    reads: [
      // Attempt 1 sees stale token + only milk.
      row([item('milk')], 'TOKEN-A'),
      // A concurrent writer changed the row: new token, and 'bread' was added.
      row([item('milk'), item('bread')], 'TOKEN-B'),
    ],
    applyWrite: (_patch, gate) => {
      writeAttempt += 1
      // First write carried the stale TOKEN-A → 0 rows (lost the race). Second carried
      // the fresh TOKEN-B → 1 row.
      if (gate.updatedAt === 'TOKEN-A') return { data: [], error: null }
      return { data: [{ id: 7 }], error: null }
    },
  })

  // Tick 'milk' done. On retry the mutate must re-run against the FRESH array (which now
  // contains 'bread'), so the winning write must preserve 'bread'.
  const result = await mutateListItems(db, 7, items =>
    items.map(i => (i.text === 'milk' ? { ...i, done: true } : i)),
  )

  assert.equal(db.__log.reads, 2, 're-read once after the lost race')
  assert.equal(writeAttempt, 2, 'wrote twice: lost then won')
  assert.equal(db.__log.writes[0].gate.updatedAt, 'TOKEN-A')
  assert.equal(db.__log.writes[1].gate.updatedAt, 'TOKEN-B')
  // The concurrent 'bread' survives, and 'milk' is ticked — no lost update.
  assert.deepEqual(
    result.map(i => [i.text, i.done]),
    [['milk', true], ['bread', false]],
  )
})

// ── Retries exhausted: every write loses → throw ────────────────────────────────
test('CAS exhausted — CAS_MAX_ATTEMPTS lost races throws ListWriteConflictError', async () => {
  const reads = []
  for (let i = 0; i < CAS_MAX_ATTEMPTS; i++) reads.push(row([item('milk')], `TOKEN-${i}`))
  const db = makeFakeDb({
    reads,
    applyWrite: () => ({ data: [], error: null }), // always 0 rows → perpetual conflict
  })

  await assert.rejects(
    () => mutateListItems(db, 1, items => items.map(i => ({ ...i, done: true }))),
    err => err instanceof ListWriteConflictError,
  )
  assert.equal(db.__log.reads, CAS_MAX_ATTEMPTS, 'read once per attempt')
  assert.equal(db.__log.writes.length, CAS_MAX_ATTEMPTS, 'wrote (and lost) once per attempt')
})

// ── No-op: mutate returns null → no write at all ───────────────────────────────
test('no-op — mutate returns null (item not found) writes nothing and returns current', async () => {
  const db = makeFakeDb({
    reads: [row([item('milk')], 'TOKEN-A')],
    applyWrite: () => {
      throw new Error('must not write on a no-op')
    },
  })

  const result = await mutateListItems(db, 1, () => null)

  assert.equal(db.__log.reads, 1)
  assert.equal(db.__log.writes.length, 0, 'no write issued')
  assert.deepEqual(result.map(i => i.text), ['milk'])
})

// ── Null updated_at token uses .is(null), not .eq(null) ────────────────────────
test('legacy null updated_at — CAS gate uses is(null)', async () => {
  const db = makeFakeDb({
    reads: [row([item('milk')], null)],
    applyWrite: () => ({ data: [{ id: 1 }], error: null }),
  })

  await mutateListItems(db, 1, items => items.map(i => ({ ...i, done: true })))

  assert.equal(db.__log.writes[0].gate.updatedAtIsNull, true)
  assert.equal(db.__log.writes[0].gate.updatedAt, undefined, 'never used eq() for a null token')
})
