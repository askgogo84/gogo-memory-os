// Home and Tasks share one feed (approved 21 Oct mock): Needs you · On radar · Recent, each item carrying the Gogo
// character state for its action and a short live line. Server-only; reads the same tables Home always read.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getPendingBrowserHandoffs } from '@/lib/dashboard/human-handoffs'
import { retiredRunReason } from '@/lib/agent/task-lifecycle'
import { isStaleRunning } from '@/lib/agent/stale-runs'
import { readableRunSummary } from '@/lib/dashboard/readable-summary'
import { friendlyTaskTitle } from '@/lib/agent/task-title'
import { GOGO_STATE_LINE, liveLineFor, stateForHandoff, stateForRun, type GogoAgentState } from '@/lib/gogo/agent-states'

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
}
export type TaskFeed = { need: FeedItem[]; radar: FeedItem[]; recent: FeedItem[]; recentUnavailable: boolean; radarCount: number }

export const EMPTY_FEED: TaskFeed = { need: [], radar: [], recent: [], recentUnavailable: false, radarCount: 0 }

export function feedTab(raw: unknown): FeedTab {
  return raw === 'radar' || raw === 'recent' ? raw : 'need'
}

function recentTag(status: string) {
  if (status === 'completed') return 'Finished'
  if (status === 'failed') return 'Could not finish'
  return 'Paused'
}

export async function getTaskFeed(telegramId: string, now = new Date()): Promise<TaskFeed> {
  const tg = String(telegramId || '')
  if (!tg) return EMPTY_FEED
  const [approvals, handoffs, watchers, running, recent] = await Promise.all([
    supabaseAdmin.from('agent_approvals').select('id,run_id,title,description,created_at').eq('telegram_id', tg).eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
    getPendingBrowserHandoffs(tg),
    supabaseAdmin.from('agent_watchers').select('id,title,type,next_check_at,condition_json', { count: 'exact' }).eq('telegram_id', tg).eq('active', true).neq('type', 'goal_review').order('next_check_at', { ascending: true }).limit(12),
    supabaseAdmin.from('agent_runs').select('id,type,capability,title,summary,status,error,metadata_json,updated_at').eq('telegram_id', tg).in('status', ['running', 'queued']).order('updated_at', { ascending: false }).limit(8),
    supabaseAdmin.from('agent_runs').select('id,type,capability,title,summary,status,source,error,metadata_json,updated_at')
      .eq('telegram_id', tg).in('status', ['completed', 'paused', 'failed']).neq('type', 'secure_browser')
      .order('updated_at', { ascending: false }).limit(20),
  ])
  const approvalRows: any[] = (approvals as any)?.data || []
  const need: FeedItem[] = approvalRows.map(a => ({
    id: `ap-${a.id}`, tab: 'need', state: 'approval', tag: 'Needs your yes', title: a.title || 'Approval needed',
    sub: a.description || 'Gogo stopped before a consequential action.', live: GOGO_STATE_LINE.approval,
    href: '/dashboard/agent?section=approvals', action: 'Review', at: a.created_at || null,
  }))
  // Several stops on the same site are one thing to do: one row with a count.
  const handoffRows = (handoffs || []).filter(h => !approvalRows.some(a => String(a.run_id) === h.id))
  const groups = [...handoffRows.reduce((map, h) => { const g = map.get(h.title); if (g) g.count += 1 + h.repeats; else map.set(h.title, { first: h, count: 1 + h.repeats }); return map }, new Map<string, { first: typeof handoffRows[number]; count: number }>()).values()]
  for (const { first, count } of groups) {
    const state = stateForHandoff(first)
    need.push({
      id: `ho-${first.id}`, tab: 'need', state, tag: state === 'otp' ? 'Code needed' : 'Sign-in needed', title: friendlyTaskTitle(first.title),
      sub: count > 1 ? `Stopped here ${count} times. Latest: ${readableRunSummary(first.summary)}` : readableRunSummary(first.summary),
      live: GOGO_STATE_LINE[state], href: count > 1 ? '/dashboard/agent?section=approvals' : `/dashboard/activity/${first.id}/browser`,
      action: count > 1 ? 'Open' : 'Take control', at: first.updatedAt,
    })
  }

  const radar: FeedItem[] = []
  // A task stuck in running for hours lost its worker; it is not "now" work.
  for (const r of ((running as any)?.data || []).filter((r: any) => !isStaleRunning(r, now) && !retiredRunReason(r))) {
    const state = stateForRun(r)
    const sub = readableRunSummary(r.summary) || 'Gogo is working on it.'
    radar.push({ id: `run-${r.id}`, tab: 'radar', state, tag: 'Working now', title: friendlyTaskTitle(r.title || 'Gogo task'), sub, live: liveLineFor(state, sub), href: `/dashboard/activity/${r.id}`, action: 'Watch', at: r.updated_at || null })
  }
  const workingCount = radar.length
  for (const w of ((watchers as any)?.data || [])) {
    const title = String(w.title || w.condition_json?.title || 'Background watch').replace(/\b(\d+\s*(?:GB|TB))\s+\1\b/gi, '$1')
    radar.push({ id: `w-${w.id}`, tab: 'radar', state: 'watcher', tag: 'On radar', title, sub: String(w.type || 'watch').replaceAll('_', ' '), live: GOGO_STATE_LINE.watcher, href: '/dashboard/agent?section=background', action: 'Open', at: w.next_check_at || null })
  }

  const recentRows: any[] = ((recent as any)?.data || []).filter((run: any) => !retiredRunReason(run))
    // The same background check repeated (status unchanged, three times) is one update, not three.
    .filter((run: any, i: number, all: any[]) => all.findIndex((x: any) => x.title === run.title && x.summary === run.summary && x.status === run.status) === i)
    .slice(0, 12)
  const recentItems: FeedItem[] = recentRows.map(r => {
    const state = stateForRun(r)
    return { id: `run-${r.id}`, tab: 'recent', state, tag: recentTag(String(r.status)), title: friendlyTaskTitle(r.title || 'Gogo task'), sub: readableRunSummary(r.summary) || 'Open the task to see what happened.', live: GOGO_STATE_LINE[state], href: `/dashboard/activity/${encodeURIComponent(String(r.id))}`, action: 'Details', at: r.updated_at || null }
  })
    // The tab count is the untruncated total, not the display rows (12 shown of 30 watches still says 30).
  const watcherTotal = Number((watchers as any)?.count ?? ((watchers as any)?.data || []).length)
  return { need, radar, recent: recentItems, recentUnavailable: Boolean((recent as any)?.error), radarCount: workingCount + watcherTotal }
}
