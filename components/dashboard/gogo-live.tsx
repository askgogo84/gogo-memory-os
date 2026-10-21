'use client'

// One live view of what Gogo is doing, shared by the side rail counts, the Muse-style right panel, the phone sheet
// and the phone top bar. It reads /api/agent/snapshot once per page change (and every 30 s while the tab is
// visible), so these surfaces never disagree or fetch the same data twice.
import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { readableRunSummary } from '@/lib/dashboard/readable-summary'
import {
  GOGO_STATE_LINE, GOGO_STATE_NAME, liveLineFor, stateForHandoff, stateForRun, type GogoAgentState,
} from '@/lib/gogo/agent-states'

export type LiveRow = { id: string; state: GogoAgentState; title: string; sub: string; at: string; live: string; href: string }
export type PanelTab = 'activity' | 'approvals' | 'scheduled' | 'files'
export type LiveCounts = { approvals: number; watchers: number; handoffs: number; serviceNotices?: number; working: number; unavailable?: boolean }
export type LiveHero = { state: GogoAgentState; name: string; live: string; task: string; href: string | null }

type Live = {
  loaded: boolean
  counts: LiveCounts
  feeds: Record<PanelTab, LiveRow[]>
  hero: LiveHero
  recent: { id: string; title: string; href: string }[]
  sheetOpen: boolean
  openSheet: () => void
  closeSheet: () => void
  /** Desktop right panel (xl+): closed by default for a clean, chat-first screen (Wajo layout); remembered. */
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  /** "Show what Gogo is doing": the right panel on wide screens, the bottom sheet elsewhere. */
  showGogo: () => void
}

const PANEL_OPEN_KEY = 'askgogo-panel-open'
const EMPTY_FEEDS: Record<PanelTab, LiveRow[]> = { activity: [], approvals: [], scheduled: [], files: [] }
const IDLE_HERO: LiveHero = { state: 'idle', name: GOGO_STATE_NAME.idle, live: GOGO_STATE_LINE.idle, task: 'Nothing running right now', href: null }
const Ctx = createContext<Live>({
  loaded: false, counts: { approvals: 0, watchers: 0, handoffs: 0, working: 0 }, feeds: EMPTY_FEEDS, hero: IDLE_HERO,
  recent: [], sheetOpen: false, openSheet: () => {}, closeSheet: () => {}, panelOpen: false, setPanelOpen: () => {}, showGogo: () => {},
})

function clock(iso?: string | null) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return ''
  const d = new Date(iso)
  const fmt = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(x)
  if (fmt(d) === fmt(new Date())) return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(d)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(d)
}
const WORKING = new Set(['running', 'queued'])
const short = (s: string, n = 110) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/** Turn the agent snapshot into the panel's four lists, the hero Gogo and the counts. Exported for tests. */
type LiveControls = 'sheetOpen' | 'openSheet' | 'closeSheet' | 'panelOpen' | 'setPanelOpen' | 'showGogo'
export function buildLive(data: any): Omit<Live, LiveControls | 'loaded'> {
  const runs: any[] = Array.isArray(data?.runs) ? data.runs.filter((r: any) => r && r.status !== 'closed') : []
  const approvals: any[] = Array.isArray(data?.approvals) ? data.approvals : []
  const handoffs: any[] = Array.isArray(data?.handoffs) ? data.handoffs : []
  const watchers: any[] = Array.isArray(data?.watchers) ? data.watchers : []
  const artifacts: any[] = Array.isArray(data?.artifacts) ? data.artifacts : []

  const runRow = (r: any): LiveRow => {
    const state = stateForRun(r)
    const sub = readableRunSummary(String(r.summary || '')) || ''
    return { id: `run-${r.id}`, state, title: String(r.title || 'Gogo task'), sub: short(sub), at: clock(r.updatedAt), live: liveLineFor(state, sub), href: `/dashboard/activity/${encodeURIComponent(String(r.id))}` }
  }
  // Several stops on the same site are one thing to do, as on Home.
  const handoffGroups = [...new Map(handoffs.map((h: any) => [String(h?.title || h?.id), h])).values()]
  const feeds: Record<PanelTab, LiveRow[]> = {
    activity: runs.slice(0, 8).map(runRow),
    approvals: [
      ...approvals.map((a: any): LiveRow => ({ id: `ap-${a.id}`, state: 'approval', title: String(a.title || 'Approval needed'), sub: short(String(a.description || 'Gogo stopped before a consequential action.')), at: clock(a.requestedAt), live: GOGO_STATE_LINE.approval, href: '/dashboard/agent?section=approvals' })),
      ...handoffGroups.map((h: any): LiveRow => {
        const state = stateForHandoff(h)
        return { id: `ho-${h.id}`, state, title: String(h.title || 'A site needs you'), sub: short(readableRunSummary(String(h.summary || '')) || 'Open it to continue.'), at: clock(h.updatedAt || h.createdAt), live: GOGO_STATE_LINE[state], href: `/dashboard/activity/${encodeURIComponent(String(h.id))}/browser` }
      }),
    ],
    scheduled: watchers.map((w: any): LiveRow => ({ id: `w-${w.id}`, state: 'watcher', title: String(w.title || 'Background watch'), sub: w.nextCheckAt ? `Next check ${clock(w.nextCheckAt)}` : String(w.type || 'watch').replaceAll('_', ' '), at: w.cadenceMinutes ? (w.cadenceMinutes >= 60 ? `Every ${Math.round(w.cadenceMinutes / 60)} h` : `Every ${w.cadenceMinutes} min`) : '', live: GOGO_STATE_LINE.watcher, href: '/dashboard/agent?section=background' })),
    files: artifacts.slice(0, 8).map((a: any): LiveRow => ({ id: `f-${a.id}`, state: 'done', title: String(a.title || 'Saved result'), sub: short(String(a.subtitle || String(a.type || '').replaceAll('_', ' '))), at: clock(a.updatedAt), live: 'Saved for you', href: '/dashboard/library' })),
  }
  const working = runs.filter(r => WORKING.has(String(r.status)))
  const first = working[0] ? runRow(working[0]) : feeds.approvals[0] || feeds.scheduled[0] || null
  const hero: LiveHero = first ? { state: first.state, name: GOGO_STATE_NAME[first.state], live: first.live, task: first.title, href: first.href } : IDLE_HERO
  return {
    counts: {
      approvals: approvals.length, handoffs: handoffGroups.length, watchers: watchers.length, working: working.length,
      serviceNotices: Number(data?.serviceNoticeCount ?? data?.serviceNotices?.length ?? 0), unavailable: false,
    },
    feeds, hero,
    recent: runs.slice(0, 5).map((r: any) => ({ id: String(r.id), title: String(r.title || 'Gogo task'), href: `/dashboard/activity/${encodeURIComponent(String(r.id))}` })),
  }
}

export function GogoLiveProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [state, setState] = useState<Omit<Live, LiveControls>>({ loaded: false, counts: { approvals: 0, watchers: 0, handoffs: 0, working: 0 }, feeds: EMPTY_FEEDS, hero: IDLE_HERO, recent: [] })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [panelOpen, setPanelOpenState] = useState(false)
  useEffect(() => { try { setPanelOpenState(window.localStorage.getItem(PANEL_OPEN_KEY) === '1') } catch {} }, [])
  const setPanelOpen = useCallback((open: boolean) => { setPanelOpenState(open); try { window.localStorage.setItem(PANEL_OPEN_KEY, open ? '1' : '0') } catch {} }, [])
  const alive = useRef(true)

  const load = useCallback(() => {
    fetch('/api/agent/snapshot', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!alive.current) return
        if (!data) { setState(s => ({ ...s, loaded: true, counts: { ...s.counts, unavailable: true } })); return }
        setState({ loaded: true, ...buildLive(data) })
      })
      .catch(() => { if (alive.current) setState(s => ({ ...s, loaded: true, counts: { ...s.counts, unavailable: true } })) })
  }, [])

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { load(); setSheetOpen(false) }, [pathname, load])
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    return () => window.clearInterval(timer)
  }, [load])
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheetOpen])

  const value = useMemo<Live>(() => ({
    ...state, sheetOpen, openSheet: () => setSheetOpen(true), closeSheet: () => setSheetOpen(false), panelOpen, setPanelOpen,
    showGogo: () => {
      const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1280px)').matches
      if (wide) setPanelOpen(!panelOpen); else setSheetOpen(true)
    },
  }), [state, sheetOpen, panelOpen, setPanelOpen])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useGogoLive() { return useContext(Ctx) }
