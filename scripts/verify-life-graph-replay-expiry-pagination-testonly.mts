// TEST ONLY / EXPECTED RED — DO NOT MERGE, DEPLOY OR USE AS PRODUCTION ACCEPTANCE.
// Synthetic regression for three independently reviewed #1092 life-graph P2 defects.
// The ACTUAL TypeScript module is transpiled and executed in a closed Node VM with
// fake Supabase/calendar imports. No production imports, network, DB, provider or secrets.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const file = 'lib/memory/life-graph.ts'
const source = readFileSync(file, 'utf8')
const fixedNow = Date.parse('2026-10-29T00:00:00.000Z')
let documentReads = 0
let calendarCalls = 0
const documentRows = [
  { doc_type: 'passport', title: 'Synthetic old passport', expires_on: null, extracted: { userLabel: 'Example passport', fields: { name: 'Taylor Example', expiry_date: '2023-05-01' } } },
  { doc_type: 'passport', title: 'Synthetic old normalized', expires_on: '2022-05-01', extracted: { userLabel: 'Old normalized', fields: { name: 'Taylor Example' } } },
  { doc_type: 'passport', title: 'Synthetic future normalized', expires_on: '2030-05-01', extracted: { userLabel: 'Future normalized', fields: { name: 'Taylor Example' } } },
]
const fakeDb = {
  from(name: string) {
    assert.equal(name, 'documents', 'no table other than the synthetic documents read may be requested')
    documentReads++
    return {
      select(_columns: string) { return this },
      eq(column: string, owner: unknown) { assert.equal(column, 'telegram_id'); assert.equal(owner, 444); return this },
      in(column: string, values: string[]) { assert.equal(column, 'doc_type'); assert.ok(values.includes('passport')); return this },
      order(_column: string, _opts: unknown) { return this },
      limit(_n: number) { return Promise.resolve({ data: documentRows }) },
    }
  },
}
const allCalendarEvents: any[] = []
for (let i = 0; i < 36; i++) {
  const dateTime = new Date(Date.parse('2026-11-01T06:00:00Z') + i * 7 * 60 * 60_000).toISOString()
  allCalendarEvents.push({ id: 'early-' + i, summary: 'Synthetic early calendar event ' + i, start: { dateTime }, location: 'Mumbai' })
}
allCalendarEvents.push({ id: 'late-trip-meeting', summary: 'Synthetic later trip business meeting', start: { dateTime: '2026-11-20T12:00:00Z' }, location: 'Pune' })
const fakeCalendar = {
  async getAllCalendarAccountAccess(_owner: unknown) { return [{ id: 'synthetic-calendar' }] },
  async fetchMergedCalendarEventsPage(_accounts: unknown, from: string, until: string, _errorTag: string, limit: number) {
    calendarCalls++
    assert.ok(limit > 0 && limit <= 60, 'bounded synthetic calendar read')
    const matching = allCalendarEvents.filter(e => e.start.dateTime >= from && e.start.dateTime <= until)
    return { events: matching.slice(0, limit), hasMore: matching.length > limit, nextPageToken: matching.length > limit ? 'synthetic-next-page' : null }
  },
}
const compiled = ts.transpileModule(source, {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  reportDiagnostics: true,
})
const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
assert.equal(errors.length, 0, 'original module must transpile before its behavior is tested')
const mod: any = { exports: {} }
const fakeRequire = (spec: string) => {
  if (spec === '@/lib/supabase-admin') return { supabaseAdmin: fakeDb }
  if (spec === './names') return { labelNameMismatch: () => false }
  if (spec === '@/lib/services/google-calendar-accounts') return fakeCalendar
  throw new Error('Unexpected import/network boundary: ' + spec)
}
vm.runInNewContext(compiled.outputText, {
  module: mod, exports: mod.exports, require: fakeRequire, console,
  Date, Intl, Promise, setTimeout, clearTimeout,
}, { filename: 'transpiled-actual-life-graph.js', timeout: 4000 })
const graph: any = mod.exports
for (const name of ['applyTripNotes', 'loadTravelDocs', 'loadTripCalendar', 'travelDocLines']) {
  assert.equal(typeof graph[name], 'function', 'executing actual exported function: ' + name)
}

const outcomes: { name: string; ok: boolean; error?: string }[] = []
async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn()
    outcomes.push({ name, ok: true })
    console.log('PASS ' + name)
  } catch (e: any) {
    outcomes.push({ name, ok: false, error: e?.message || String(e) })
    console.error('FAIL ' + name + ': ' + (e?.message || String(e)))
  }
}
function item(kind: string, id: string, meta: Record<string, any>, startAt: string) {
  return { id, kind, title: kind === 'stay' ? 'Example Hotel' : String(meta.text || 'Note'), city: 'Mumbai', fromCity: null, startAt, endAt: null, ref: null, meta }
}
function tripWithNote(existing: string) {
  const stay = item('stay', 'synthetic-stay', { hotel: 'Example Hotel', bookedBy: existing, arrangedBy: 'Casey Example', bookedByUpdatedAt: '2026-10-28T14:00:00Z' }, '2026-10-29T08:00:00Z')
  const note = item('note', 'synthetic-old-note', { city: 'Mumbai', text: 'Booking is in the name of Alex Reed' }, '2026-10-27T09:00:00Z')
  const trip = { key: 'trip:mumbai:2026-10-29', city: 'Mumbai', startAt: '2026-10-27T09:00:00Z', endAt: '2026-10-31T09:00:00Z', items: [stay, note] }
  return { trip, stay }
}
function travelTrip(city: string, startAt: string, endAt: string) {
  return { key: 'trip:' + city.toLowerCase() + ':' + startAt.slice(0, 10), city, startAt, endAt, items: [] }
}

await check('CONTROL: a still-unapplied booking name note enriches an original stay', () => {
  const { trip, stay } = tripWithNote('Casey Example')
  graph.applyTripNotes([trip])
  assert.equal(stay.meta.bookedBy, 'Alex Reed')
})
await check('P2 RED: older booking-name note cannot overwrite a newer explicit correction', () => {
  const { trip, stay } = tripWithNote('Bob Smith')
  graph.applyTripNotes([trip])
  assert.equal(stay.meta.bookedBy, 'Bob Smith', 'stale historical note must not undo a later correction to Bob Smith')
})
await check('CONTROL: normalized past and future passport expiry states are correct', async () => {
  const docs = await graph.loadTravelDocs(444, fixedNow)
  assert.equal(docs[1].expired, true)
  assert.equal(docs[2].expired, false)
  assert.ok(documentReads >= 1)
})
await check('P2 RED: fallback-only expired passport is classified EXPIRED, not valid', async () => {
  const docs = await graph.loadTravelDocs(444, fixedNow)
  assert.equal(docs[0].expiry, '2023-05-01')
  assert.equal(docs[0].expired, true, 'displayed fallback expiry must determine expiration when expires_on is null')
  const lines = graph.travelDocLines([docs[0]], [travelTrip('Mumbai', '2026-10-29T08:00:00Z', '2026-10-31T09:00:00Z')]).join('\n')
  assert.match(lines, /EXPIRED 2023-05-01/)
  assert.doesNotMatch(lines, /valid till 2023-05-01/)
})
await check('CONTROL: single late trip can retrieve its own calendar meeting', async () => {
  const late = travelTrip('Pune', '2026-11-20T00:00:00Z', '2026-11-21T20:00:00Z')
  const events = await graph.loadTripCalendar(444, [late], fixedNow)
  assert.ok(events.some((e: any) => e.id === 'gcal:late-trip-meeting'))
})
await check('P2 RED: a second trip meeting survives >30 earlier unrelated events', async () => {
  const early = travelTrip('Mumbai', '2026-11-01T00:00:00Z', '2026-11-02T20:00:00Z')
  const late = travelTrip('Pune', '2026-11-20T00:00:00Z', '2026-11-21T20:00:00Z')
  const events = await graph.loadTripCalendar(444, [early, late], fixedNow)
  assert.ok(events.some((e: any) => e.id === 'gcal:late-trip-meeting'), 'a bounded per-trip/page-aware query must not silently drop later-trip events')
  assert.ok(calendarCalls >= 1)
})
const fails = outcomes.filter(o => !o.ok)
console.log('Synthetic life-graph controls/negatives: ' + (outcomes.length - fails.length) + ' PASS / ' + fails.length + ' FAIL')
if (fails.length) {
  console.error('EXPECTED RED until Claude corrects actual implementation. DO NOT MERGE TEST-ONLY PR.')
  process.exitCode = 1
}
