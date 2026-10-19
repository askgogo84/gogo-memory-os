// Concise, Fo-style task status replies (19 Oct founder feedback: long bullet dumps confuse users).
// "What are you working on?" -> at most 6 short lines: what needs the user first (max 3), background
// work in one sentence with "+N more", at most one follow-up. "show all tasks" -> the full list.
// "Any update on the X task?" -> one short paragraph (<= 4 lines) with that task's facts.
// Owner binding, no false success and no takeover-URL leaks are re-checked here.
// Run: npx tsx scripts/verify-concise-status-replies.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'ci-placeholder-service-role-key'
process.env.OPENAI_API_KEY ||= 'ci-placeholder-openai-key'; process.env.ANTHROPIC_API_KEY ||= 'ci-placeholder-anthropic-key'

const taskStatus = await import('../lib/agent/task-status.ts')
const attention = await import('../lib/agent/attention-state.ts')
const lifecycle = await import('../lib/agent/task-lifecycle.ts')
const { parseTaskStatusQuery, tryGetTaskStatus } = taskStatus

const OWNER = 100
const NOW = new Date('2026-10-19T10:00:00.000Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString()
const ahead = (min: number) => new Date(NOW.getTime() + min * 60000).toISOString()
const lines = (text: string) => String(text).trim().split('\n').filter(line => line.trim())
const offers = (text: string) => lines(text).filter(line => /show all tasks|want me to|\?\s*$/i.test(line))

// --- Supabase fixture: every query must be owner-scoped; rows of other owners are filtered out by the query.
type Tables = Record<string, any[]>
let tables: Tables = {}
const scoped: Array<{ table: string; owner: string | null }> = []
const db = {
  from(table: string) {
    const entry = { table, owner: null as string | null }; scoped.push(entry)
    let rows = [...(tables[table] || [])]
    let single = false
    const q: any = {
      select: () => q, order: () => q, limit: () => q, gte: () => q, not: () => q,
      eq: (key: string, value: unknown) => { if (key === 'telegram_id') entry.owner = String(value); rows = rows.filter(r => String(r[key]) === String(value)); return q },
      in: (key: string, values: unknown[]) => { rows = rows.filter(r => values.map(String).includes(String(r[key]))); return q },
      maybeSingle: () => { single = true; return q },
      then: (resolve: any) => resolve({ data: single ? rows[0] || null : rows, error: null }),
    }
    return q
  },
}
function loadAutonomy() {
  const exports: any = {}
  const src = readFileSync(new URL('../lib/agent/autonomy-status.ts', import.meta.url), 'utf8')
  const deps: Record<string, any> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    './open-loops': { syncOpenLoopsForUser: async () => {} },
    './task-lifecycle': lifecycle, './attention-state': attention, './task-status': taskStatus,
  }
  const RealDate = Date
  class FixedDate extends RealDate { constructor(...args: any[]) { super(...((args.length ? args : [NOW.getTime()]) as [])) } static now() { return NOW.getTime() } }
  runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, module: { exports }, require: (name: string) => deps[name] || {}, Date: FixedDate, Intl, console })
  return exports
}
const autonomy = loadAutonomy()
const actor = { legacyTelegramId: OWNER, userId: 'u100' }
async function digest(text: string, fixture: Tables) {
  tables = fixture; scoped.length = 0
  const res = await autonomy.tryGetAutonomyStatus({ actor, text })
  assert.ok(res, `digest returned for: ${text}`)
  assert.ok(scoped.length > 0 && scoped.every(s => s.owner === String(OWNER)), 'every digest read is owner-scoped')
  return String(res.text)
}

const run = (over: any) => ({ telegram_id: String(OWNER), summary: '', progress: null, updated_at: ago(10), error: null, metadata_json: {}, ...over })
const watcher = (id: string, title: string, over: any = {}) => ({ id, telegram_id: String(OWNER), type: 'web_watch', condition_json: { title }, cadence_minutes: 60, active: true, created_at: ago(60), ...over })
const otherOwner = {
  run: run({ id: 'x1', telegram_id: '200', title: 'SECRET task of user 200', status: 'waiting_approval' }),
  watcher: watcher('xw', 'SECRET watch of user 200', { telegram_id: '200' }),
}
const busy: Tables = {
  users: [{ telegram_id: OWNER, timezone: 'Asia/Kolkata' }],
  agent_runs: [
    run({ id: 'toit', title: 'Toit table for Saturday 8pm', status: 'waiting_approval', summary: 'Table for 4 at 8 pm is ready to confirm.' }),
    run({ id: 'irctc', title: 'IRCTC train search BLR to MAS', status: 'paused', metadata_json: { handoff: { takeoverUrl: 'https://example.test/takeover/abc' } } }),
    run({ id: 'iphone', title: 'iPhone 17 price comparison', status: 'running', summary: 'Comparing Amazon, Flipkart and Croma.' }),
    run({ id: 'goa', title: 'Goa trip plan', status: 'queued' }),
    otherOwner.run,
  ],
  agent_watchers: [
    watcher('w1', 'Gold alert (24K below ₹13,324/g)'), watcher('w2', 'iPhone 17 price watch'),
    watcher('w3', 'Sony WH-1000XM5 below ₹24,000'), watcher('w4', 'News: Tata Motors'), otherOwner.watcher,
  ],
  agent_approvals: [], life_events: [], agent_ideas: [], agent_open_loops: [],
}
const allTitles = ['Toit table for Saturday 8pm', 'IRCTC train search BLR to MAS', 'iPhone 17 price comparison', 'Goa trip plan',
  'Gold alert (24K below ₹13,324/g)', 'iPhone 17 price watch', 'Sony WH-1000XM5 below ₹24,000', 'News: Tata Motors']

const failures: string[] = []
async function check(label: string, fn: () => unknown) {
  try { await fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(`${label}: ${e.message}`); console.error('FAIL ' + label + '\n  ' + e.message) }
}

await check('digest: 2 waiting + 6 active -> <= 6 lines, waiting first, +N more, one offer max', async () => {
  const text = await digest('What are you working on for me?', busy)
  const ls = lines(text)
  assert.ok(ls.length <= 6, `at most 6 lines, got ${ls.length}:\n${text}`)
  assert.match(ls[0], /Toit table/, 'approval waiting on the user leads')
  assert.match(ls[0], /approve or reject/i, 'says exactly what is needed')
  assert.match(ls[1], /IRCTC/); assert.match(ls[1], /sign in/i)
  assert.match(text, /In the background: /)
  assert.match(text, /\+?\d+ more/, 'the rest is summarised as N more')
  assert.ok(offers(text).length <= 1, `one follow-up at most:\n${text}`)
  assert.match(text, /show all tasks/i, 'says how to see everything')
  assert.doesNotMatch(text, /Active now|Background monitors|Pending decisions|Dormant|What Gogo is working on|^•/m, 'no section dump')
  assert.doesNotMatch(text, /SECRET|takeover|https?:/i, 'no other owner data, no takeover URL')
  assert.ok(text.length <= 600, `short: ${text.length} chars`)
})

await check('digest: more than 3 waiting -> 3 lines + "+N more"', async () => {
  const many = { ...busy, agent_runs: [...busy.agent_runs,
    run({ id: 'w3', title: 'Cult slot booking', status: 'waiting_approval' }),
    run({ id: 'w4', title: 'Electricity bill payment', status: 'outcome_unknown' }),
    run({ id: 'w5', title: 'Dentist appointment', status: 'paused', summary: 'Waiting for your input: Which day works, Tuesday or Thursday?' })] }
  const text = await digest('what are you working on', many)
  const ls = lines(text)
  assert.ok(ls.length <= 6, `at most 6 lines, got ${ls.length}:\n${text}`)
  const named = ['Toit table', 'IRCTC', 'Cult slot', 'Electricity bill', 'Dentist'].filter(t => text.includes(t))
  assert.equal(named.length, 3, `exactly 3 waiting items named, got ${named.join(', ')}`)
  assert.ok(named.includes('Electricity bill'), 'an unconfirmed outcome is ranked ahead of sign-ins')
  assert.match(text, /Electricity bill payment — I couldn't confirm it went through\. Please check with the provider before retrying\./)
  assert.match(text, /\+2 more need you/)
  assert.doesNotMatch(text, /paid|succeeded|completed/i, 'an unknown outcome is never claimed as done')
})

await check('"show all tasks" and variants -> full list, one line per item', async () => {
  for (const ask of ['show all tasks', 'list all my tasks', 'show everything', 'Show me all my tasks']) {
    const q = parseTaskStatusQuery(ask)
    assert.equal(q?.kind, 'all', `parses as general: ${ask}`); assert.equal((q as any).full, true, `full list: ${ask}`)
    assert.equal(attention.isAutonomyStatus(ask), true, `digest owner claims: ${ask}`)
  }
  const text = await digest('show all tasks', busy)
  for (const title of allTitles) {
    const hits = lines(text).filter(line => line.includes(title))
    assert.equal(hits.length, 1, `"${title}" on exactly one line:\n${text}`)
  }
  assert.doesNotMatch(text, /\d+ more/, 'nothing is hidden in the full list')
  assert.doesNotMatch(text, /SECRET|takeover|https?:/i)
  // the to-do list and pending-task owners keep their phrases
  for (const t of ['show tasks', 'tasks', 'my tasks', 'show my pending tasks']) assert.equal(parseTaskStatusQuery(t), null, t)
})

await check('empty state -> one line', async () => {
  const text = await digest('what are you working on', { users: [{ telegram_id: OWNER }], agent_runs: [otherOwner.run], agent_watchers: [otherOwner.watcher], agent_approvals: [], life_events: [], agent_ideas: [], agent_open_loops: [] })
  assert.equal(lines(text).length, 1, `one line:\n${text}`)
  assert.match(text, /nothing/i)
})

// --- Named task updates (Fo UC5)
const steps = [
  { id: 's1', run_id: 'goa', telegram_id: String(OWNER), ordinal: 1, title: 'Search flights BLR to GOI', status: 'completed', started_at: ago(30), completed_at: ago(20) },
  { id: 's2', run_id: 'goa', telegram_id: String(OWNER), ordinal: 2, title: 'Shortlist hotels in North Goa', status: 'running', started_at: ago(12) },
  { id: 's3', run_id: 'goa', telegram_id: String(OWNER), ordinal: 3, title: 'Prepare the plan', status: 'queued' },
]
const namedRuns = [
  run({ id: 'jailer', title: 'Jailer 2 movie booking', status: 'completed', updated_at: ago(120), summary: 'Booked 3 seats in Audi 04 at PVR Orion for 9:45 PM tonight (booking ID TSAJKDX). Reminder set for 8:00 PM.' }),
  run({ id: 'goa', title: 'Goa trip plan', status: 'running', progress: 45, updated_at: ago(5) }),
  run({ id: 'trip2', title: 'Ooty trip hotels', status: 'queued', updated_at: ago(40) }),
  run({ id: 'trip3', title: 'Coorg trip research', status: 'running', updated_at: ago(50) }),
  run({ id: 'trip4', title: 'Hampi trip plan', status: 'paused', updated_at: ago(70) }),
  run({ id: 'secret', telegram_id: '200', title: 'Kerala trip SECRET of user 200', status: 'running', updated_at: ago(1) }),
]
const calls: string[] = []
const deps = {
  now: () => NOW,
  async listRuns(tg: string) { calls.push(tg); return namedRuns.filter(r => r.telegram_id === tg) },
  async listSteps(tg: string, runId: string) { calls.push(tg); return steps.filter(s => s.run_id === runId && s.telegram_id === tg) },
}

await check('named update (done) -> <= 4 lines with specifics, nothing pending', async () => {
  const res = await tryGetTaskStatus({ telegramId: OWNER }, 'Any update on the Jailer 2 task?', deps)
  assert.ok(res, 'named task found'); const text = res!.text
  assert.ok(lines(text).length <= 4, `<= 4 lines:\n${text}`)
  assert.match(text, /Jailer 2 movie booking/); assert.match(text, /TSAJKDX/); assert.match(text, /9:45 PM/)
  assert.match(text, /Nothing left pending on my side\./)
  assert.ok(offers(text).length <= 1)
  assert.doesNotMatch(text, /^Status:|^Waiting on:|^Last activity:|📋/m, 'no labelled card dump')
  assert.ok(text.length <= 420, `short: ${text.length} chars`)
})

await check('named update (running) -> <= 4 lines with step, progress and nothing needed', async () => {
  const res = await tryGetTaskStatus({ telegramId: OWNER }, "how's the Goa trip going", deps)
  const text = res!.text
  assert.ok(lines(text).length <= 4, `<= 4 lines:\n${text}`)
  assert.match(text, /step 2 of 3/i); assert.match(text, /Shortlist hotels in North Goa/); assert.match(text, /45%/)
  assert.match(text, /Nothing needed from you right now/)
  assert.ok(calls.every(tg => tg === String(OWNER)), 'owner-scoped reads')
})

await check('named task not found -> one line + at most 3 closest matches', async () => {
  const res = await tryGetTaskStatus({ telegramId: OWNER }, 'Any update on the Kerala trip task?', deps)
  assert.ok(res, 'an explicit "task" ask that matches nothing says so')
  const text = res!.text
  assert.equal(lines(text).length, 1, `one line:\n${text}`)
  assert.match(text, /couldn't find/i)
  const suggested = ['Goa trip plan', 'Ooty trip hotels', 'Coorg trip research', 'Hampi trip plan'].filter(t => text.includes(t))
  assert.ok(suggested.length >= 1 && suggested.length <= 3, `1-3 closest matches, got ${suggested.length}`)
  assert.doesNotMatch(text, /SECRET/, 'never suggests another owner\'s task')
  assert.equal(res!.readOnly, true); assert.equal(res!.mutated, false)
  // Without an explicit task word an unmatched ask still falls through to other handlers.
  assert.equal(await tryGetTaskStatus({ telegramId: OWNER }, "how's the Kerala trip going", deps), null)
})

if (failures.length) { console.error(`\n${failures.length} failing:\n` + failures.join('\n')); process.exitCode = 1 }
else console.log('verify-concise-status-replies: ok')
