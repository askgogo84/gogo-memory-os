// R02 (22 Oct live): near-duplicate gold watches collapse, a same-subject create reuses the active watch, and a
// watch whose own date passed is retired by the cron. Pure helpers plus the real create/sweep paths against an
// in-memory, owner-checking Supabase stub.
// Run: npx --yes tsx scripts/verify-r02-watch-dedupe.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import crypto from 'node:crypto'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://state-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'

const dedupe = await import('../lib/agent/watch-dedupe')
const quality = await import('../lib/agent/watcher-quality')
const { planWatchCleanup, matchingActiveWatches, watchSubject, watchDatePassed, flightSubjectOf, sameWatchSubject } = dedupe

const NOW = new Date('2026-10-22T09:00:00Z')
const OWNER = '123', OTHER = '999'
const goldRule = (karat: string, threshold: number) => ({ metal: 'gold', karat, direction: 'down', mode: 'absolute', value: threshold, baselinePerGram: 7200, thresholdPerGram: threshold, place: 'Bengaluru', baselineSource: null, baselineDate: '2026-10-05' })
const ws = (id: string, condition: any, created: string, owner = OWNER) => ({ id, telegram_id: owner, type: 'web_search', created_at: created, condition_json: condition, last_state_json: { quietChecks: 3 } })

// ---- Pure: subjects
const goldA = ws('g1', { title: 'gold rate', query: 'gold rate' }, '2026-10-01T00:00:00Z')
const goldB = ws('g2', { title: 'Gold price below ₹6,900/g', query: '24K gold rate Bengaluru per gram', goldRule: goldRule('24', 6900), originalRequest: 'alert me if 24k gold drops below 6900 starting 5 Oct' }, '2026-10-10T00:00:00Z')
const goldC = ws('g3', { title: 'watch gold', query: 'watch gold' }, '2026-10-20T00:00:00Z')
assert.equal(watchSubject(goldA)?.key, 'gold:price')
assert.equal(watchSubject(goldC)?.key, 'gold:price', 'a bare "watch gold" is a gold-price watch')
assert.equal(watchSubject(goldB)?.karat, '24')
assert.equal(watchSubject(ws('x', { title: 'gold loan rates', query: 'gold loan interest rates' }, ''))?.key.startsWith('gold'), false, 'gold loans are not the gold price')
assert.equal(sameWatchSubject(ws('a', { title: '22K gold rate', query: '22K gold rate' }, ''), ws('b', { title: '24K gold rate', query: '24K gold rate' }, '')), false, '22K and 24K stay separate')
assert.equal(sameWatchSubject(ws('a', { title: 'iPhone 15 price', query: 'iPhone 15 price' }, ''), ws('b', { title: 'iPhone 16 price', query: 'iPhone 16 price' }, '')), false, 'model numbers survive normalisation')
assert.equal(sameWatchSubject(ws('a', { title: 'iPhone 16 below ₹70,000', query: 'iPhone 16 price below ₹70,000' }, ''), ws('b', { title: 'iPhone 16 under 65000', query: 'iPhone 16 under 65000' }, '')), true, 'only the money threshold differs')
assert.equal(flightSubjectOf('AT 9 flight status on 27 September'), 'at9')
assert.equal(flightSubjectOf('flight 6E 512 delay'), '6e512')
assert.equal(flightSubjectOf('gold rate at 9 am'), null, 'no flight context, no flight subject')
const flightOld = ws('f1', { title: 'AT 9 flight status 27 September', query: 'AT 9 flight status 27 September' }, '2026-09-20T00:00:00Z')
const flightOther = ws('f2', { title: 'AT 9 flight status 30 October', query: 'AT 9 flight status 30 October' }, '2026-10-15T00:00:00Z')
assert.equal(sameWatchSubject(flightOld, flightOther), false, 'same flight on another date is another watch')
console.log('✓ subjects: gold karat, flight number + date, money-stripped queries')

// ---- Pure: date passed
assert.equal(watchDatePassed(flightOld, NOW).passed, true, 'a 27 Sep flight watch is over on 22 Oct')
assert.equal(watchDatePassed(flightOther, NOW).passed, false)
assert.equal(watchDatePassed(goldB, NOW).passed, false, 'a gold threshold is evergreen even when its wording carries a date')
assert.equal(watchDatePassed({ id: 'p', telegram_id: OWNER, type: 'product_stock', condition_json: { title: 'Shoes', productUrl: 'https://shop.example/p', variant: 'UK 9', expiresAt: '2026-10-01T00:00:00Z' } }, NOW).passed, true, 'explicit expiry retires any type')
assert.equal(watchDatePassed(ws('c', { contextual: true, contextualKind: 'travel', title: 'Flight 27 Sep', query: 'AT 9 27 Sep', expiresAt: '2026-09-28T00:00:00Z' }, ''), NOW).passed, false, 'contextual travel watches keep their own expiry path')
console.log('✓ date-passed: flight/event dates and expiries, never gold/price thresholds')

// ---- Pure: cleanup plan (idempotent, owner-separated)
const otherOwnerGold = ws('o1', { title: 'gold rate', query: 'gold rate' }, '2026-10-21T00:00:00Z', OTHER)
const unrelated = ws('u1', { title: 'Coldplay Mumbai tickets', query: 'Coldplay Mumbai tickets' }, '2026-10-02T00:00:00Z')
const plan = planWatchCleanup([goldA, goldB, goldC, flightOld, flightOther, otherOwnerGold, unrelated], NOW)
const byId = Object.fromEntries(plan.map(p => [p.id, p]))
assert.equal(byId.f1?.reason, 'date_passed')
assert.equal(byId.g1?.reason, 'duplicate'); assert.equal(byId.g1?.keptId, 'g2', 'keeps the most specific (the rule), not just the newest')
assert.equal(byId.g3?.reason, 'duplicate'); assert.equal(byId.g3?.keptId, 'g2')
assert.equal(byId.g2, undefined); assert.equal(byId.f2, undefined); assert.equal(byId.u1, undefined)
assert.equal(byId.o1, undefined, "another owner's watch never collapses into this owner's")
assert.equal(plan.length, 3)
const survivors = [goldB, flightOther, otherOwnerGold, unrelated]
assert.deepEqual(planWatchCleanup(survivors, NOW), [], 'second run plans nothing: idempotent')
// Newest wins when equally specific.
const twin = planWatchCleanup([ws('n1', { title: 'gold rate', query: 'gold rate' }, '2026-10-01T00:00:00Z'), ws('n2', { title: 'gold price', query: 'gold price today' }, '2026-10-03T00:00:00Z')], NOW)
assert.deepEqual(twin.map(p => [p.id, p.keptId]), [['n1', 'n2']])
assert.equal(matchingActiveWatches([goldA, goldB, goldC], { type: 'web_search', condition_json: { title: 'Gold rate: 24K below ₹6,800/g', query: '24K gold rate', goldRule: goldRule('24', 6800) } }, NOW)[0]?.id, 'g2')
console.log('✓ cleanup plan: keeper = most specific then newest, owner-scoped, idempotent')

// ---- Real watchers.ts create + sweep against an owner-checking stub
type Row = Record<string, any>
const table: Row[] = []
const activity: Row[] = []
const writes: Array<{ op: string; filters: Array<[string, string, any]> }> = []
let seq = 0
function makeDb() {
  return {
    from(name: string) {
      const b: any = { _f: [] as Array<[string, string, any]>, _ins: null as Row | null, _upd: null as Row | null }
      const match = () => table.filter(r => b._f.every(([op, col, val]: any) => op === 'eq' ? String(r[col]) === String(val) : op === 'in' ? (val as any[]).map(String).includes(String(r[col])) : true))
      const run = () => {
        if (name === 'agent_activity') { if (b._ins) activity.push(b._ins); return { data: null, error: null } }
        if (b._ins) { const row = { id: `new${++seq}`, created_at: NOW.toISOString(), ...b._ins }; table.push(row); writes.push({ op: 'insert', filters: [] }); return { data: [row], error: null } }
        if (b._upd) {
          writes.push({ op: 'update', filters: b._f })
          assert.ok(b._f.some(([op, col]: any) => op === 'eq' && col === 'telegram_id'), 'every watcher write is owner-scoped')
          const rows = match(); for (const r of rows) Object.assign(r, b._upd); return { data: rows, error: null }
        }
        return { data: match(), error: null }
      }
      Object.assign(b, {
        select() { return b }, eq(c: string, v: any) { b._f.push(['eq', c, v]); return b }, in(c: string, v: any[]) { b._f.push(['in', c, v]); return b },
        order() { return b }, limit() { return b }, lte() { return b },
        insert(row: Row) { b._ins = row; return b }, update(row: Row) { b._upd = row; return b },
        single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: null } },
        maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: null } },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      })
      return b
    },
  }
}
const db = makeDb()
const src = readFileSync('lib/agent/watchers.ts', 'utf8')
const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
const mocks: Record<string, any> = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  './watch-dedupe': dedupe,
  './watcher-quality': quality,
  './price-threshold': await import('../lib/agent/price-threshold'),
  './gold-rate-rule': await import('../lib/agent/gold-rate-rule'),
  'node:crypto': crypto,
}
const exp: any = {}
runInNewContext(out, { exports: exp, module: { exports: exp }, require: (n: string) => mocks[n] || {}, console: { log() {}, error() {} }, Date, URL, Buffer, Promise, Map, Set, JSON, Math, Number, String, Array, Object })

table.push(...[goldA, goldB, goldC, flightOld, flightOther, otherOwnerGold, unrelated].map(r => ({ ...r, active: true, condition_json: { ...r.condition_json } })))

// (a) creating "Gold rate: 24K below ₹6,800/g" updates the 24K rule watch, retires the two vague ones, inserts nothing.
const before = table.length
const created = await exp.createWebSearchWatcher({ telegramId: OWNER, condition: { title: 'Gold rate: 24K below ₹6,800/g', query: '24K gold rate Bengaluru per gram', triggerKeywords: [], delivery: 'both', cadenceMinutes: 360, goldRule: goldRule('24', 6800) } })
assert.equal(table.length, before, 'no new row for a same-subject watch')
assert.equal(created.id, 'g2'); assert.equal(created.reused, true); assert.equal(created.updated, true)
const g2 = table.find(r => r.id === 'g2')!
assert.equal(g2.condition_json.goldRule.thresholdPerGram, 6800, 'the existing watch now carries the new rule')
assert.deepEqual(JSON.parse(JSON.stringify(g2.last_state_json)), { quietChecks: 0, seenUrls: [], seenSignatures: [], alertTimes: [] }, 'state resets with the new rule')
for (const id of ['g1', 'g3']) {
  const r = table.find(x => x.id === id)!
  assert.equal(r.active, false, `${id} retired`); assert.equal(r.last_state_json.retiredReason, 'duplicate'); assert.equal(r.last_state_json.keptWatcherId, 'g2')
}
assert.equal(table.find(r => r.id === 'o1')!.active, true, "other owner's gold watch untouched")
assert.match(dedupe.reusedWatchText(true, '24K gold rate'), /^You already have this watch — I updated it/)

// A vaguer repeat keeps the rule rather than overwriting it.
const vague = await exp.createWebSearchWatcher({ telegramId: OWNER, condition: { title: 'gold rate', query: 'gold rate today', triggerKeywords: [], delivery: 'both', cadenceMinutes: 60 } })
assert.equal(vague.id, 'g2'); assert.equal(vague.updated, false)
assert.equal(table.find(r => r.id === 'g2')!.condition_json.goldRule.thresholdPerGram, 6800, 'a vague request never drops the numeric rule')

// A different subject still inserts.
const fresh = await exp.createWebSearchWatcher({ telegramId: OWNER, condition: { title: 'Pixel 10 price', query: 'Pixel 10 price', triggerKeywords: [], delivery: 'both', cadenceMinutes: 60 } })
assert.equal(fresh.reused, undefined); assert.equal(table.length, before + 1)
console.log('✓ create: same subject updates the existing watch and retires extra duplicates; new subjects insert')

// (b) + (c) the cron sweep retires the passed flight watch and is idempotent.
table.push({ ...ws('g4', { title: 'gold rate', query: 'gold rate' }, '2026-10-21T12:00:00Z'), active: true })
const sweep = await exp.reconcileStaleAndDuplicateWatchers(NOW)
assert.equal(sweep.datePassed, 1); assert.equal(sweep.duplicates, 1); assert.equal(sweep.retired, 2)
const f1 = table.find(r => r.id === 'f1')!
assert.equal(f1.active, false); assert.equal(f1.next_check_at, null); assert.equal(f1.last_state_json.retiredReason, 'date_passed'); assert.match(f1.last_state_json.retiredLabel, /has passed/)
assert.equal(table.find(r => r.id === 'g4')!.active, false, 'a duplicate made after the fix is collapsed by the sweep')
assert.equal(table.find(r => r.id === 'f2')!.active, true)
const again = await exp.reconcileStaleAndDuplicateWatchers(NOW)
assert.equal(again.retired, 0, 'second sweep is a no-op')
assert.ok(activity.some(a => /date passed/i.test(a.message)), 'retirement is written to activity')
assert.ok(writes.filter(w => w.op === 'update').every(w => w.filters.some(([, c]) => c === 'telegram_id')))
assert.match(src, /reconcileStaleAndDuplicateWatchers\(now\)/, 'processDueAgentWatchers runs the sweep')
console.log('✓ cron sweep: retires date-passed watches with a reason, collapses duplicates, idempotent, owner-scoped')

console.log('R02_WATCH_DEDUPE_OK')
