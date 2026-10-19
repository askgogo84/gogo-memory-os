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

// 0 matches (explicit): says so and lists the active tasks; nothing cancelled.
seed()
const none = await tryCancelRunFromChat(owner, 'cancel the pizza order comparison task', deps())
assert.equal(none, null, 'order phrases are not claimed')
const none2 = await tryCancelRunFromChat(owner, 'stop working on the train search', deps())
assert.ok(none2 && /^I don't see an active task called train search\. Your active tasks:/.test(none2.text) && none2.text.includes('Goa hotel search') && !none2.text.includes('Old pizza') && !none2.text.includes('Biryani'), none2?.text)
assert.equal(writes.length, 0)
// 0 matches (soft "stop the X"): left for other handlers.
assert.equal(await tryCancelRunFromChat(owner, 'stop the train search', deps()), null)
// No active tasks at all.
seed(); stores.agent_runs = stores.agent_runs.filter(r => r.telegram_id !== '42' || r.status === 'completed')
const empty = await tryCancelRunFromChat(owner, 'cancel that task', deps())
assert.ok(empty && /no active tasks/.test(empty.text), empty?.text)
const empty2 = await tryCancelRunFromChat(owner, 'cancel the hotel task', deps())
assert.ok(empty2 && /I don't see an active task called hotel\. You have no active tasks right now\./.test(empty2.text), empty2?.text)
assert.equal(run('r-other').status, 'running', "another owner's run is never a candidate")
// Non-cancel text never touches the DB.
seed()
assert.equal(await tryCancelRunFromChat(owner, 'cancel my 5pm reminder', deps()), null)
assert.equal(await tryCancelRunFromChat(owner, 'stop watching iPhone price', deps()), null)
assert.equal(writes.length, 0)

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
