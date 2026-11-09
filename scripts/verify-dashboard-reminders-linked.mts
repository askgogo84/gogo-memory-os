// P1 containment: dashboard reminder reads and writes must NEVER use unverified linked WhatsApp IDs.
// Historic WhatsApp rows remain untouched; test a synthetic poisoned multi-account link. Offline mocked DB.
// Run: npx tsx scripts/verify-dashboard-reminders-linked.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const SESSION = 5550001, WA = -884501501, STRANGER = -999999999
const reminders = [
  { id: 'r-dash', telegram_id: SESSION, message: 'dashboard one', remind_at: new Date(Date.now() + 36e5).toISOString() },
  { id: 'r-wa', telegram_id: WA, message: 'whatsapp one', remind_at: new Date(Date.now() + 36e5).toISOString() },
  { id: 'r-x', telegram_id: STRANGER, message: 'stranger', remind_at: new Date(Date.now() + 36e5).toISOString() },
]
const writes: any[] = []
const db = { from: (table: string) => {
  const f: any[] = []; let op = 'select'
  const rows = () => (table === 'reminders' ? reminders : []).filter(r => f.every(([k, key, v]) => k === 'eq' ? String((r as any)[key]) === String(v) : k === 'in' ? v.map(String).includes(String((r as any)[key])) : true))
  const q: any = {
    select: () => q, gte: () => q, lt: () => q, order: () => q, limit: () => q,
    eq: (k: string, v: any) => { f.push(['eq', k, v]); return q }, in: (k: string, v: any[]) => { f.push(['in', k, v]); return q },
    delete: () => { op = 'delete'; return q }, update: (u: any) => { op = 'update:' + JSON.stringify(u); return q },
    maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
    then: (res: any) => { if (op !== 'select') writes.push({ op, f, hit: rows().map(r => r.id) }); return Promise.resolve({ data: rows(), error: null }).then(res) },
  }
  return q
} }
let linkedAttempts = 0
const linked = async (id: any) => { linkedAttempts++; return Number(id) === SESSION ? [String(SESSION), String(WA), String(STRANGER)] : [String(id)] }
const deps: any = {
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/dashboard/owner-ids': { linkedTelegramIds: linked },
  '@/lib/ist': { istDayWindow: () => ({ startUtc: new Date(Date.now() - 864e5), endUtc: new Date(Date.now() + 864e5) }) },
  '@/lib/bot/handlers/edit-reminder': { cancelFollowupChain: async () => {} },
  '@/lib/services/reminder-series': { stopReminderSeries: async () => ({ ok: true }), skipReminderOccurrence: async () => ({ ok: true }) },
}
function load(path: string): any {
  const exports: any = {}
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (n: string) => deps[n] || {}, console, process, Date, Map, Set, Number, String, Promise })
  return exports
}
const Q = load('lib/dashboard/queries.ts')
const W = load('lib/dashboard/reminder-writes.ts')

// Reads: even when a poisoned helper claims WhatsApp/stranger IDs belong to us,
// only the exact dashboard session owner may be queried.
const today = await Q.getTodayReminders(String(SESSION))
assert.equal(today.ok, true)
assert.equal(today.reminders.map((r: any) => r.id).sort().join(), 'r-dash', 'today is strictly session-scoped')
const upcoming = await Q.getUpcomingReminders(String(SESSION))
assert.equal(upcoming.map((r: any) => r.id).sort().join(), 'r-dash', 'upcoming cannot read WhatsApp or unrelated owners')

for (const invalid of ['5550001garbage', '9007199254740993', '-0', '1e2']) {
  const res = await Q.getTodayReminders(invalid)
  assert.equal(res.ok, true)
  assert.equal(res.reminders.length, 0, 'invalid or unsafe session owner must not alias a different reminder owner')
  assert.equal((await Q.getUpcomingReminders(invalid)).length, 0)
}

// Mutations: the resolver must never use linked ids or the request's reminder id
// to escalate owner identity, even if a different row exists for that id.
assert.equal(await W.resolveReminderOwner(SESSION, 'r-wa'), SESSION)
assert.equal(await W.resolveReminderOwner(SESSION, 'r-x'), SESSION)
assert.equal(await W.resolveReminderOwner(SESSION, 'r-dash'), SESSION)
assert.equal(linkedAttempts, 0, 'unsafe inferred linked identities must never be consulted for reminders')
writes.length = 0
assert.equal(JSON.stringify(await W.deleteReminderById(await W.resolveReminderOwner(SESSION, 'r-x'), 'r-x')), JSON.stringify({ ok: false, reason: 'not_found' }), 'stranger row cannot be deleted')
assert.equal(JSON.stringify(await W.deleteReminderById(await W.resolveReminderOwner(SESSION, 'r-wa'), 'r-wa')), JSON.stringify({ ok: false, reason: 'not_found' }), 'WhatsApp row cannot be deleted without proven linking')
assert.equal(writes.length, 0, 'no write to another account')
assert.equal(JSON.stringify(await W.deleteReminderById(await W.resolveReminderOwner(SESSION, 'r-dash'), 'r-dash')), JSON.stringify({ ok: true }), 'session-owned reminder stays editable')
assert.equal(JSON.stringify(writes.map(w => w.hit)), JSON.stringify([['r-dash']]), 'the write touched only the signed-in owner')

// All four routes must still pass an owner selected by the safe resolver.
const route = readFileSync('app/api/dashboard/reminders/[id]/route.ts', 'utf8')
for (const fn of ['deleteReminderById', 'stopReminderSeriesById', 'skipReminderOccurrenceById', 'updateReminderById']) assert.doesNotMatch(route, new RegExp(`${fn}\\(tgNum`), `${fn} must use the session-only resolver`)

// Execute the actual dashboard mutation handlers with an inert getSession stub.
// A malformed/unsafe 64-bit telegram ID must 401 BEFORE contacting reminder DB.
let routeSessionId = String(SESSION)
const routeMutationOwners: number[] = []
deps['next/server'] = { NextResponse: { json: (body: any, options?: any) => ({ status: options?.status || 200, body }) } }
deps['@/lib/dashboard/session'] = { getSession: async () => ({ telegramId: routeSessionId }) }
deps['@/lib/dashboard/guard'] = { verifySameOrigin: () => null }
deps['@/lib/dashboard/wall-time'] = { todayInTz: () => ({ y: 2026, mo: 10, d: 25 }), wallTimeToUtcIso: () => '2026-10-25T11:00:00Z' }
deps['@/lib/dashboard/reminder-writes'] = {
  resolveReminderOwner: W.resolveReminderOwner,
  deleteReminderById: async (owner: number) => { routeMutationOwners.push(owner); return { ok: true } },
  stopReminderSeriesById: async (owner: number) => { routeMutationOwners.push(owner); return { ok: true } },
  skipReminderOccurrenceById: async (owner: number) => { routeMutationOwners.push(owner); return { ok: true } },
  updateReminderById: async (owner: number) => { routeMutationOwners.push(owner); return { ok: true } },
}
const H = load('app/api/dashboard/reminders/[id]/route.ts')
const routeArgs = [{ json: async () => ({ action: 'stop', message: 'safe edit' }) }, { params: Promise.resolve({ id: 'r-dash' }) }] as const
for (const invalid of ['5550001tail', '9007199254740993', '-0', '1e2']) {
  routeSessionId = invalid
  for (const verb of ['DELETE', 'POST', 'PATCH']) {
    const reply = await H[verb](routeArgs[0], routeArgs[1])
    assert.equal(reply.status, 401, verb + ': unsafe owner must not reach a write')
  }
}
assert.equal(routeMutationOwners.length, 0, 'unsafe session owner caused no writes')
routeSessionId = String(SESSION)
for (const verb of ['DELETE', 'POST', 'PATCH']) {
  const reply = await H[verb](routeArgs[0], routeArgs[1])
  assert.equal(reply.status, 200, 'legitimate session owner can still change own reminder')
}
assert.equal(JSON.stringify(routeMutationOwners), JSON.stringify([SESSION, SESSION, SESSION]), 'each mutation stays bound to exact session owner')

console.log('Dashboard reminders P1: session-only reads/mutations; poisoned linked sets never consulted')
