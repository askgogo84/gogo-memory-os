// Home and Tasks share one feed (approved 21 Oct mock): Needs you · On radar · Recent, each item carrying the Gogo
// character state for its action and a short live line. Server-only; reads the same tables Home always read.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getPendingBrowserHandoffs } from '@/lib/dashboard/human-handoffs'
import { retiredRunReason } from '@/lib/agent/task-lifecycle'
import { isStaleRunning } from '@/lib/agent/stale-runs'
import { readableRunSummary } from '@/lib/dashboard/readable-summary'
import { friendlyTaskTitle } from '@/lib/agent/task-title'
import { GOGO_STATE_LINE, liveLineFor, stateForHandoff, stateForRun, type GogoAgentState } from '@/lib/gogo/agent-states'
import { CONFIRM_MAX, CONFIRMABLE_RUN_TYPES, continuePrompt, needsOwnerConfirmation, ownerConfirmationOf, ownerReopened, watchEnds, watchWhy } from '@/lib/agent/owner-confirmation'
// Every run card's tag is its one owner-facing state (Working now · Needs you · Gogo thinks it's done · Done …).
import { TASK_STATE_LABEL, taskStateLabel } from '@/lib/dashboard/task-state'

export type FeedTab = 'need' | 'radar' | 'recent'
export type FeedItem = {
  id: string
  tab: FeedTab
  state: GogoAgentState
  tag: string
  title: string
  sub: string
  live: string
  href: string
  action: string
  at: string | null
  /** Duet parity: a finished task waiting for the owner's Mark complete / Not yet. */
  confirm?: { runId: string; runIds?: string[]; continueHref: string }
}
export type TaskFeed = { need: FeedItem[]; radar: FeedItem[]; recent: FeedItem[]; recentUnavailable: boolean; radarCount: number }

export const EMPTY_FEED: TaskFeed = { need: [], radar: [], recent: [], recentUnavailable: false, radarCount: 0 }

/** Cloud takeover sessions last 20 minutes (secure-computer.ts sandbox timeout); 25 allows for clock skew. */
export function cloudHandoffLikelyClosed(h: { cloud?: boolean; updatedAt?: string | null }, now = new Date()): boolean {
  const at = Date.parse(String(h?.updatedAt || ''))
  return Boolean(h?.cloud) && Number.isFinite(at) && now.getTime() - at > 25 * 60_000
}

export function feedTab(raw: unknown): FeedTab {
  return raw === 'radar' || raw === 'recent' ? raw : 'need'
}


export async function getTaskFeed(telegramId: string, now = new Date()): Promise<TaskFeed> {
  const tg = String(telegramId || '')
  if (!tg) return EMPTY_FEED
  const [approvals, handoffs, watchers, running, recent, finished, deferred, clashes] = await Promise.all([
    supabaseAdmin.from('agent_approvals').select('id,run_id,title,description,created_at').eq('telegram_id', tg).eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
    getPendingBrowserHandoffs(tg),
    supabaseAdmin.from('agent_watchers').select('id,title,type,next_check_at,created_at,condition_json', { count: 'exact' }).eq('telegram_id', tg).eq('active', true).neq('type', 'goal_review').order('next_check_at', { ascending: true }).limit(12),
    supabaseAdmin.from('agent_runs').select('id,type,capability,title,summary,status,error,metadata_json,updated_at').eq('telegram_id', tg).in('status', ['running', 'queued']).order('updated_at', { ascending: false }).limit(8),
    supabaseAdmin.from('agent_runs').select('id,type,capability,title,summary,status,source,error,metadata_json,updated_at')
      .eq('telegram_id', tg).in('status', ['completed', 'paused', 'failed']).neq('type', 'secure_browser')
      .order('updated_at', { ascending: false }).limit(20),
    // Outcome tasks Gogo finished recently: the owner confirms them (Duet parity) or sends them back.
    supabaseAdmin.from('agent_runs').select('id,type,title,summary,status,error,metadata_json,updated_at')
      .eq('telegram_id', tg).eq('status', 'completed').in('type', [...CONFIRMABLE_RUN_TYPES])
      .gte('updated_at', new Date(now.getTime() - 30 * 86_400_000).toISOString())
      .order('updated_at', { ascending: false }).limit(40),
    // Approval card v2 "Later": the owner deferred these; they stay pending but stop leading Needs you.
    supabaseAdmin.from('agent_activity').select('metadata_json').eq('telegram_id', tg).eq('event_type', 'approval_deferred')
      .gte('created_at', new Date(now.getTime() - 86_400_000).toISOString()).limit(50),
    // Calendar clashes Gogo discovered on its own (open-loops scout, complete Calendar reads only).
    supabaseAdmin.from('agent_open_loops').select('id,title,summary,due_at,updated_at').eq('telegram_id', tg).eq('status', 'active')
      .eq('source_type', 'calendar_conflict').gte('due_at', now.toISOString()).order('due_at', { ascending: true }).limit(5),
  ])
  const deferredUntil = new Map<string, number>()
  for (const row of ((deferred as any)?.data || [])) {
    const id = String(row?.metadata_json?.approval_id || ''), until = Date.parse(String(row?.metadata_json?.until || ''))
    if (id && Number.isFinite(until) && until > now.getTime()) deferredUntil.set(id, Math.max(until, deferredUntil.get(id) || 0))
  }
  const approvalRows: any[] = (approvals as any)?.data || []
  const need: FeedItem[] = approvalRows.map(a => {
    const later = deferredUntil.get(String(a.id))
    const back = later ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(later)) : ''
    return {
      id: `ap-${a.id}`, tab: 'need' as const, state: 'approval' as const, tag: later ? 'Later' : 'Needs your yes', title: a.title || 'Approval needed',
      sub: later ? `You said later. Gogo asks again at ${back}.` : a.description || 'Gogo stopped before a consequential action.', live: GOGO_STATE_LINE.approval,
      href: '/dashboard/agent?section=approvals', action: 'Review', at: a.created_at || null,
    }
  })
  for (const c of ((clashes as any)?.data || [])) need.push({
    id: `cc-${c.id}`, tab: 'need', state: 'thinking', tag: 'Calendar clash', title: String(c.title || 'Calendar clash').slice(0, 160),
    sub: String(c.summary || 'Two things overlap on your calendar.').slice(0, 300), live: 'Found on your calendar',
    href: '/dashboard/calendar', action: 'Open calendar', at: c.updated_at || null,
  })
  // Several stops on the same site are one thing to do: one row with a count.
  const handoffRows = (handoffs || []).filter(h => !approvalRows.some(a => String(a.run_id) === h.id))
  const groups = [...handoffRows.reduce((map, h) => { const g = map.get(h.title); if (g) g.count += 1 + h.repeats; else map.set(h.title, { first: h, count: 1 + h.repeats }); return map }, new Map<string, { first: typeof handoffRows[number]; count: number }>()).values()]
  for (const { first, count } of groups) {
    const state = stateForHandoff(first)
    // 22 Oct live ("When I tried to take control"): the cloud browser closes after 20 minutes, but the card still said
    // Take control. A cloud handoff older than that says Restart; the browser page checks it live and offers restore.
    const closed = cloudHandoffLikelyClosed(first, now)
    need.push({
      id: `ho-${first.id}`, tab: 'need', state, tag: closed ? 'Browser closed' : state === 'otp' ? 'Code needed' : 'Sign-in needed', title: friendlyTaskTitle(first.title),
      sub: closed ? 'The secure browser closed after 20 minutes. Open it to restart the same task.' : count > 1 ? `Stopped here ${count} times. Latest: ${readableRunSummary(first.summary)}` : readableRunSummary(first.summary),
      live: GOGO_STATE_LINE[state], href: count > 1 ? '/dashboard/agent?section=approvals' : `/dashboard/activity/${first.id}/browser`,
      action: closed ? 'Restart' : count > 1 ? 'Open' : 'Take control', at: first.updatedAt,
    })
  }

  // Sent back by the owner first (they are waiting on Gogo to hear what is missing), then Gogo's "done?" asks.
  const finishedRows: any[] = ((finished as any)?.data || []).filter((r: any) => !retiredRunReason(r))
  for (const r of finishedRows.filter(ownerReopened).slice(0, CONFIRM_MAX)) {
    const title = friendlyTaskTitle(r.title || 'Gogo task')
    need.push({ id: `re-${r.id}`, tab: 'need', state: 'blocked', tag: TASK_STATE_LABEL.needs_you, title, sub: 'Tell Gogo what is missing and it will pick this up again.',
      live: 'Waiting for you to say what is missing', href: `/dashboard/chat?prompt=${encodeURIComponent(continuePrompt(title))}`, action: 'Tell Gogo', at: r.updated_at || null })
  }
  // 22 Oct live: two "Travel task · BLR → DEL" runs (and two District 6 calls) showed as identical cards, so confirming
  // one looked like it "came back". Same-title finished tasks are one card; Mark complete confirms all of them.
  const confirmGroups = new Map<string, any[]>()
  // Once the owner marked a task complete, later re-runs with the same title (background re-checks) don't ask again
  // for a week; a new, differently named task still does.
  const confirmedTitles = new Set(finishedRows.filter(r => ownerConfirmationOf(r)?.decision === 'done'
    && now.getTime() - Date.parse(String(ownerConfirmationOf(r)?.at || '')) <= 7 * 86_400_000).map(r => friendlyTaskTitle(r.title || 'Gogo task').toLowerCase()))
  for (const r of finishedRows.filter(r => needsOwnerConfirmation(r, now.getTime()))) {
    const key = friendlyTaskTitle(r.title || 'Gogo task').toLowerCase()
    if (confirmedTitles.has(key)) continue
    const g = confirmGroups.get(key); if (g) g.push(r); else confirmGroups.set(key, [r])
  }
  for (const rows of [...confirmGroups.values()].slice(0, CONFIRM_MAX)) {
    const r = rows[0]
    const title = friendlyTaskTitle(r.title || 'Gogo task')
    const sub = readableRunSummary(r.summary) || 'Open it to check the result.'
    need.push({ id: `cf-${r.id}`, tab: 'need', state: 'done', tag: TASK_STATE_LABEL.gogo_thinks_done, title, sub: rows.length > 1 ? `${rows.length} runs. Latest: ${sub}` : sub,
      live: 'Only you mark it complete', href: `/dashboard/activity/${encodeURIComponent(String(r.id))}`, action: 'Details', at: r.updated_at || null,
      confirm: { runId: String(r.id), runIds: rows.map(x => String(x.id)), continueHref: `/dashboard/chat?prompt=${encodeURIComponent(continuePrompt(title))}` } })
  }


  // Deferred approvals wait at the end of Needs you (stable order otherwise).
  need.sort((x, y) => Number(x.tag === 'Later') - Number(y.tag === 'Later'))

  const radar: FeedItem[] = []
  // A task stuck in running for hours lost its worker; it is not "now" work.
  for (const r of ((running as any)?.data || []).filter((r: any) => !isStaleRunning(r, now) && !retiredRunReason(r))) {
    const state = stateForRun(r)
    const sub = readableRunSummary(r.summary) || 'Gogo is working on it.'
    radar.push({ id: `run-${r.id}`, tab: 'radar', state, tag: taskStateLabel(r), title: friendlyTaskTitle(r.title || 'Gogo task'), sub, live: liveLineFor(state, sub), href: `/dashboard/activity/${r.id}`, action: 'Watch', at: r.updated_at || null })
  }
  const workingCount = radar.length
  for (const w of ((watchers as any)?.data || [])) {
    const title = String(w.title || w.condition_json?.title || 'Background watch').replace(/\b(\d+\s*(?:GB|TB))\s+\1\b/gi, '$1')
    // Duet parity + R02: every watch says why it exists and when it ends; a watch whose own date is over says so.
    const ends = watchEnds(w, now)
    radar.push({ id: `w-${w.id}`, tab: 'radar', state: 'watcher', tag: ends.datePassed ? 'Date passed' : 'Watching', title, sub: `${watchWhy(w)} · ${ends.label}`,
      live: ends.datePassed ? 'Probably safe to stop' : GOGO_STATE_LINE.watcher, href: '/dashboard/agent?section=background', action: ends.datePassed ? 'Review' : 'Open', at: w.next_check_at || null })
  }

  const recentRows: any[] = ((recent as any)?.data || []).filter((run: any) => !retiredRunReason(run))
    // The same background check repeated (status unchanged, three times) is one update, not three.
    .filter((run: any, i: number, all: any[]) => all.findIndex((x: any) => x.title === run.title && x.summary === run.summary && x.status === run.status) === i)
    .slice(0, 12)
  const recentItems: FeedItem[] = recentRows.map(r => {
    const state = stateForRun(r)
    return { id: `run-${r.id}`, tab: 'recent', state, tag: taskStateLabel(r), title: friendlyTaskTitle(r.title || 'Gogo task'), sub: readableRunSummary(r.summary) || 'Open the task to see what happened.', live: GOGO_STATE_LINE[state], href: `/dashboard/activity/${encodeURIComponent(String(r.id))}`, action: 'Details', at: r.updated_at || null }
  })
    // The tab count is the untruncated total, not the display rows (12 shown of 30 watches still says 30).
  const watcherTotal = Number((watchers as any)?.count ?? ((watchers as any)?.data || []).length)
  return { need, radar, recent: recentItems, recentUnavailable: Boolean((recent as any)?.error), radarCount: workingCount + watcherTotal }
}
