// Offline unit tests for the usage meter core (Phase 2).
// Run: node --test lib/services/meter.test.mjs
//
// Imports meter-core.ts directly (zero imports → Node v24 loads it via native
// type-stripping). A fake DB is injected, so no network and no Supabase client.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const core = await import('./meter-core.ts')
const {
  MeterUnavailableError,
  getPlan,
  getLimits,
  getUsage,
  checkAllowance,
  recordUsage,
  __resetMeterCacheForTests,
  istDayStartMs,
  nextIstDayStartMs,
  istMonthStartMs,
  nextIstMonthStartMs,
} = core

// ── Fake Supabase client ─────────────────────────────────────────────────────
// Emulates exactly the query chains meter-core uses:
//   .from(t).select(cols[, {count,head}]).eq().gte().limit().maybeSingle()
//   .from(t).insert(row)
// Awaiting the builder (then) resolves like a PostgREST result; maybeSingle()
// returns a single row. `failOn` is a set of "<table>.<op>" keys that error.
function makeFakeDb(seed = {}) {
  const tables = {
    user_plans: [...(seed.user_plans || [])],
    users: [...(seed.users || [])],
    plan_limits: [...(seed.plan_limits || [])],
    usage_events: [...(seed.usage_events || [])],
    friend_contacts: [...(seed.friend_contacts || [])],
  }
  const failOn = new Set(seed.failOn || [])
  const errorFor = seed.errorFor || {} // "<table>.<op>" -> custom error object (e.g. { code:'23505' })

  function cellOf(row, col) {
    if (col === 'meta->>message_id') return row.meta ? row.meta.message_id : undefined
    return row[col]
  }

  function applyFilters(rows, filters) {
    return rows.filter((row) => {
      for (const [type, col, val] of filters) {
        const cell = cellOf(row, col)
        if (type === 'eq') {
          if (String(cell) !== String(val)) return false
        } else if (type === 'gte') {
          if (!(new Date(cell).getTime() >= new Date(val).getTime())) return false
        }
      }
      return true
    })
  }

  async function run(q, mode) {
    const key = `${q.table}.${q.op}`
    if (failOn.has(key)) return { data: null, error: errorFor[key] || { message: `fake failure: ${key}` }, count: null }

    if (q.op === 'insert') {
      for (const r of q.insertRows) tables[q.table].push({ id: `id-${tables[q.table].length + 1}`, ...r })
      return { data: null, error: null }
    }

    let rows = applyFilters(tables[q.table], q.filters)
    if (q._limit != null) rows = rows.slice(0, q._limit)

    if (q.head && q.countMode) return { data: null, error: null, count: rows.length }
    if (mode === 'maybeSingle') return { data: rows[0] || null, error: null }
    return { data: rows, error: null, count: q.countMode ? rows.length : null }
  }

  return {
    _tables: tables,
    from(table) {
      const q = {
        table,
        op: 'select',
        filters: [],
        countMode: null,
        head: false,
        _limit: null,
        insertRows: null,
        select(_cols, opts) {
          this.op = 'select'
          if (opts && opts.count) this.countMode = opts.count
          if (opts && opts.head) this.head = true
          return this
        },
        insert(rows) {
          this.op = 'insert'
          this.insertRows = Array.isArray(rows) ? rows : [rows]
          return this
        },
        eq(col, val) { this.filters.push(['eq', col, val]); return this },
        gte(col, val) { this.filters.push(['gte', col, val]); return this },
        limit(n) { this._limit = n; return this },
        maybeSingle() { return run(this, 'maybeSingle') },
        then(res, rej) { return run(this, 'await').then(res, rej) },
      }
      return q
    },
  }
}

const PLAN_LIMITS = [
  { plan_code: 'free', ai_actions_per_day: 5, documents_per_month: 3, friend_contacts_max: 0, reminders_per_day_fair_use: 20, calendars_max: 0 },
  { plan_code: 'lite', ai_actions_per_day: 25, documents_per_month: 15, friend_contacts_max: 5, reminders_per_day_fair_use: 30, calendars_max: 1 },
  { plan_code: 'starter', ai_actions_per_day: 50, documents_per_month: 40, friend_contacts_max: 10, reminders_per_day_fair_use: 50, calendars_max: 2 },
]

// A fixed "now": 2026-08-05T05:00:00Z = 10:30 IST on 5 Aug 2026.
const NOW = new Date('2026-08-05T05:00:00Z')

// ── IST window helpers (pure) ────────────────────────────────────────────────

test('IST day boundary: same IST day shares a start; crossing IST midnight differs', () => {
  const t1 = Date.parse('2026-08-05T05:00:00Z') // 10:30 IST Aug 5
  const t2 = Date.parse('2026-08-04T19:00:00Z') // 00:30 IST Aug 5 (same IST day)
  const t3 = Date.parse('2026-08-04T18:00:00Z') // 23:30 IST Aug 4 (previous IST day)

  assert.equal(new Date(istDayStartMs(t1)).toISOString(), '2026-08-04T18:30:00.000Z')
  assert.equal(istDayStartMs(t1), istDayStartMs(t2))
  assert.notEqual(istDayStartMs(t1), istDayStartMs(t3))
  assert.equal(new Date(istDayStartMs(t3)).toISOString(), '2026-08-03T18:30:00.000Z')
  assert.equal(nextIstDayStartMs(t1) - istDayStartMs(t1), 24 * 60 * 60 * 1000)
})

test('IST month boundary: month start is the 1st at 00:00 IST', () => {
  const t = Date.parse('2026-08-05T05:00:00Z')
  assert.equal(new Date(istMonthStartMs(t)).toISOString(), '2026-07-31T18:30:00.000Z') // 1 Aug 00:00 IST
  assert.equal(new Date(nextIstMonthStartMs(t)).toISOString(), '2026-08-31T18:30:00.000Z') // 1 Sep 00:00 IST
})

test('IST month rollover: December rolls to January of the next year', () => {
  const tDec = Date.parse('2026-12-15T00:00:00Z') // 05:30 IST Dec 15 2026
  assert.equal(new Date(istMonthStartMs(tDec)).toISOString(), '2026-11-30T18:30:00.000Z') // 1 Dec 00:00 IST
  assert.equal(new Date(nextIstMonthStartMs(tDec)).toISOString(), '2026-12-31T18:30:00.000Z') // 1 Jan 2027 00:00 IST
})

// ── Plan resolution ──────────────────────────────────────────────────────────

test('missing user_plans row and no users.tier defaults to free', async () => {
  __resetMeterCacheForTests()
  const db = makeFakeDb({ plan_limits: PLAN_LIMITS })
  const plan = await getPlan(db, '12345')
  assert.equal(plan.plan_code, 'free')

  const limits = await getLimits(db, plan.plan_code)
  assert.equal(limits.ai_actions_per_day, 5)
})

test('no user_plans row but users.tier=lite resolves to lite limits, not free', async () => {
  __resetMeterCacheForTests()
  const db = makeFakeDb({
    plan_limits: PLAN_LIMITS,
    users: [{ telegram_id: 918310441698, tier: 'lite' }], // real paying user, no telegram_id-based plan row
  })
  const plan = await getPlan(db, '918310441698')
  assert.equal(plan.plan_code, 'lite')

  const check = await checkAllowance(db, '918310441698', 'ai_action', NOW)
  assert.equal(check.limit, 25) // lite, NOT the free 5
  assert.equal(check.allowed, true)
})

test('user_plans row wins over users.tier', async () => {
  __resetMeterCacheForTests()
  const db = makeFakeDb({
    plan_limits: PLAN_LIMITS,
    user_plans: [{ telegram_id: '777', plan_code: 'starter', status: 'active' }],
    users: [{ telegram_id: 777, tier: 'lite' }],
  })
  const plan = await getPlan(db, '777')
  assert.equal(plan.plan_code, 'starter')
})

test('getLimits falls back to free for an unmapped plan_code', async () => {
  __resetMeterCacheForTests()
  const db = makeFakeDb({ plan_limits: PLAN_LIMITS })
  const limits = await getLimits(db, 'some_unknown_tier')
  assert.equal(limits.ai_actions_per_day, 5) // free row
})

// ── Allowance: exactly reached vs exceeded ───────────────────────────────────

function aiRows(tid, n, createdAtIso) {
  return Array.from({ length: n }, (_, i) => ({
    id: `u-${i}`,
    telegram_id: tid,
    counter: 'ai_action',
    action: 'ask',
    created_at: createdAtIso,
  }))
}

test('limit exactly reached is not allowed; one under is allowed', async () => {
  __resetMeterCacheForTests()
  const withinWindow = NOW.toISOString() // inside today's IST window

  const atLimit = makeFakeDb({ plan_limits: PLAN_LIMITS, usage_events: aiRows('12345', 5, withinWindow) })
  const r1 = await checkAllowance(atLimit, '12345', 'ai_action', NOW)
  assert.deepEqual({ allowed: r1.allowed, used: r1.used, limit: r1.limit }, { allowed: false, used: 5, limit: 5 })

  const underLimit = makeFakeDb({ plan_limits: PLAN_LIMITS, usage_events: aiRows('12345', 4, withinWindow) })
  const r2 = await checkAllowance(underLimit, '12345', 'ai_action', NOW)
  assert.deepEqual({ allowed: r2.allowed, used: r2.used, limit: r2.limit }, { allowed: true, used: 4, limit: 5 })
})

test('usage before the IST day start does not count toward today', async () => {
  __resetMeterCacheForTests()
  const yesterday = '2026-08-04T17:00:00Z' // 22:30 IST Aug 4 — previous IST day
  const db = makeFakeDb({ plan_limits: PLAN_LIMITS, usage_events: aiRows('12345', 5, yesterday) })
  const r = await checkAllowance(db, '12345', 'ai_action', NOW)
  assert.equal(r.used, 0)
  assert.equal(r.allowed, true)
  assert.equal(r.resets, new Date(nextIstDayStartMs(NOW.getTime())).toISOString())
})

test('friend_contacts allowance counts contacts and never resets', async () => {
  __resetMeterCacheForTests()
  const db = makeFakeDb({
    plan_limits: PLAN_LIMITS,
    users: [{ telegram_id: 42, tier: 'lite' }], // lite: friend_contacts_max = 5
    friend_contacts: [
      { owner_telegram_id: 42, name: 'a', whatsapp_id: '+91111' },
      { owner_telegram_id: 42, name: 'b', whatsapp_id: '+91222' },
    ],
  })
  const r = await checkAllowance(db, '42', 'friend_contacts', NOW)
  assert.deepEqual({ allowed: r.allowed, used: r.used, limit: r.limit, resets: r.resets }, { allowed: true, used: 2, limit: 5, resets: null })
})

test('getUsage returns all three counters', async () => {
  __resetMeterCacheForTests()
  const db = makeFakeDb({
    plan_limits: PLAN_LIMITS,
    usage_events: [
      ...aiRows('42', 3, NOW.toISOString()),
      { id: 'd1', telegram_id: '42', counter: 'document', action: 'ticket_parse', created_at: NOW.toISOString() },
    ],
    friend_contacts: [{ owner_telegram_id: 42, name: 'a', whatsapp_id: '+91111' }],
  })
  const usage = await getUsage(db, '42', NOW)
  assert.deepEqual(usage, { aiToday: 3, docsThisMonth: 1, friendContacts: 1 })
})

// ── Fail closed ──────────────────────────────────────────────────────────────

test('checkAllowance throws MeterUnavailableError when the count query errors', async () => {
  __resetMeterCacheForTests()
  const db = makeFakeDb({ plan_limits: PLAN_LIMITS, failOn: ['usage_events.select'] })
  await assert.rejects(() => checkAllowance(db, '12345', 'ai_action', NOW), MeterUnavailableError)
})

test('getPlan throws MeterUnavailableError when user_plans query errors', async () => {
  __resetMeterCacheForTests()
  const db = makeFakeDb({ plan_limits: PLAN_LIMITS, failOn: ['user_plans.select'] })
  await assert.rejects(() => getPlan(db, '12345'), MeterUnavailableError)
})

// ── recordUsage: never throws + idempotent ───────────────────────────────────

test('recordUsage never throws and reports error when insert fails', async () => {
  const db = makeFakeDb({ failOn: ['usage_events.insert'] })
  const res = await recordUsage(db, '12345', 'ai_action', 'ask', { message_id: 'm1' })
  assert.deepEqual(res, { recorded: false, error: true })
  assert.equal(db._tables.usage_events.length, 0)
})

test('same-message double record is idempotent on (telegram_id, counter, message_id)', async () => {
  const db = makeFakeDb({})
  const first = await recordUsage(db, '12345', 'ai_action', 'ask', { message_id: 'm1' })
  assert.equal(first.recorded, true)
  assert.equal(db._tables.usage_events.length, 1)

  const second = await recordUsage(db, '12345', 'ai_action', 'web_search', { message_id: 'm1' })
  assert.deepEqual(second, { recorded: false, duplicate: true })
  assert.equal(db._tables.usage_events.length, 1) // still one — deduped
})

test('insert conflict (Postgres 23505) is a benign no-op: deduped, no throw, no USAGE_RECORD_FAILED', async () => {
  // Empty usage_events → the read-then-insert fast path finds nothing, proceeds
  // to insert, and the partial unique index raises 23505 (a race backstop).
  const db = makeFakeDb({
    failOn: ['usage_events.insert'],
    errorFor: { 'usage_events.insert': { code: '23505', message: 'duplicate key value violates unique constraint' } },
  })
  const errors = []
  const origError = console.error
  console.error = (msg) => errors.push(String(msg))
  let res
  try {
    res = await recordUsage(db, '12345', 'ai_action', 'ask', { message_id: 'm3' })
  } finally {
    console.error = origError
  }
  assert.deepEqual(res, { recorded: false, deduped: true })
  assert.equal(errors.some((e) => e.includes('USAGE_RECORD_FAILED')), false)
})

test('getLimits logs PLAN_CODE_UNMAPPED when falling back to free', async () => {
  __resetMeterCacheForTests()
  const db = makeFakeDb({ plan_limits: PLAN_LIMITS })
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => warnings.push(String(msg))
  try {
    const limits = await getLimits(db, 'mystery_tier')
    assert.equal(limits.ai_actions_per_day, 5)
  } finally {
    console.warn = origWarn
  }
  assert.equal(warnings.some((w) => w.includes('PLAN_CODE_UNMAPPED') && w.includes('mystery_tier')), true)
})

test('a different counter for the same message records separately', async () => {
  const db = makeFakeDb({})
  await recordUsage(db, '12345', 'ai_action', 'image_classify', { message_id: 'm2' })
  await recordUsage(db, '12345', 'document', 'ticket_parse', { message_id: 'm2' })
  assert.equal(db._tables.usage_events.length, 2) // one per counter
})

test('missing message_id still inserts and logs METER_NO_MESSAGE_ID', async () => {
  const db = makeFakeDb({})
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => warnings.push(String(msg))
  try {
    const res = await recordUsage(db, '12345', 'ai_action', 'ask', {})
    assert.equal(res.recorded, true)
  } finally {
    console.warn = origWarn
  }
  assert.equal(db._tables.usage_events.length, 1)
  assert.equal(warnings.some((w) => w.includes('METER_NO_MESSAGE_ID') && w.includes('ask')), true)
})
