import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 19 Oct (Muse/Wajo parity): "cancel that task" / "stop the flight booking" cancels the owner's in-flight agent run
// from WhatsApp or dashboard chat. Reminders, calendar events, watches, lists, orders and Gmail keep their own paths.
// Run: npx tsx scripts/verify-run-cancel.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'ci-placeholder-service-role-key'
const { parseRunCancel, matchRunByTitle, tryCancelRunFromChat } = await import('../lib/agent/run-cancel')
const { retiredRunReason } = await import('../lib/agent/task-lifecycle')

// ---- parser positives
const positives: Array<[string, string | null, boolean]> = [
  ['cancel that task', null, true],
  ['stop this job', null, true],
  ['cancel current task', null, true],
  ['abort the mission', null, true],
  ['stop my medicine', 'medicine', false],
  ['Cancel the task.', null, true],
  ['please stop the current task', null, true],
  ['abort the job', null, true],
  ['stop what you are doing', null, true],
  ['stop working on it', null, true],
  ['stop the flight booking', 'flight booking', false],
  ['stop working on the Goa hotel search', 'Goa hotel search', true],
  ['cancel the flight booking task', 'flight booking', true],
  ['Cancel my hotel search job', 'hotel search', true],
  ['abort the Indigo check-in', 'Indigo check-in', true],
]
for (const [text, target, explicit] of positives) {
  const parsed = parseRunCancel(text)
  assert.ok(parsed, `"${text}" should be a run cancel`)
  assert.equal(parsed!.target, target, `${text} target`)
  assert.equal(parsed!.explicit, explicit, `${text} explicit`)
}
// ---- parser negatives: other cancel paths and ordinary sentences
for (const text of [
  'cancel my 5pm reminder', 'cancel the reminder task', 'stop reminding me to drink water', 'cancel my meeting with Rahul',
  'cancel the calendar event tomorrow', 'stop watching iPhone price', 'stop the iPhone price watch', 'stop monitoring Sony',
  'cancel my grocery list', 'cancel my Swiggy order', 'stop the order', 'cancel the email draft', 'stop the music',
  'cancel that action', 'cancel my flight booking', 'cancel', 'stop', 'I want to stop working out', 'what tasks are running',
  'reject', 'stop the alarm', 'cancel subscription to Netflix',
  // Review 19 Oct: bare run nouns with no determiner are not a cancel of "the most recent run".
  'abort mission', 'cancel task', 'stop job', 'abort the mission task', 'abort task',
]) assert.equal(parseRunCancel(text), null, `"${text}" must not be claimed`)

// ---- matcher: deterministic, ambiguity returns several
const runs = [
  { id: 'r-flight', title: 'Book flight BLR to DEL on IndiGo', type: 'browser_task', updated_at: '2026-10-19T09:00:00Z' },
  { id: 'r-hotel', title: 'Goa hotel search', type: 'travel_research', updated_at: '2026-10-19T08:00:00Z' },
  { id: 'r-flight2', title: 'Flight check-in for Mumbai trip', type: 'life_event', updated_at: '2026-10-19T07:00:00Z' },
]
assert.deepEqual(matchRunByTitle(runs, 'flight booking').map(r => r.id), ['r-flight'], 'booking stems to book')
assert.deepEqual(matchRunByTitle(runs, 'goa hotel search').map(r => r.id), ['r-hotel'])
assert.deepEqual(matchRunByTitle(runs, 'flight').map(r => r.id), ['r-flight', 'r-flight2'], 'ambiguous: both flights, most recent first')
assert.deepEqual(matchRunByTitle(runs, 'pizza order'), [])
assert.deepEqual(matchRunByTitle(runs, 'hotel booking'), [], 'every word must match')
assert.deepEqual(matchRunByTitle(runs, 'train search'), [], 'a shared generic word never picks a task')
assert.deepEqual(matchRunByTitle([...runs].reverse(), 'flight').map(r => r.id), ['r-flight', 'r-flight2'], 'order independent')

// ---- inert DB
type Row = Record<string, any>
let stores: Record<string, Row[]> = {}
const writes: Array<{ table: string; patch: Row; filters: any[] }> = []
function makeDb() {
  return { from(table: string) {
    const b: any = { _f: [] as any[], _u: null as Row | null, _ins: null as Row | null,
      select() { return b }, order() { return b }, limit() { return b },
      eq(c: string, v: any) { b._f.push(['eq', c, v]); return b },
      in(c: string, v: any[]) { b._f.push(['in', c, v]); return b },
      update(r: Row) { b._u = r; return b },
      insert(r: Row) { b._ins = r; (stores[table] ||= []).push({ ...r }); return Promise.resolve({ data: null, error: null }) },
      maybeSingle: async () => { const rows = run(); return { data: rows[0] || null, error: null } },
      then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej) }
    const hit = () => (stores[table] || []).filter(x => b._f.every(([op, c, v]: any) => op === 'eq' ? String(x[c]) === String(v) : v.map(String).includes(String(x[c]))))
    function run() {
      const rows = hit()
      if (b._u) { for (const r of rows) Object.assign(r, b._u); writes.push({ table, patch: b._u, filters: b._f }) }
      return rows.map(r => ({ ...r }))
    }
    return b
  } }
}
const released: string[] = []
const deps = () => ({ db: makeDb(), releaseAuthHandoff: async (tg: string, id: string) => { released.push(`${tg}:${id}`) }, now: () => new Date('2026-10-19T10:00:00Z'), surface: 'web' as const })
function seed() {
  writes.length = 0; released.length = 0
  stores = {
    agent_runs: [
      { id: 'r-flight', telegram_id: '42', title: 'Book flight BLR to DEL on IndiGo', type: 'browser_task', status: 'waiting_approval', updated_at: '2026-10-19T09:00:00Z', metadata_json: { browser_url: 'https://www.goindigo.in/booking', handoff: { releaseUrl: 'https://h/release' } } },
      { id: 'r-hotel', telegram_id: '42', title: 'Goa hotel search', type: 'travel_research', status: 'running', updated_at: '2026-10-19T09:30:00Z', metadata_json: {} },
      { id: 'r-flight2', telegram_id: '42', title: 'Flight check-in for Mumbai trip', type: 'life_event', status: 'paused', updated_at: '2026-10-19T07:00:00Z', metadata_json: { provider_name: 'Air India', secondary_auth: { safeToRetry: false } } },
      { id: 'r-done', telegram_id: '42', title: 'Old pizza order compare', type: 'browser_task', status: 'completed', updated_at: '2026-10-19T09:50:00Z', metadata_json: {} },
      { id: 'r-food-closed', telegram_id: '42', title: 'Biryani comparison', status: 'paused', updated_at: '2026-10-19T09:55:00Z', metadata_json: { plan_type: 'food_comparison', state: 'closed', closure_reason: 'replaced' } },
      { id: 'r-other', telegram_id: '77', title: 'Goa hotel search', type: 'travel_research', status: 'running', updated_at: '2026-10-19T09:59:00Z', metadata_json: { handoff: { releaseUrl: 'x' } } },
    ],
    agent_approvals: [
      { id: 'a1', run_id: 'r-flight', telegram_id: '42', status: 'pending' },
      { id: 'a-old', run_id: 'r-flight', telegram_id: '42', status: 'expired' },
      { id: 'a-other', run_id: 'r-other', telegram_id: '77', status: 'pending' },
    ],
    agent_activity: [],
  }
}
const run = (id: string) => stores.agent_runs.find(r => r.id === id)!
const owner = { telegramId: 42 }

// 1 match: the named flight booking is cancelled, its approval rejected, its handoff released.
seed()
const one = await tryCancelRunFromChat(owner, 'stop the flight booking', deps())
assert.ok(one && one.status === 'completed', JSON.stringify(one))
assert.equal(one!.text, 'Cancelled: Book flight BLR to DEL on IndiGo. Nothing further will run for it.')
assert.equal(run('r-flight').status, 'failed'); assert.equal(run('r-flight').error, 'user_cancelled')
assert.equal(run('r-flight').metadata_json.closure_reason, 'user_cancelled')
assert.equal(retiredRunReason(run('r-flight')), 'Cancelled by you', 'dashboards show it as cancelled')
const a1 = stores.agent_approvals.find(a => a.id === 'a1')!
assert.equal(a1.status, 'rejected'); assert.equal(a1.resolution_note, 'cancelled_by_user')
assert.equal(stores.agent_approvals.find(a => a.id === 'a-old')!.status, 'expired', 'resolved approvals untouched')
assert.deepEqual(released, ['42:r-flight'])
const activity = stores.agent_activity.find(a => a.event_type === 'agent_run_cancelled_by_user')!
assert.ok(activity && activity.run_id === 'r-flight' && activity.telegram_id === '42' && activity.metadata_json.rejected_approval_ids.includes('a1'))
assert.equal(run('r-hotel').status, 'running', 'other tasks keep running')
// Other owner untouched, even with an identically named task.
assert.equal(run('r-other').status, 'running'); assert.equal(stores.agent_approvals.find(a => a.id === 'a-other')!.status, 'pending')
for (const w of writes) assert.ok(w.filters.some(([op, c, v]: any) => op === 'eq' && c === 'telegram_id' && String(v) === '42'), `write to ${w.table} is owner-bound`)

// "that task" = the most recently updated active run (closed/completed rows ignored).
seed()
const that = await tryCancelRunFromChat(owner, 'cancel that task', deps())
assert.ok(that && that.text === 'Cancelled: Goa hotel search. Nothing further will run for it.', that?.text)
assert.equal(run('r-hotel').status, 'failed'); assert.equal(run('r-other').status, 'running')
assert.deepEqual(released, [], 'no handoff to release for the hotel search')

// A possibly-submitted step says it can't be undone at the provider.
seed()
const sub = await tryCancelRunFromChat(owner, 'cancel the mumbai check-in task', deps())
assert.ok(sub && sub.text === "Cancelled: Flight check-in for Mumbai trip. Nothing further will run for it. I can't undo anything already submitted to Air India.", sub?.text)
assert.deepEqual(released, ['42:r-flight2'])

// Many matches: numbered list, nothing cancelled.
seed()
const many = await tryCancelRunFromChat(owner, 'cancel the flight task', deps())
assert.ok(many && many.status === 'paused' && /Which one should I cancel\?/.test(many.text), many?.text)
assert.ok(many!.text.includes('1. Book flight BLR to DEL on IndiGo') && many!.text.includes('2. Flight check-in for Mumbai trip'), many!.text)
assert.equal(writes.length, 0, 'ambiguous cancels write nothing')

// 0 matches (explicit named): falls through to other handlers (review 19 Oct); nothing cancelled.
seed()
const none = await tryCancelRunFromChat(owner, 'cancel the pizza order comparison task', deps())
assert.equal(none, null, 'order phrases are not claimed')
assert.equal(await tryCancelRunFromChat(owner, 'stop working on the train search', deps()), null, 'explicit named miss falls through')
assert.equal(await tryCancelRunFromChat(owner, 'cancel the buy milk task', deps()), null, 'reminder-like named task falls through')
assert.equal(await tryCancelRunFromChat(owner, 'stop working on my resume', deps()), null, 'unrelated named miss falls through')
assert.equal(writes.length, 0)
// 0 matches (soft "stop the X"): left for other handlers.
assert.equal(await tryCancelRunFromChat(owner, 'stop the train search', deps()), null)
// No active tasks at all.
seed(); stores.agent_runs = stores.agent_runs.filter(r => r.telegram_id !== '42' || r.status === 'completed')
const empty = await tryCancelRunFromChat(owner, 'cancel that task', deps())
assert.ok(empty && /no active tasks/.test(empty.text), empty?.text)
assert.equal(empty!.text, 'You have no active tasks to cancel.')
assert.equal(await tryCancelRunFromChat(owner, 'cancel the hotel task', deps()), null, 'named cancel with no active tasks falls through')
assert.equal(run('r-other').status, 'running', "another owner's run is never a candidate")
// Non-cancel text never touches the DB.
seed()
assert.equal(await tryCancelRunFromChat(owner, 'cancel my 5pm reminder', deps()), null)
assert.equal(await tryCancelRunFromChat(owner, 'stop watching iPhone price', deps()), null)
assert.equal(writes.length, 0)

// ---- review 19 Oct: soft "stop the/my X" never over-claims single generic words.
function seedSoft() {
  writes.length = 0; released.length = 0
  stores = {
    agent_runs: [
      { id: 's-med', telegram_id: '42', title: 'Order my medicine refill from Apollo', type: 'browser_task', status: 'running', updated_at: '2026-10-19T09:00:00Z', metadata_json: {} },
      { id: 's-pay', telegram_id: '42', title: 'Pay electricity bill payment', type: 'browser_task', status: 'running', updated_at: '2026-10-19T08:59:00Z', metadata_json: {} },
      { id: 's-brief', telegram_id: '42', title: 'Prepare morning briefing with news', type: 'research', status: 'running', updated_at: '2026-10-19T08:58:00Z', metadata_json: {} },
      { id: 's-sip', telegram_id: '42', title: 'Review my SIP plan', type: 'research', status: 'running', updated_at: '2026-10-19T08:57:00Z', metadata_json: {} },
      { id: 's-book', telegram_id: '42', title: 'Hotel booking in Goa', type: 'browser_task', status: 'running', updated_at: '2026-10-19T08:56:00Z', metadata_json: {} },
      { id: 's-book2', telegram_id: '42', title: 'Train booking to Mysore', type: 'browser_task', status: 'running', updated_at: '2026-10-19T08:55:00Z', metadata_json: {} },
    ],
    agent_approvals: [], agent_activity: [], agent_steps: [],
  }
}
seedSoft()
for (const text of ['stop my medicine', 'stop the payment', 'stop the booking', 'stop the briefing', 'stop my SIP', 'stop the news', 'stop my plan', 'stop the hotel']) {
  assert.equal(await tryCancelRunFromChat(owner, text, deps()), null, `"${text}" must not cancel on a one-word overlap`)
}
assert.equal(writes.length, 0, 'soft one-word asks write nothing')
// Two content words, exactly one run: claimed.
const softHit = await tryCancelRunFromChat(owner, 'stop the hotel booking', deps())
assert.ok(softHit && softHit.text === 'Cancelled: Hotel booking in Goa. Nothing further will run for it.', softHit?.text)
assert.equal(run('s-book').status, 'failed'); assert.equal(run('s-book2').status, 'running')
// Soft with two content words matching two runs: not claimed (no ambiguity prompt either).
seedSoft()
stores.agent_runs.push({ id: 's-book3', telegram_id: '42', title: 'Hotel booking in Mysore', type: 'browser_task', status: 'running', updated_at: '2026-10-19T08:54:00Z', metadata_json: {} })
assert.equal(await tryCancelRunFromChat(owner, 'stop the hotel booking', deps()), null, 'soft ambiguous match falls through')
assert.equal(writes.length, 0)

// ---- review 19 Oct: DB failures. Reads return null; a failed cancel update says so honestly.
function failingDb(fail: { table: string; op: 'select' | 'update' }) {
  const inner = makeDb()
  return { from(table: string) {
    const b = inner.from(table)
    let op: 'select' | 'update' = 'select'
    const origUpdate = b.update
    b.update = (r: Row) => { op = 'update'; return origUpdate(r) }
    const hit = () => table === fail.table && op === fail.op
    const origMaybe = b.maybeSingle, origThen = b.then
    b.maybeSingle = async () => hit() ? { data: null, error: { message: 'boom' } } : origMaybe()
    b.then = (res: any, rej: any) => hit() ? Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej) : origThen(res, rej)
    return b
  } }
}
seed()
assert.equal(await tryCancelRunFromChat(owner, 'cancel that task', { ...deps(), db: failingDb({ table: 'agent_runs', op: 'select' }) }), null, 'run list read error returns null')
assert.equal(await tryCancelRunFromChat(owner, 'stop the flight booking', { ...deps(), db: failingDb({ table: 'agent_approvals', op: 'select' }) }), null, 'approval read error returns null')
assert.equal(run('r-flight').status, 'waiting_approval', 'nothing cancelled after a read error')
seed()
const saveFail = await tryCancelRunFromChat(owner, 'cancel the goa hotel search task', { ...deps(), db: failingDb({ table: 'agent_runs', op: 'update' }) })
assert.ok(saveFail && saveFail.status === 'paused' && saveFail.text === "I couldn't confirm that Goa hotel search was cancelled, and I haven't retried. Ask *what are you working on for me?* to see its current state.", saveFail?.text)
assert.equal(run('r-hotel').status, 'running')
assert.equal(stores.agent_activity.length, 0, 'no cancelled activity when the cancel was not confirmed')

// ---- review 19 Oct: cancel terminates the run's unfinished steps (agent_steps_status_check allows 'cancelled').
const migration = readFileSync('supabase/migrations/20260921051000_brain_v1_1_schema_foundation.sql', 'utf8')
const stepCheck = migration.slice(migration.indexOf('add constraint agent_steps_status_check'))
assert.match(stepCheck.slice(0, 400), /'cancelled'::text/, 'agent_steps allows cancelled')
seed()
stores.agent_steps = [
  { id: 'st-1', run_id: 'r-hotel', telegram_id: '42', status: 'completed' },
  { id: 'st-2', run_id: 'r-hotel', telegram_id: '42', status: 'running' },
  { id: 'st-3', run_id: 'r-hotel', telegram_id: '42', status: 'queued' },
  { id: 'st-x', run_id: 'r-other', telegram_id: '77', status: 'queued' },
  { id: 'st-y', run_id: 'r-flight', telegram_id: '42', status: 'queued' },
]
await tryCancelRunFromChat(owner, 'cancel the goa hotel search task', deps())
const step = (id: string) => stores.agent_steps.find(r => r.id === id)!
assert.equal(step('st-1').status, 'completed', 'finished steps untouched')
for (const id of ['st-2', 'st-3']) { assert.equal(step(id).status, 'cancelled'); assert.equal(step(id).error, 'user_cancelled') }
assert.equal(step('st-x').status, 'queued', "other owner's steps untouched")
assert.equal(step('st-y').status, 'queued', "other runs' steps untouched")
for (const w of writes) assert.ok(w.filters.some(([op, c, v]: any) => op === 'eq' && c === 'telegram_id' && String(v) === '42'), `write to ${w.table} is owner-bound`)

// ---- review 19 Oct: a cancel mid-wave is never resurrected by reconcileRun (actual runtime, in-memory DB).
{
  const ts = (await import('typescript')).default
  const { runInNewContext } = await import('node:vm')
  const { createHash } = await import('node:crypto')
  function loadRuntime(db: any, notified: any[]) {
    const exports: any = {}
    const output = ts.transpileModule(readFileSync('lib/agent/autonomous-runtime.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const requireMap: Record<string, any> = {
      'node:crypto': { createHash },
    '@/lib/metering/core': { runMeteredTask: (_owner: unknown, _trace: unknown, work: () => unknown) => work() },
      '@/lib/supabase-admin': { supabaseAdmin: db },
      './specialist-registry': { selectSpecialistRoute: () => ({ primary: 'research', supporting: [] }) },
      './run-notify': { notifyRunOutcome: async (r: any) => { notified.push(r); return { status: 'sent' } } },
    }
    runInNewContext(output, { exports, require: (n: string) => { if (n in requireMap) return requireMap[n]; throw new Error(`unexpected import ${n}`) }, console, Date, Promise, Math, Number, String, Array, Set, Map, Object, JSON, Error, Boolean })
    return exports
  }
  const rt = (key: string, deps: string[] = []) => ({ runtime: { stepKey: key, dependsOn: deps, lane: key, maxAttempts: 4, attempt: 0, requiresApproval: false, verificationRequired: false, mutation: false, idempotencyKey: `k-${key}` } })
  function seedWave(stepsDone = false) {
    writes.length = 0
    stores = {
      agent_runs: [{ id: 'auto-1', telegram_id: '42', title: 'Plan my Sunday', type: 'autonomous', status: 'running', updated_at: '2026-10-19T09:00:00Z', metadata_json: { persistent_general_plan: true } }],
      agent_steps: [
        { id: 'w1', run_id: 'auto-1', telegram_id: '42', ordinal: 1, tool_name: 'memory.verified', title: 'Check memory', status: stepsDone ? 'completed' : 'queued', output_json: rt('a') },
      ],
      agent_approvals: [], agent_activity: [],
    }
  }
  const actor = { userId: 'u', legacyTelegramId: 42, whatsappId: 'inert', name: 'Fixture' }

  // (1) The user cancels from chat while the cron wave's only step is executing. The step then "completes";
  // reconcileRun would previously have written 'completed' and sent "Done: Plan my Sunday".
  seedWave()
  const db1 = makeDb(); const notified1: any[] = []
  const runtime1 = loadRuntime(db1, notified1)
  const registry1 = { 'memory.verified': async () => {
    const cancelled = await tryCancelRunFromChat(owner, 'cancel that task', { db: db1, now: () => new Date('2026-10-19T10:00:00Z') })
    assert.ok(cancelled && cancelled.text === 'Cancelled: Plan my Sunday. Nothing further will run for it.', cancelled?.text)
    return { status: 'completed' as const, verified: true, output: { text: 'done' } }
  } }
  const wave1 = await runtime1.executeAutonomousRun({ actor, runId: 'auto-1', registry: registry1, notifyOutcome: true })
  assert.equal(run('auto-1').status, 'failed', 'cancelled run stays failed'); assert.equal(run('auto-1').error, 'user_cancelled')
  assert.equal(run('auto-1').metadata_json.closure_reason, 'user_cancelled')
  assert.equal(notified1.length, 0, 'no outcome message for a cancelled run')
  assert.notEqual(wave1.status, 'completed'); assert.notEqual(wave1.status, 'running')
  assert.equal(stores.agent_steps[0].status, 'cancelled', 'the in-flight step stays cancelled; its late completion write is guarded')
  assert.ok(!stores.agent_activity.some(a => a.event_type === 'autonomous_run_completed'), 'no completed activity')
  // A later cron wave sees the terminal run and does nothing.
  const again = await runtime1.executeAutonomousRun({ actor, runId: 'auto-1', registry: registry1, notifyOutcome: true })
  assert.equal(again.executed, 0); assert.equal(run('auto-1').status, 'failed'); assert.equal(notified1.length, 0)

  // (2) Race inside reconcileRun: the cancel lands after reconcile read the run but before its write. The guarded
  // update matches no row, so nothing is written and nobody is notified.
  for (const stepStatus of ['completed', 'running-left'] as const) {
    seedWave(stepStatus === 'completed')
    if (stepStatus === 'running-left') stores.agent_steps.push({ id: 'w2', run_id: 'auto-1', telegram_id: '42', ordinal: 2, tool_name: 'memory.verified', title: 'Later', status: 'queued', output_json: rt('b', ['a']) })
    const base = makeDb(); const notified2: any[] = []
    let runReads = 0
    const racingDb = { from(table: string) {
      const b = base.from(table)
      if (table === 'agent_runs') {
        const origMaybe = b.maybeSingle
        b.maybeSingle = async () => {
          const result = await origMaybe()
          if (++runReads === 2) Object.assign(run('auto-1'), { status: 'failed', error: 'user_cancelled', summary: 'Cancelled by you.', metadata_json: { state: 'closed', closure_reason: 'user_cancelled' } })
          return result
        }
      }
      return b
    } }
    const runtime2 = loadRuntime(racingDb, notified2)
    const wave2 = await runtime2.executeAutonomousRun({ actor, runId: 'auto-1', registry: { 'memory.verified': async () => ({ status: 'completed' as const, verified: true }) }, notifyOutcome: true })
    assert.equal(wave2.status, 'superseded', `${stepStatus}: reconcile reports it lost the race`)
    assert.equal(run('auto-1').status, 'failed', `${stepStatus}: stays failed`); assert.equal(run('auto-1').error, 'user_cancelled')
    assert.equal(notified2.length, 0, `${stepStatus}: no notify`)
    const runWrite = writes.find(w => w.table === 'agent_runs')
    assert.ok(runWrite && runWrite.filters.some(([op, c, v]: any) => op === 'in' && c === 'status' && !v.includes('failed') && v.includes('running')), `${stepStatus}: run update is status-guarded`)
  }

  // (3) Normal flows unchanged: a running run still completes and notifies once.
  seedWave(true)
  const notified3: any[] = []
  const done = await loadRuntime(makeDb(), notified3).executeAutonomousRun({ actor, runId: 'auto-1', registry: {}, notifyOutcome: true })
  assert.equal(done.status, 'completed'); assert.equal(run('auto-1').status, 'completed'); assert.equal(notified3.length, 1)
}

// ---- wiring: WhatsApp attention path (before open loops) and route gate; dashboard chat (before the planner).
const bridge = readFileSync('lib/agent/whatsapp-bridge.ts', 'utf8')
const attention = bridge.indexOf('export async function tryRunWhatsAppAttentionCommand')
const cancelCall = bridge.indexOf('tryCancelRunFromChat({telegramId:actor.legacyTelegramId},params.text', attention)
const openLoop = bridge.indexOf('shouldHandleOpenLoopAction({actor', attention)
assert.ok(attention > 0 && cancelCall > attention && openLoop > cancelCall, 'run cancel runs inside the attention command, before open-loop handlers')
const wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.match(wa, /isOpenLoopActionCandidate\(text\) \|\| parseRunCancel\(text\)\) \{\s*const attentionAgent = await tryRunWhatsAppAttentionCommand/, 'WhatsApp route sends run cancels to the attention command')
const dash = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
const dashCancel = dash.indexOf("tryCancelRunFromChat({telegramId:actor.legacyTelegramId},text,{surface:'web'})"), planner = dash.indexOf('tryRunGeneralPlan({')
assert.ok(dashCancel > 0 && planner > dashCancel, 'dashboard chat cancels before the general planner')
console.log('verify-run-cancel: ok')
