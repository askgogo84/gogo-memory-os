// Tasks › Overview (Addendum 5, Goal-to-Done; approved mock "Tasks: who does what"): every task grouped by who does the
// next step — Gogo handles · We do together · Your turn — with its one state, then what finished, then four numbers.
// Read-only over the same tables Tasks already reads. Off unless GOGO_TASKS_OWNERSHIP is "on" or lists this owner.
//
// The numbers (last 30 days):
// - Done and checked: finished runs with evidence from someone other than the agent (task-ownership.ts doneEvidenceOf).
// - Need you: open drafts, approvals, blocked runs and runs whose outcome is unknown.
// - Time saved, estimated: for each finished run (checked or not; never a draft, a failure or an unknown), the minutes
//   in TIME_SAVED_MINUTES for its kind, summed. A fixed table, shown as an estimate with this method linked; it is not
//   measured and never includes work that only produced a draft.
// - Runs that worked: finished ÷ (finished + failed). Unknown outcomes are left out of both and shown on their own.
// - Handed to Gogo: tasks Gogo took on ÷ (those + your own to-dos), by creation time.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { retiredRunReason } from '@/lib/agent/task-lifecycle'
import { isStaleRunning } from '@/lib/agent/stale-runs'
import { readableRunSummary } from '@/lib/dashboard/readable-summary'
import { friendlyTaskTitle } from '@/lib/agent/task-title'
import { exactSessionOwnerId } from '@/lib/dashboard/owner-identity'
import { ATTENTION_STATES, DONE_STATE_LABEL, OPEN_STATES, OWNERSHIP_ORDER, doneStateOf, ownershipOf, type DoneState, type TaskOwnership } from '@/lib/agent/task-ownership'

type Env = Record<string, string | undefined>
export function goalBoardEnabledFor(owner: string, env: Env = process.env): boolean {
  const v = String(env.GOGO_TASKS_OWNERSHIP || '').trim()
  if (v === 'on') return true
  return Boolean(owner) && v.split(',').map(s => s.trim().replace(/^\+/, '')).filter(Boolean).some(s => s === owner || s === owner.replace(/^91/, '') || `91${s}` === owner)
}

/** Minutes a person would typically spend doing this kind of task by hand. Conservative, fixed, documented in
 *  docs/architecture/same-brain-3/06-goal-to-done.md. Unknown kinds count 5. */
export const TIME_SAVED_MINUTES: Record<string, number> = {
  reminder: 2, list: 2, memory: 1, calendar: 4, web_search: 10, research: 15, travel: 20, flight: 20,
  comparison: 15, price: 10, booking: 10, reservation: 10, watcher: 5, artifact: 20, document: 20, events: 10,
}
export const TIME_SAVED_DEFAULT = 5
export function minutesSavedFor(run: any): number {
  const kind = `${run?.type || ''} ${run?.capability || ''}`.toLowerCase()
  let best = 0
  for (const [k, m] of Object.entries(TIME_SAVED_MINUTES)) if (kind.includes(k)) best = Math.max(best, m)
  return best || TIME_SAVED_DEFAULT
}

export type BoardItem = { id: string; title: string; sub: string; state: DoneState; label: string; ownership: TaskOwnership; href: string; at: string | null }
export type BoardMetrics = { doneChecked: number; needYou: number; minutesSaved: number; worked: number; failed: number; unknown: number; handedToGogo: number; ownTodos: number }
export type GoalBoard = {
  groups: Record<TaskOwnership, BoardItem[]>
  done: BoardItem[]
  counts: { running: number; waiting: number; verified: number }
  metrics: BoardMetrics
  unavailable: boolean
}
export const EMPTY_BOARD: GoalBoard = { groups: { gogo_handles: [], together: [], your_turn: [] }, done: [], counts: { running: 0, waiting: 0, verified: 0 }, metrics: { doneChecked: 0, needYou: 0, minutesSaved: 0, worked: 0, failed: 0, unknown: 0, handedToGogo: 0, ownTodos: 0 }, unavailable: false }

const WINDOW_DAYS = 30
// Background reads that belong to another task (a price comparison's store page, a venue lookup) are not tasks of
// their own; their parent is.
const childRun = (r: any) => { const m = r?.metadata_json || {}; return Boolean(m.comparison_parent_id || m.commerce_parent_id || m.venue_browse || m.parent_goal_child_of_run) }

/** Pure: builds the board from rows already read. `approvals` are pending approvals; `todos` the owner's own to-dos. */
export function buildGoalBoard(input: { runs: any[]; approvals?: any[]; todos?: { createdAt: string | null }[]; now?: Date }): GoalBoard {
  const now = input.now || new Date(), since = now.getTime() - WINDOW_DAYS * 86_400_000
  const inWindow = (at: unknown) => { const t = Date.parse(String(at || '')); return Number.isFinite(t) && t >= since }
  const board: GoalBoard = JSON.parse(JSON.stringify(EMPTY_BOARD))
  const seen = new Set<string>()
  const runs = (input.runs || []).filter(r => r && r.id && !childRun(r) && !retiredRunReason(r, now.getTime()))
    // A run stuck in "running" for hours lost its worker: it is not live work.
    .map(r => (isStaleRunning(r, now) ? { ...r, status: 'failed', error: r.error || 'stale_run_recovered' } : r))
  for (const r of runs) {
    const id = String(r.id)
    if (seen.has(id)) continue
    seen.add(id)
    const state = doneStateOf(r)
    if (state === 'cancelled') continue
    const item: BoardItem = { id, title: friendlyTaskTitle(r.title || 'Gogo task'), sub: readableRunSummary(r.summary) || '', state, label: DONE_STATE_LABEL[state],
      ownership: ownershipOf(r, state), href: `/dashboard/activity/${encodeURIComponent(id)}`, at: r.updated_at || r.started_at || null }
    if (OPEN_STATES.has(state)) board.groups[item.ownership].push(item)
    else if (inWindow(item.at) && (state === 'verified' || state === 'done_unverified')) board.done.push(item)
    if (state === 'running' || state === 'queued') board.counts.running++
    if (state === 'waiting_external') board.counts.waiting++
    if (inWindow(item.at)) {
      if (state === 'verified') { board.counts.verified++; board.metrics.doneChecked++ }
      if (state === 'verified' || state === 'done_unverified') { board.metrics.worked++; board.metrics.minutesSaved += minutesSavedFor(r) }
      if (state === 'failed') board.metrics.failed++
      if (state === 'unknown') board.metrics.unknown++
    }
    if (ATTENTION_STATES.has(state)) board.metrics.needYou++
    if (inWindow(r.started_at || r.created_at || r.updated_at)) board.metrics.handedToGogo++
  }
  // A pending approval whose run is not shown (a run outside the rows read, or no run) is still the owner's to see.
  for (const a of input.approvals || []) {
    const runId = String(a?.run_id || '')
    if (!a?.id || (runId && seen.has(runId))) continue
    board.groups.together.push({ id: `ap-${a.id}`, title: String(a.title || 'Approval needed').slice(0, 160), sub: String(a.description || 'Gogo stopped before a consequential action.').slice(0, 300),
      state: 'waiting_approval', label: DONE_STATE_LABEL.waiting_approval, ownership: 'together', href: '/dashboard/agent?section=approvals', at: a.created_at || null })
    board.metrics.needYou++
  }
  board.metrics.ownTodos = (input.todos || []).filter(t => inWindow(t?.createdAt)).length
  const newest = (a: BoardItem, b: BoardItem) => Date.parse(String(b.at || 0)) - Date.parse(String(a.at || 0))
  // Within a group: what needs the owner first, then what is moving, newest first.
  const rank = (s: DoneState) => (ATTENTION_STATES.has(s) ? 0 : s === 'running' || s === 'queued' ? 1 : 2)
  for (const o of OWNERSHIP_ORDER) board.groups[o].sort((a, b) => rank(a.state) - rank(b.state) || newest(a, b)).splice(12)
  board.done.sort((a, b) => Number(b.state === 'verified') - Number(a.state === 'verified') || newest(a, b)).splice(8)
  return board
}

/** Reads the owner's rows and builds the board. Never throws; an unreadable source shows as unavailable. */
export async function getGoalBoard(telegramId: string, todos: { createdAt: string | null }[] = [], now = new Date(), db: any = supabaseAdmin): Promise<GoalBoard> {
  const owner = exactSessionOwnerId(telegramId)
  if (owner === null) return EMPTY_BOARD
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()
  try {
    const [open, recent, approvals] = await Promise.all([
      db.from('agent_runs').select('id,type,capability,title,summary,status,error,metadata_json,started_at,updated_at')
        .eq('telegram_id', String(owner)).in('status', ['queued', 'running', 'watching', 'waiting_approval', 'paused', 'outcome_unknown']).order('updated_at', { ascending: false }).limit(60),
      db.from('agent_runs').select('id,type,capability,title,summary,status,error,metadata_json,started_at,updated_at')
        .eq('telegram_id', String(owner)).in('status', ['completed', 'failed']).gte('updated_at', since).order('updated_at', { ascending: false }).limit(200),
      db.from('agent_approvals').select('id,run_id,title,description,created_at').eq('telegram_id', String(owner)).eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
    ])
    const failed = [open, recent, approvals].some((r: any) => r?.error)
    const board = buildGoalBoard({ runs: [...(open?.data || []), ...(recent?.data || [])], approvals: approvals?.data || [], todos, now })
    return { ...board, unavailable: failed }
  } catch (err: any) {
    console.error('GOAL_BOARD_FAILED:', String(err?.message || 'error').slice(0, 120))
    return { ...EMPTY_BOARD, unavailable: true }
  }
}

/** "about 3 h", "about 40 min", "none yet". */
export function minutesLabel(min: number): string {
  if (!(min > 0)) return 'none yet'
  if (min < 60) return `about ${Math.round(min / 5) * 5 || 5} min`
  const h = min / 60
  return `about ${h < 10 ? Math.round(h * 2) / 2 : Math.round(h)} h`
}
