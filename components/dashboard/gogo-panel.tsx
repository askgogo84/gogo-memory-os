'use client'

// Muse-style "what Gogo is doing" panel (approved 21 Oct mock). A big Gogo in the state of the selected row with its
// live line, then Activity / Approvals / Scheduled / Files — each row with its own small Gogo. Desktop (xl): a
// closable right column that becomes a floating Gogo button. Phone and tablet: the same body in a bottom sheet.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { GogoAgent } from '@/components/gogo/gogo-agent'
import { GOGO_STATE_NAME } from '@/lib/gogo/agent-states'
import { useGogoLive, type LiveRow, type PanelTab } from './gogo-live'

const TABS: { key: PanelTab; label: string; heading: string; empty: string }[] = [
  { key: 'activity', label: 'Activity', heading: 'Recent work', empty: 'Nothing running. Ask Gogo for something and it will show up here.' },
  { key: 'approvals', label: 'Approvals', heading: 'Waiting for you', empty: 'Nothing is waiting for you.' },
  { key: 'scheduled', label: 'Scheduled', heading: 'Running in the background', empty: 'No background watches yet.' },
  { key: 'files', label: 'Files', heading: 'Saved results', empty: 'Saved results and documents will appear here.' },
]
const PANEL_CLOSED_KEY = 'askgogo-panel-closed'

function PanelBody({ big }: { big: number }) {
  const { feeds, hero, loaded, counts } = useGogoLive()
  const [tab, setTab] = useState<PanelTab>('activity')
  const [picked, setPicked] = useState<string | null>(null)
  // Open on Approvals when something is waiting and nothing is running.
  useEffect(() => { if (loaded && !counts.working && feeds.approvals.length) setTab(t => (t === 'activity' ? 'approvals' : t)) }, [loaded, counts.working, feeds.approvals.length])
  const rows = feeds[tab]
  const sel: LiveRow | undefined = rows.find(r => r.id === picked)
  const show = sel ? { state: sel.state, name: GOGO_STATE_NAME[sel.state], live: sel.live, task: sel.title, href: sel.href } : hero
  const meta = TABS.find(t => t.key === tab)!
  return <div className="flex flex-col gap-3">
    <div className="flex flex-col items-center gap-1 text-center">
      <div className="grid w-full place-items-center rounded-[16px] py-1" style={{ background: 'radial-gradient(circle at 50% 55%, #2a1c12 0%, transparent 70%)' }}>
        <GogoAgent state={show.state} size={big}/>
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#ef7a27]">{show.name}</div>
      <div className="text-[15px] font-medium leading-snug text-[#f2efea]" aria-live="polite">{show.live}</div>
      {show.href ? <Link href={show.href} className="max-w-full truncate text-[12px] text-[#8a8a86] hover:text-[#f2efea]">{show.task} →</Link> : <div className="text-[12px] text-[#8a8a86]">{show.task}</div>}
    </div>
    <div role="tablist" aria-label="What Gogo is doing" className="grid grid-cols-4 gap-1 rounded-[12px] border border-[#222] bg-[#151515] p-1">
      {TABS.map(t => {
        const on = t.key === tab
        const n = feeds[t.key].length
        return <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => { setTab(t.key); setPicked(null) }}
          className={`min-h-10 rounded-[8px] text-[12px] font-medium ${on ? 'bg-[#232323] text-[#f2efea]' : 'text-[#9a9a96] hover:text-[#f2efea]'}`}>
          {t.label}{t.key === 'approvals' && n > 0 ? <span className="ml-1 text-[#ef7a27]">{n}</span> : null}
        </button>
      })}
    </div>
    <div className="text-[12px] font-medium uppercase tracking-[.06em] text-[#8a8a86]">{meta.heading}</div>
    <ul className="flex flex-col gap-0.5" role="tabpanel">
      {!loaded && <li className="py-3 text-[14px] text-[#8a8a86]">Loading…</li>}
      {loaded && counts.unavailable && <li className="py-3 text-[14px] text-[#d9a441]">Couldn’t load what Gogo is doing. It will retry shortly.</li>}
      {loaded && !counts.unavailable && !rows.length && <li className="py-3 text-[14px] text-[#8a8a86]">{meta.empty}</li>}
      {rows.map(r => {
        const on = (sel?.id || '') === r.id
        return <li key={r.id} className={`flex items-center gap-1 rounded-[12px] border ${on ? 'border-[#3b312b] bg-[#1a1512]' : 'border-transparent hover:bg-[#141414]'}`}>
          <button type="button" onClick={() => setPicked(r.id)} aria-pressed={on} className="flex min-h-14 min-w-0 flex-1 items-center gap-2 py-1 pl-0.5 text-left">
            <GogoAgent state={r.state} size={48}/>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[14px] font-medium text-[#f2efea]">{r.title}</span>
              <span className="line-clamp-2 text-[12px] leading-[1.4] text-[#9a9a96]">{r.sub}</span>
              {r.at && <span className="text-[11px] text-[#7a7a76]">{r.at}</span>}
            </span>
          </button>
          <Link href={r.href} aria-label={`Open ${r.title}`} className="grid h-11 w-9 shrink-0 place-items-center text-[#8a8a86] hover:text-[#f2efea]">›</Link>
        </li>
      })}
    </ul>
  </div>
}

/** Desktop right column (xl and wider). Closing it leaves a floating Gogo that reopens it. */
export function GogoPanel() {
  const { hero } = useGogoLive()
  const pathname = usePathname()
  const [closed, setClosed] = useState(false)
  useEffect(() => { try { setClosed(window.localStorage.getItem(PANEL_CLOSED_KEY) === '1') } catch {} }, [])
  const set = (v: boolean) => { setClosed(v); try { window.localStorage.setItem(PANEL_CLOSED_KEY, v ? '1' : '0') } catch {} }
  // The chat page has its own side column (the day's context), so the panel steps aside there.
  if (pathname === '/dashboard/chat') return null
  if (closed) return <button type="button" onClick={() => set(false)} aria-label="Show what Gogo is doing"
    className="fixed bottom-5 right-5 z-40 hidden h-[76px] w-[76px] place-items-center rounded-full border border-[#3b312b] bg-[#1f1a17] shadow-[0_12px_32px_rgba(0,0,0,.45)] xl:grid">
    <GogoAgent state={hero.state} size={60}/>
  </button>
  return <aside aria-label="What Gogo is doing" className="dashboard-rail hidden h-screen w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[#1c1c1c] px-4 pb-6 pt-3 xl:flex">
    <div className="flex justify-end"><button type="button" onClick={() => set(true)} aria-label="Close panel" className="grid h-10 w-10 place-items-center rounded-full text-[18px] text-[#8a8a86] hover:text-[#f2efea]">×</button></div>
    <PanelBody big={200}/>
  </aside>
}

/** Phone and tablet: the same panel as a bottom sheet, opened from the top-bar pill or the Activity tab. */
export function GogoSheet() {
  const { sheetOpen, closeSheet } = useGogoLive()
  if (!sheetOpen) return null
  return <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="What Gogo is doing">
    <button type="button" aria-label="Close" onClick={closeSheet} className="absolute inset-0 bg-black/60"/>
    <section className="dashboard-rail absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[22px] border-t border-[#2a2a2a] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2">
      <div className="flex justify-center"><button type="button" onClick={closeSheet} aria-label="Close" className="grid h-8 w-20 place-items-center"><span className="h-1 w-10 rounded-full bg-[#3a3a3a]"/></button></div>
      <PanelBody big={200}/>
    </section>
  </div>
}

/** Phone top-bar pill: a small Gogo in the current state and how many tasks are running or waiting. */
export function GogoPill() {
  const { hero, counts, openSheet } = useGogoLive()
  const waiting = counts.approvals + counts.handoffs
  const label = counts.working ? `${counts.working} working` : waiting ? `${waiting} waiting` : counts.watchers ? 'Watching' : 'Ready'
  return <button type="button" onClick={openSheet} aria-label={`What Gogo is doing: ${hero.live}`}
    className="flex h-11 items-center gap-1 rounded-full border border-[#3b312b] bg-[#1a1512] pl-0.5 pr-3 text-[12px] font-medium text-[#f2efea] xl:hidden">
    <GogoAgent state={hero.state} size={48} label=""/><span>{label}</span>
  </button>
}
