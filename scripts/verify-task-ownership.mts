import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 23 Oct (Duet parity): every task shows ONE owner-facing state, and the owner can cancel from the dashboard.
// Run: npx tsx scripts/verify-task-ownership.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
process.env.OPENAI_API_KEY ||= 'test-key'
process.env.ANTHROPIC_API_KEY ||= 'test-key'
const { taskStateOf, TASK_STATE_LABEL, canOwnerCancel } = await import('../lib/dashboard/task-state')
const { cancelRunById, tryCancelRunFromChat, CANCELLABLE_RUN_STATUSES } = await import('../lib/agent/run-cancel')

// ---- 1. taskStateOf, table-driven: every state
const confirmed = (decision: 'done' | 'not_done') => ({ owner_confirmation: { decision, at: '2026-10-22T10:00:00Z', by: 'u1', surface: 'web' } })
const cases: Array<[string, any, string]> = [
  ['running', { status: 'running' }, 'running'],
  ['queued', { status: 'queued' }, 'waiting'],
  ['scheduled', { status: 'scheduled' }, 'waiting'],
  ['background watch', { status: 'watching' }, 'waiting'],
  ['approval', { status: 'waiting_approval' }, 'needs_you'],
  ['paused with handoff', { status: 'paused', metadata_json: { handoff: { takeoverUrl: 'x' } } }, 'needs_you'],
  ['paused sign-in', { status: 'paused', error: 'human_auth_required' }, 'needs_you'],
  ['paused code (secondary auth)', { status: 'paused', metadata_json: { secondary_auth: { kind: 'otp' } } }, 'needs_you'],
  ['plain pause', { status: 'paused' }, 'needs_you'],
  ['owner said not yet', { status: 'completed', type: 'booking', metadata_json: confirmed('not_done') }, 'needs_you'],
  ['paused provider block', { status: 'paused', error: 'provider_access_limited' }, 'blocked'],
  ['paused device handoff', { status: 'paused', metadata_json: { handoff: { mode: 'device', providerUrl: 'https://irctc.co.in' } } }, 'blocked'],
  ['paused missing input', { status: 'paused', error: 'delivery_location_required' }, 'blocked'],
  ['failed provider block', { status: 'failed', error: 'browser_blocked' }, 'blocked'],
  ['failed missing input meta', { status: 'failed', metadata: { missing_input: ['date'] } }, 'blocked'],
  ['owner confirmed', { status: 'completed', type: 'booking', metadata_json: confirmed('done') }, 'done'],
  ['completed unconfirmed', { status: 'completed', type: 'booking', metadata_json: {} }, 'gogo_thinks_done'],
  ['completed non-outcome type', { status: 'completed', type: 'watch_check' }, 'gogo_thinks_done'],
  ['completed wrapper, outcome paused', { status: 'completed', type: 'booking', metadata_json: { outcome_status: 'paused' } }, 'needs_you'],
  ['completed wrapper, outcome failed', { status: 'completed', type: 'booking', metadata_json: { outcome_status: 'failed' } }, 'could_not_finish'],
  ['outcome_unknown status', { status: 'outcome_unknown' }, 'unknown'],
  ['metadata outcome unknown', { status: 'completed', type: 'booking', metadata_json: { outcome_status: 'unknown' } }, 'unknown'],
  ['unknown beats owner confirm', { status: 'completed', metadata_json: { outcome_status: 'unknown', ...confirmed('done') } }, 'unknown'],
  ['cancelled status', { status: 'cancelled' }, 'cancelled'],
  ['chat-cancelled (failed + user_cancelled)', { status: 'failed', error: 'user_cancelled' }, 'cancelled'],
  ['dashboard-retired cancel', { status: 'closed', error: 'user_cancelled' }, 'cancelled'],
  ['closure reason', { status: 'failed', metadata_json: { state: 'closed', closure_reason: 'user_cancelled' } }, 'cancelled'],
  ['failed', { status: 'failed', error: 'tool_timeout' }, 'could_not_finish'],
  ['retired (closed, not by owner)', { status: 'closed', error: 'stale_run_recovered' }, 'could_not_finish'],
]
for (const [name, run, want] of cases) assert.equal(taskStateOf(run), want, name)
const covered = new Set(cases.map(c => c[2]))
for (const state of Object.keys(TASK_STATE_LABEL)) assert.ok(covered.has(state), `state ${state} has a test`)
assert.deepEqual(TASK_STATE_LABEL, {
  running: 'Working now', waiting: 'Waiting', needs_you: 'Needs you', blocked: 'Blocked', done: 'Done',
  gogo_thinks_done: "Gogo thinks it's done", unknown: 'Not sure it happened', cancelled: 'Cancelled', could_not_finish: 'Could not finish',
})
// Agent completion and owner completion stay distinct.
assert.notEqual(taskStateOf({ status: 'completed', type: 'booking' }), taskStateOf({ status: 'completed', type: 'booking', metadata_json: confirmed('done') }))

// canOwnerCancel matches the chat cancel set exactly
for (const s of ['queued', 'running', 'waiting_approval', 'paused']) assert.equal(canOwnerCancel({ status: s }), true, s)
for (const s of ['completed', 'failed', 'outcome_unknown', 'watching', 'closed', 'cancelled']) assert.equal(canOwnerCancel({ status: s }), false, s)
assert.equal(canOwnerCancel({ status: 'paused', error: 'user_cancelled' }), false)
assert.deepEqual([...CANCELLABLE_RUN_STATUSES], ['queued', 'running', 'waiting_approval', 'paused'])

// ---- 2. cancelRunById against an inert DB: owner-scoped, allowed statuses only, approvals rejected, activity row
type Row = Record<string, any>
let stores: Record<string, Row[]> = {}
const reads: Array<{ table: string; filters: any[] }> = []
function makeDb() {
  return { from(table: string) {
    const b: any = { _f: [] as any[], _u: null as Row | null,
      select() { return b }, order() { return b }, limit() { return b },
      eq(c: string, v: any) { b._f.push(['eq', c, v]); return b },
      in(c: string, v: any[]) { b._f.push(['in', c, v]); return b },
      update(r: Row) { b._u = r; return b },
      insert(r: Row) { (stores[table] ||= []).push({ ...r }); return Promise.resolve({ data: null, error: null }) },
      maybeSingle: async () => { const rows = run(); return { data: rows[0] || null, error: null } },
      then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej) }
    const hit = () => (stores[table] || []).filter(x => b._f.every(([op, c, v]: any) => op === 'eq' ? String(x[c]) === String(v) : v.map(String).includes(String(x[c]))))
    function run() {
      const rows = hit()
      if (b._u) for (const r of rows) Object.assign(r, b._u)
      else reads.push({ table, filters: [...b._f] })
      return rows.map(r => ({ ...r }))
    }
    return b
  } }
}
const db = makeDb()
const now = () => new Date('2026-10-23T09:00:00Z')
function seed() {
  stores = {
    agent_runs: [
      { id: 'run-mine', telegram_id: '42', title: 'Book Goa hotel', type: 'booking', status: 'waiting_approval', metadata_json: {}, updated_at: '2026-10-23T08:00:00Z' },
      { id: 'run-other', telegram_id: '99', title: 'Someone else', type: 'booking', status: 'running', metadata_json: {} },
      { id: 'run-done', telegram_id: '42', title: 'Done thing', type: 'booking', status: 'completed', metadata_json: {} },
      { id: 'run-unknown', telegram_id: '42', title: 'Unsure', type: 'booking', status: 'outcome_unknown', metadata_json: {} },
    ],
    agent_steps: [{ id: 's1', run_id: 'run-mine', telegram_id: '42', status: 'waiting_approval' }],
    agent_approvals: [
      { id: 'ap1', run_id: 'run-mine', telegram_id: '42', status: 'pending' },
      { id: 'ap-other', run_id: 'run-other', telegram_id: '99', status: 'pending' },
    ],
    agent_activity: [],
  }
}
seed()
const ok = await cancelRunById({ telegramId: '42' }, 'run-mine', { db, now, surface: 'dashboard' })
assert.equal(ok.ok, true, 'owner cancels own waiting_approval run')
const mine = stores.agent_runs.find(r => r.id === 'run-mine')!
assert.equal(mine.status, 'failed'); assert.equal(mine.error, 'user_cancelled')
assert.equal(mine.metadata_json.cancelled_from, 'dashboard')
assert.equal(taskStateOf(mine), 'cancelled', 'a cancelled run reads Cancelled')
assert.equal(stores.agent_approvals.find(a => a.id === 'ap1')!.status, 'rejected', 'pending approval closed')
assert.equal(stores.agent_approvals.find(a => a.id === 'ap1')!.resolution_note, 'cancelled_by_user')
assert.equal(stores.agent_approvals.find(a => a.id === 'ap-other')!.status, 'pending', "another owner's approval untouched")
assert.equal(stores.agent_steps[0].status, 'cancelled')
assert.equal(stores.agent_activity.length, 1)
assert.equal(stores.agent_activity[0].event_type, 'agent_run_cancelled_by_user')
assert.equal(stores.agent_activity[0].metadata_json.surface, 'dashboard')
assert.ok(reads.some(r => r.table === 'agent_runs' && r.filters.some(([op, c, v]: any) => op === 'eq' && c === 'telegram_id' && v === '42')), 'read is owner-scoped')

const other = await cancelRunById({ telegramId: '42' }, 'run-other', { db, now })
assert.equal(other.ok, false); assert.equal((other as any).error, 'not_found', "can't cancel someone else's run")
assert.equal(stores.agent_runs.find(r => r.id === 'run-other')!.status, 'running')
for (const id of ['run-done', 'run-unknown', 'run-mine']) {
  const res = await cancelRunById({ telegramId: '42' }, id, { db, now })
  assert.equal(res.ok, false, id); assert.equal((res as any).error, 'not_cancellable', id)
}
assert.equal(stores.agent_runs.find(r => r.id === 'run-done')!.status, 'completed')
assert.equal(stores.agent_activity.length, 1, 'refusals write no activity')

// Chat cancel behaviour is unchanged by the shared core.
seed()
const chat = await tryCancelRunFromChat({ telegramId: '42' }, 'cancel that task', { db, now })
assert.equal(chat?.status, 'completed'); assert.match(chat!.text, /^Cancelled: .+\. Nothing further will run for it\.$/)
assert.equal(stores.agent_activity[0].metadata_json.surface, 'chat')

// ---- 3. Source assertions: the route is owner-scoped and the UI uses the labels
const route = readFileSync('app/api/agent/runs/[id]/cancel/route.ts', 'utf8')
assert.match(route, /requireAgentMutationOrigin\(request\)/)
assert.match(route, /requireAgentSession\(request\)/)
assert.match(route, /cancelRunById\(\{ telegramId: session\.telegramId \}, id/)
assert.doesNotMatch(route, /supabaseAdmin/, 'route writes only through the owner-scoped core')
const core = readFileSync('lib/agent/run-cancel.ts', 'utf8')
const byId = core.slice(core.indexOf('export async function cancelRunById'))
assert.match(byId, /\.eq\('id', id\)\s*\.eq\('telegram_id', tg\)/)
assert.match(byId, /CANCELLABLE_RUN_STATUSES as readonly string\[\]\)\.includes\(String\(run\.status\)\)/)
assert.match(core, /\.eq\('id', runId\)\s*\.eq\('telegram_id', tg\)\s*\.in\('status', \[\.\.\.CANCELLABLE_RUN_STATUSES\]\)/, 'update guarded on owner + status')
const detail = readFileSync('app/dashboard/(app)/activity/[runId]/page.tsx', 'utf8')
assert.match(detail, /TASK_STATE_LABEL\[taskState\]/)
assert.match(detail, /cancellable&&/)
assert.match(detail, /<CancelTaskButton runId=\{run\.id\}\/>/)
const button = readFileSync('components/dashboard/cancel-task-button.tsx', 'utf8')
assert.match(button, /Cancel this task\? Nothing more will be done\./)
assert.match(button, />Keep it</)
assert.doesNotMatch(button.replace(/^\/\/.*$/gm, ''), /\b(?:window\.)?confirm\(/, 'no browser confirm() dialog')
assert.match(button, /min-h-11/)
const feed = readFileSync('lib/dashboard/task-feed.ts', 'utf8')
assert.match(feed, /tag: taskStateLabel\(r\)/)
assert.match(feed, /TASK_STATE_LABEL\.gogo_thinks_done/)
const agent = readFileSync('app/dashboard/(app)/agent/page.tsx', 'utf8')
assert.doesNotMatch(agent, /\{r\.status\} · \{r\.capability\}/, 'no raw "completed · browser" badge')
assert.match(readFileSync('app/api/agent/snapshot/route.ts', 'utf8'), /stateLabel: taskStateLabel\(r\)/)
console.log('verify-task-ownership: ok')
