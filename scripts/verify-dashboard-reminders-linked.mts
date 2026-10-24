// Dashboard reminders across linked rows (24 Oct live: reminders set on WhatsApp were saved under the WhatsApp id
// -884501501 and the dashboard, signed in as the other row of the same number, showed none). Offline, mocked DB.
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
const linked = async (id: any) => Number(id) === SESSION ? [String(SESSION), String(WA)] : [String(id)]
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

// Reads: both linked rows, never the stranger.
const today = await Q.getTodayReminders(String(SESSION))
assert.equal(today.ok, true)
assert.equal(today.reminders.map((r: any) => r.id).sort().join(), 'r-dash,r-wa', 'today shows dashboard + WhatsApp reminders only')
const upcoming = await Q.getUpcomingReminders(String(SESSION))
assert.ok(!upcoming.some((r: any) => r.id === 'r-x'), 'upcoming never shows a stranger row')

// Writes: the owner comes only from the linked set.
assert.equal(await W.resolveReminderOwner(SESSION, 'r-wa'), WA, 'WhatsApp row resolves to its own owner id')
assert.equal(await W.resolveReminderOwner(SESSION, 'r-dash'), SESSION)
assert.equal(await W.resolveReminderOwner(SESSION, 'r-x'), SESSION, 'a stranger row id falls back to the session id')
writes.length = 0
assert.equal(JSON.stringify(await W.deleteReminderById(await W.resolveReminderOwner(SESSION, 'r-x'), 'r-x')), JSON.stringify({ ok: false, reason: 'not_found' }), 'stranger row cannot be deleted')
assert.equal(writes.length, 0, 'no write for a stranger row')
assert.equal(JSON.stringify(await W.deleteReminderById(await W.resolveReminderOwner(SESSION, 'r-wa'), 'r-wa')), JSON.stringify({ ok: true }), 'linked WhatsApp row can be deleted from the dashboard')
assert.equal(JSON.stringify(writes.map(w => w.hit)), JSON.stringify([['r-wa']]), 'delete touched exactly the WhatsApp row')

// The route uses the resolved owner for every mutation.
const route = readFileSync('app/api/dashboard/reminders/[id]/route.ts', 'utf8')
for (const fn of ['deleteReminderById', 'stopReminderSeriesById', 'skipReminderOccurrenceById', 'updateReminderById']) assert.doesNotMatch(route, new RegExp(`${fn}\\(tgNum`), `${fn} uses the resolved owner`)
console.log('Dashboard reminders: linked WhatsApp rows visible and editable; strangers neither visible nor writable')
