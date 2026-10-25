// Offline unit tests for the wall-clock ↔ UTC helper (Phase 6).
// Run: node --test lib/dashboard/wall-time.test.mjs
//
// Imports wall-time.ts directly (zero imports → Node v24 type-stripping). Pure Intl/Date
// maths — no network, no clock dependence (every case passes an explicit instant).

import { test } from 'node:test'
import assert from 'node:assert/strict'

const wt = await import('./wall-time.ts')
const { zoneOffsetMs, todayInTz, wallTimeToUtcIso } = wt

// ── zoneOffsetMs ───────────────────────────────────────────────────────────────
test('zoneOffsetMs — IST is a fixed +5:30 (no DST)', () => {
  const at = new Date('2026-08-11T00:00:00.000Z')
  assert.equal(zoneOffsetMs('Asia/Kolkata', at), 5.5 * 60 * 60 * 1000)
})

test('zoneOffsetMs — UTC is zero', () => {
  assert.equal(zoneOffsetMs('UTC', new Date('2026-08-11T00:00:00.000Z')), 0)
})

test('zoneOffsetMs — New York is -4h in August (EDT)', () => {
  const at = new Date('2026-08-11T12:00:00.000Z')
  assert.equal(zoneOffsetMs('America/New_York', at), -4 * 60 * 60 * 1000)
})

// ── wallTimeToUtcIso ─────────────────────────────────────────────────────────
test('wallTimeToUtcIso — 20:00 IST → 14:30 UTC same date', () => {
  // 8:00 pm in Kolkata on 2026-08-11 is 14:30 UTC (−5:30).
  assert.equal(wallTimeToUtcIso('Asia/Kolkata', 2026, 8, 11, 20, 0), '2026-08-11T14:30:00.000Z')
})

test('wallTimeToUtcIso — 00:30 IST → previous UTC day (date rolls back)', () => {
  // 12:30 am IST on the 11th is 19:00 UTC on the 10th — the roll-back is the whole
  // reason we convert under the real zone instead of trusting the device.
  assert.equal(wallTimeToUtcIso('Asia/Kolkata', 2026, 8, 11, 0, 30), '2026-08-10T19:00:00.000Z')
})

test('wallTimeToUtcIso — UTC zone is identity', () => {
  assert.equal(wallTimeToUtcIso('UTC', 2026, 8, 11, 9, 15), '2026-08-11T09:15:00.000Z')
})

test('wallTimeToUtcIso — 09:00 New York (EDT) → 13:00 UTC', () => {
  assert.equal(wallTimeToUtcIso('America/New_York', 2026, 8, 11, 9, 0), '2026-08-11T13:00:00.000Z')
})

// A round-trip sanity check: converting a wall time to UTC and reading it back in the
// same zone must reproduce the original wall clock.
test('wallTimeToUtcIso — round-trips back to the same wall clock in-zone', () => {
  const iso = wallTimeToUtcIso('Asia/Kolkata', 2026, 8, 11, 20, 0)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const hh = parts.find(p => p.type === 'hour').value
  const mm = parts.find(p => p.type === 'minute').value
  assert.equal(`${hh}:${mm}`, '20:00')
})

// ── todayInTz ─────────────────────────────────────────────────────────────────
test('todayInTz — reads the civil date in-zone for a fixed instant', () => {
  // 23:00 UTC on the 10th is already the 11th in IST (04:30) — todayInTz must return
  // the IST civil date, not the UTC one.
  const at = new Date('2026-08-10T23:00:00.000Z')
  assert.deepEqual(todayInTz('Asia/Kolkata', at), { y: 2026, mo: 8, d: 11 })
  assert.deepEqual(todayInTz('UTC', at), { y: 2026, mo: 8, d: 10 })
})
