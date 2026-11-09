// TEST ONLY / EXPECTED RED — deployed #1084 booking-fact boundary checks.
// This runs pure utilities and a source-extracted in-memory loop; no DB, provider, customer data or sends.
// Do not merge while negative expectations still fail. Ref #274 and #1084 reviews.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bookingNameFrom, addedAsGuest } from '../lib/memory/stay'
import { normCity } from '../lib/memory/life-graph'

let passed = 0
const failed: string[] = []
function check(name: string, run: () => void): void {
  try { run(); passed++; console.log('PASS ' + name) }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failed.push(name + ': ' + message)
    console.error('FAIL ' + name + ': ' + message)
  }
}

// Actual production helper: accepting natural-case names must not consume instructions as names.
check('positive: ordinary booking-name confirmation is extracted', () => {
  assert.equal(bookingNameFrom('Booking is in the name of Aman Chamedia'), 'Aman Chamedia')
})
check('positive: booked under with a following purpose is bounded', () => {
  assert.equal(bookingNameFrom('Room booked under mukesh for 2 nights'), 'Mukesh')
})
check('negative: trailing instruction is not appended to bookedBy', () => {
  assert.equal(
    bookingNameFrom('Booking is in the name of Aman Chamedia please show your ID at reception'),
    'Aman Chamedia',
  )
})
check('negative: another ordinary follow-on sentence does not pollute booking name', () => {
  assert.equal(
    bookingNameFrom('Booking is in the name of Aman Chamedia remember to carry your passport'),
    'Aman Chamedia',
  )
})

// Extract and EXECUTE the unchanged current-source for-loop from ingestStayFromText using inert
// synthetic note objects, not a reimplementation of its filtering logic or any database call.
const source = readFileSync('lib/memory/stay.ts', 'utf8')
const startMarker = 'for (const n of (notes || []) as any[]) {'
const start = source.indexOf(startMarker)
assert.ok(start >= 0, 'locate ACTUAL connected-stay note replay loop')
const open = source.indexOf('{', start)
let level = 0, end = -1
for (let i = open; i < source.length; i++) {
  if (source[i] === '{') level++
  else if (source[i] === '}' && --level === 0) { end = i + 1; break }
}
assert.ok(end > open, 'replay-loop brace boundary must be found')
const loop = source.slice(start, end).replace('as any[]', '')
// Source contains no imports/await/network expressions in this exact isolated loop.
assert.doesNotMatch(loop, /\b(?:await|fetch|supabaseAdmin|eval|require|process)\b/, 'source slice must stay pure')
const evaluateLoop = new Function('notes', 'stay', 'city', 'normCity', 'addedAsGuest', 'bookingNameFrom', loop)

type FakeStay = { city: string; checkIn: string; bookedBy: string; userRole: string }
type FakeNote = { metadata_json: { city: string; tripKey: string; text: string } }
function reapply(stay: FakeStay, notes: FakeNote[]): FakeStay {
  const next = { ...stay }
  evaluateLoop(notes, next, next.city, normCity, addedAsGuest, bookingNameFrom)
  return next
}
const futureStay: FakeStay = {
  city: 'Mumbai', checkIn: '2026-12-10', bookedBy: 'Riya Singh', userRole: 'booker',
}
const currentTripNote: FakeNote = {
  metadata_json: { city: 'Mumbai', tripKey: 'mumbai-2026-10-29', text: 'Booking is in the name of Aman Chamedia' },
}
const currentTripGuestNote: FakeNote = {
  metadata_json: { city: 'Mumbai', tripKey: 'mumbai-2026-10-29', text: 'Have added you as the 2nd guest for check-in' },
}
check('positive: replay of note for the same trip may correct the booker', () => {
  const oldStay: FakeStay = { ...futureStay, checkIn: '2026-10-29', bookedBy: 'Unknown' }
  assert.equal(reapply(oldStay, [currentTripNote]).bookedBy, 'Aman Chamedia')
})
check('positive: a different-city note does not override stay details', () => {
  const note: FakeNote = { metadata_json: { city: 'Kochi', tripKey: 'kochi-2026-10-29', text: currentTripNote.metadata_json.text } }
  assert.deepEqual(reapply(futureStay, [note]), futureStay)
})
check('negative: same-city earlier-trip booker note may not overwrite future stay', () => {
  assert.equal(reapply(futureStay, [currentTripNote]).bookedBy, 'Riya Singh')
})
check('negative: same-city earlier-trip guest note may not falsify future stay role', () => {
  assert.equal(reapply(futureStay, [currentTripGuestNote]).userRole, 'booker')
})
check('positive: no notes leaves the unrelated booking untouched', () => {
  assert.deepEqual(reapply(futureStay, []), futureStay)
})
console.log('Synthetic booking-fact checks: ' + passed + ' passed; ' + failed.length + ' failed')
if (failed.length) {
  console.error('Expected RED on deployed source; these are conditional code-level hazards, not customer incidents.')
  process.exitCode = 1
}
