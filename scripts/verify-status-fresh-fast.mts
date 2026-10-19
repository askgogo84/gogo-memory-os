// 20 Oct live (dashboard, after #680): "What are you working on?" took 43.8s and led with
// "Browser · www.instagram.com is paused until you sign in" (days-old runs) and a saved
// "Gold rate: 22K gold in Bangalore Drops" label.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const taskStatus = await import('../lib/agent/task-status.ts')
const attention = await import('../lib/agent/attention-state.ts')
const lifecycle = await import('../lib/agent/task-lifecycle.ts')
const NOW = new Date('2026-10-20T02:00:00.000Z')
const ago = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
let tables: Record<string, any[]> = {}
const db = { from(table: string) { let rows = [...(tables[table] || [])]; let single = false
  const q: any = { select: () => q, order: () => q, limit: () => q, gte: () => q, not: () => q, lte: () => q, lt: () => q, gt: () => q, is: () => q,
    eq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] === undefined || String(r[k]) === String(v)); return q },
    in: (k: string, vs: unknown[]) => { rows = rows.filter(r => vs.map(String).includes(String(r[k]))); return q },
    maybeSingle: () => { single = true; return q }, then: (res: any) => res({ data: single ? rows[0] || null : rows, error: null }) }
  return q } }
function load(syncMs: number) {
  const exports: any = {}
  const src = readFileSync(new URL('../lib/agent/autonomy-status.ts', import.meta.url), 'utf8')
  const deps: Record<string, any> = { '@/lib/supabase-admin': { supabaseAdmin: db },
    './open-loops': { syncOpenLoopsForUser: () => new Promise(r => setTimeout(r, syncMs)) },
    './task-lifecycle': lifecycle, './attention-state': attention, './task-status': taskStatus }
  runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, module: { exports }, require: (n: string) => deps[n] || {}, Date, Intl, console, setTimeout, clearTimeout })
  return exports
}
const a = load(60_000)
assert.equal(a.friendlyTaskTitle('Browser · www.instagram.com'), 'Instagram')
assert.equal(a.friendlyTaskTitle('Browser · flipkart.com'), 'Flipkart')
assert.equal(a.friendlyTaskTitle('Gold rate: 22K gold in Bangalore Drops falls below ₹12,280/g'), 'Gold rate: 22K gold in Bangalore falls below ₹12,280/g')
assert.equal(a.friendlyTaskTitle('Add Jailer 2 to calendar'), 'Add Jailer 2 to calendar')
const input = { now: NOW, timezone: 'Asia/Kolkata', approvals: [], events: [], ideas: [], openLoops: [], watchers: [{ type: 'web_search', cadence_minutes: 360, condition_json: { title: 'Gold rate: 22K gold in Bangalore Drops falls below ₹12,280/g' } }],
  grouped: { activeNow: [], incomplete: [], pendingDecisions: [], waitingContext: [
    { title: 'Browser · www.instagram.com', status: 'paused', error: 'human_auth_required', summary: 'I couldn’t sign in', updated_at: ago(26 * 24), metadata_json: { authReason: 'sign_in' } },
    { title: 'Reserve Toit Indiranagar', status: 'paused', error: 'restaurant_context_review_required', summary: 'This approval lacks current verified dining-date or time authority. Request a refreshed bounded approval; no reservation was armed.', updated_at: ago(2) },
  ] } }
const short = a.formatAutonomyDigest(input)
assert.doesNotMatch(short, /instagram/i, 'a 26-day-old paused run is not in the short digest: ' + short)
assert.match(short, /Reserve Toit Indiranagar needs a fresh request — ask me again to book it\./, short)
assert.doesNotMatch(short, /lacks current verified|bounded approval/, short)
assert.match(short, /Gold rate: 22K gold in Bangalore falls below/, short)
assert.doesNotMatch(short, /Bangalore Drops/, short)
assert.match(short, /show all tasks/, 'older items are still reachable')
const full = a.formatAutonomyDigest(input, { full: true })
assert.match(full, /Instagram/, 'the full list still shows the old run')
// Reply does not wait for a slow open-loop sync.
tables = { users: [{ telegram_id: 100, timezone: 'Asia/Kolkata' }] }
const t0 = Date.now()
const r = await a.tryGetAutonomyStatus({ actor: { legacyTelegramId: 100, userId: 'u' }, text: 'What are you working on?' })
const ms = Date.now() - t0
assert.ok(r, 'status reply produced')
assert.ok(ms < 4000, 'reply in < 4s with a 60s sync, took ' + ms + 'ms')
assert.equal(a.AUTONOMY_SYNC_WAIT_MS, 2500)
process.stdout.write('Status digest: old paused runs only in the full list, friendly titles, jargon replaced, reply not blocked by a slow sync.\n')
process.exit(0)
