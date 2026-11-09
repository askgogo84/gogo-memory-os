/**
 * TEST ONLY. Expected RED on deployed #1079 source; DO NOT MERGE while failing.
 * Exercises the real hotel-stay module under completely inert DB/life-graph transports.
 * No real users, database, provider calls, reminders or delivery effects.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Stored = { telegram_id: string; dedupe_key: string; metadata_json: any; [key: string]: unknown }
const stored = new Map<string, Stored>()
let selects = 0
let upserts = 0
const supabaseAdmin = {
  from(table: string) {
    assert.equal(table, 'life_events', 'No non-stay table may be queried in this fixture')
    const predicates: Record<string, string> = {}
    const query: any = {
      select() { selects++; return query },
      eq(key: string, value: unknown) { predicates[key] = String(value); return query },
      async maybeSingle() {
        const row = stored.get(predicates.telegram_id + '|' + predicates.dedupe_key)
        return { data: row ? { id: 'fixture-row', metadata_json: row.metadata_json } : null, error: null }
      },
      async upsert(row: Stored, opts: { onConflict: string }) {
        assert.equal(opts.onConflict, 'telegram_id,dedupe_key')
        upserts++
        stored.set(row.telegram_id + '|' + row.dedupe_key, row)
        return { error: null }
      },
    }
    return query
  },
}
const source = readFileSync('lib/memory/stay.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const mod: any = { exports: {} }
runInNewContext(compiled, {
  module: mod, exports: mod.exports, Date, Intl, AbortSignal, console,
  require(name: string) {
    if (name === '@/lib/supabase-admin') return { supabaseAdmin }
    if (name === './life-graph') return {
      normCity: (city: unknown) => String(city || '').trim().toLowerCase(),
      loadTrips: async () => [], tripFor: () => null, arrivalLeg: () => null,
    }
    throw Error('Unexpected dependency ' + name)
  },
}, { filename: 'stay-inert-fixture.cjs', timeout: 5000 })

const makeStay = (update: Record<string, unknown> = {}) => ({
  hotel: 'Four Seasons', city: 'Mumbai', checkIn: '2026-10-29',
  checkOut: '2026-10-30', checkInTime: null, bookingRef: 'RES-001',
  bookedBy: 'Synthetic Booker', guests: ['Synthetic Guest'],
  userRole: 'guest', isRequest: false, address: null, ...update,
})
const failures: string[] = []
async function check(label: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('PASS ' + label) }
  catch (error) { const details = error instanceof Error ? error.message : String(error)
    failures.push(label + ': ' + details); console.error('FAIL ' + label + ': ' + details) }
}

const first = makeStay()
const second = makeStay({
  checkIn: '2026-12-29', checkOut: '2026-12-30', bookingRef: 'RES-002',
})
await check('two distinct dated same-hotel reservations have different durable dedupe identities', () => {
  assert.notEqual(mod.exports.stayDedupeKey(first), mod.exports.stayDedupeKey(second),
    'hotel+city-only key merges distinct dated booking references')
})
await check('inert upsert retains both distinct stays for one owner', async () => {
  assert.ok(await mod.exports.saveStay('123', first, { kind: 'synthetic' }))
  assert.ok(await mod.exports.saveStay('123', second, { kind: 'synthetic' }))
  assert.equal(stored.size, 2, 'second real saveStay upsert must not overwrite first dated reservation')
})
await check('initial guest-add request stays pending before hotel confirmation', () => {
  const request = makeStay({ isRequest: true })
  const merged = mod.exports.mergeStay(null, request)
  assert.equal(merged.isRequest, true, 'first request currently loses pending status')
  const reply = mod.exports.stayReply(merged, null)
  assert.match(reply, /has asked the hotel to add you/i,
    'must not render an unconfirmed guest-add request as confirmed')
})
assert.ok(selects > 0 && upserts === 2, 'fixture must exercise actual safe upsert path')
assert.equal(failures.length, 0,
  'Known deployed #1079 P1/P2 regressions are intentionally RED until Claude-owned source correction: ' + failures.join('; '))
console.log('PASS stay isolation negative fixture: no network, DB, reminders, provider, or customer effects')
