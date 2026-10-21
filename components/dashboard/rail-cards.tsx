'use client'

// Bottom of the side rail and the phone drawer: Getting started (dismissible, remembered in this browser) and the
// Wajo-style usage card — how much of each meter is used, amber from 80%, never red.
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ShellData } from '@/lib/dashboard/shell-data'

const SETUP_HIDDEN_KEY = 'askgogo-setup-hidden'

export function GettingStarted({ setup, onNavigate }: { setup: ShellData['setup']; onNavigate?: () => void }) {
  const [hidden, setHidden] = useState(true)
  useEffect(() => { try { setHidden(window.localStorage.getItem(SETUP_HIDDEN_KEY) === '1') } catch { setHidden(false) } }, [])
  if (!setup.length || hidden) return null
  const done = setup.filter(s => s.done).length
  if (done === setup.length) return null
  const pct = Math.round(done / setup.length * 100)
  return <section aria-label="Getting started" className="rounded-[14px] border border-[#222] bg-[#121212] p-3">
    <div className="flex items-center justify-between text-[13px] font-semibold text-[#f2efea]">
      <span>Getting started</span>
      <span className="flex items-center gap-1"><span className="text-[#2fb8a6]">{pct}%</span>
        <button type="button" aria-label="Hide getting started" onClick={() => { setHidden(true); try { window.localStorage.setItem(SETUP_HIDDEN_KEY, '1') } catch {} }} className="grid h-8 w-8 place-items-center rounded-full text-[#8a8a86] hover:text-[#f2efea]">×</button></span>
    </div>
    <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#222]"><div className="h-full bg-[#2fb8a6]" style={{ width: `${pct}%` }}/></div>
    <ul className="mt-2 space-y-0.5">
      {setup.map(s => <li key={s.key}>
        <Link href={s.href} onClick={onNavigate} className="flex min-h-9 items-center gap-2.5 text-[13px]">
          <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[11px] font-bold ${s.done ? 'bg-[#2fb8a6] text-[#04201c]' : 'border border-[#3a3a3a]'}`}>{s.done ? '✓' : ''}</span>
          <span className={s.done ? 'text-[#8a8a86] line-through' : 'text-[#c4c4c0]'}>{s.label}</span>
        </Link>
      </li>)}
    </ul>
  </section>
}

export function UsageCard({ plan, meters, onNavigate }: { plan: string | null; meters: ShellData['meters']; onNavigate?: () => void }) {
  if (!meters.length) return null
  return <section aria-label="Usage" className="flex flex-col gap-2.5 rounded-[14px] border border-[#222] bg-[#121212] p-3">
    <div className="flex items-center justify-between">
      <span className="text-[13px] font-semibold text-[#f2efea]">Usage</span>
      {plan && <span className="rounded-full bg-[#132a27] px-2 py-0.5 text-[11px] font-semibold text-[#5fd3c3]">{plan}</span>}
    </div>
    {meters.map(m => {
      const pct = m.limit ? Math.min(100, Math.round(m.used / m.limit * 100)) : 0
      const warn = m.limit ? pct >= 80 : false
      return <div key={m.label} className="flex flex-col gap-1">
        <div className="flex justify-between text-[12px]"><span className="text-[#c4c4c0]">{m.label}</span>
          <span className={warn ? 'text-[#f0c26b]' : 'text-[#9a9a96]'}>{m.limit ? `${m.used} of ${m.limit}` : `${m.used} · no limit`}</span></div>
        {m.limit && <div className="h-[5px] overflow-hidden rounded-full bg-[#222]" role="progressbar" aria-label={m.label} aria-valuenow={m.used} aria-valuemin={0} aria-valuemax={m.limit}><div className={`h-full ${warn ? 'bg-[#d9a441]' : 'bg-[#2fb8a6]'}`} style={{ width: `${pct}%` }}/></div>}
        <span className="text-[11px] text-[#7a7a76]">{m.resets}</span>
      </div>
    })}
    <Link href="/dashboard/settings?section=general" onClick={onNavigate} className="self-start rounded-full border border-[#2a2a2a] px-3 py-1.5 text-[12px] font-medium text-[#f2efea] hover:border-[#2fb8a6]">Plan & upgrade</Link>
  </section>
}

export function RecentList({ recent, onNavigate }: { recent: { id: string; title: string; href: string }[]; onNavigate?: () => void }) {
  if (!recent.length) return null
  return <div className="mt-4">
    <div className="flex items-center justify-between px-3 text-[12px] font-medium uppercase tracking-[.06em] text-[#8a8a86]"><span>Recent</span><Link href="/dashboard/tasks?tab=recent" onClick={onNavigate} className="normal-case tracking-normal text-[#8a8a86] hover:text-[#f2efea]">All</Link></div>
    <ul className="mt-1">
      {recent.map(r => <li key={r.id}><Link href={r.href} onClick={onNavigate} className="block min-h-10 truncate rounded-[10px] px-3 py-2.5 text-[14px] text-[#c4c4c0] hover:bg-[#141414] hover:text-[#f2efea]">{r.title}</Link></li>)}
    </ul>
  </div>
}
