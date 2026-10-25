'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Companion } from '@/components/gogo/companion'
import { ThemeToggle } from './theme-toggle'
import { NavLinks, SettingsLink, useNavCounts } from './dashboard-nav'
import type { ShellData } from '@/lib/dashboard/shell-data'

export const RAIL_COLLAPSED_KEY = 'askgogo-rail-collapsed'

/** Desktop side menu (approved 22 Oct Duet-parity mock): AskGogo, Chat · Tasks · Make, then Channels ("Channels share
 *  one memory"), the theme switch and Settings at the foot. Usage and setup live in Settings. Collapses to icons (remembered here). */
export function SideRail({ shell }: { shell: ShellData }) {
  const counts = useNavCounts()
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem(RAIL_COLLAPSED_KEY) === '1') } catch {}
  }, [])
  function toggle() {
    setCollapsed(c => {
      try { window.localStorage.setItem(RAIL_COLLAPSED_KEY, c ? '0' : '1') } catch {}
      return !c
    })
  }

  return (
    <aside className={`dashboard-rail hidden h-screen shrink-0 py-4 transition-[width] lg:flex lg:flex-col ${collapsed ? 'w-[80px] px-3' : 'w-[260px] px-3'}`}>
      <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'justify-between'}`}>
        <Link href="/dashboard/chat" aria-label="AskGogo" className={`flex items-center gap-2 ${collapsed ? 'justify-center' : 'px-1'}`}>
          <Companion state="idle" size={48} label="Gogo"/>
          {!collapsed && <span className="dashboard-brand-wordmark text-gogo-ink">AskGogo</span>}
        </Link>
        <button type="button" onClick={toggle} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'}
          className="grid h-10 w-10 place-items-center rounded-[10px] text-[#8a8a86] hover:bg-[#141414] hover:text-[#f2efea]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>
        </button>
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <NavLinks collapsed={collapsed} counts={counts} />
        {!collapsed && <RailChannels/>}
      </div>

      {!collapsed && <div className="pt-3"><ThemeToggle compact/></div>}
      <div className="mt-2"><SettingsLink collapsed={collapsed} name={shell.name}/></div>
    </aside>
  )
}

type Channel = { id: string; title: string }

/** Chat channels (#Saturday plan, #Tipplr); they keep their own transcript and share one memory. */
function RailChannels() {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const pathname = usePathname()
  const active = useSearchParams().get('channel') || ''
  useEffect(() => {
    fetch('/api/agent/threads', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : null)
      .then(d => setChannels(Array.isArray(d?.threads) ? d.threads.slice(0, 12).map((t: any) => ({ id: String(t.id), title: String(t.title || 'Channel') })) : []))
      .catch(() => setChannels([]))
  }, [])
  return <section aria-labelledby="rail-channels" className="mt-6">
    <h2 id="rail-channels" className="px-3 text-[12px] font-semibold uppercase tracking-[.05em] text-[#8a8a86]">Channels</h2>
    <div className="mt-1 flex flex-col">
      {(channels || []).map(c => <Link key={c.id} href={`/dashboard/chat?channel=${encodeURIComponent(c.id)}`} aria-current={pathname === '/dashboard/chat' && active === c.id ? 'page' : undefined}
        className={`flex min-h-10 items-center truncate rounded-[10px] px-3 text-[14px] ${pathname === '/dashboard/chat' && active === c.id ? 'bg-[#132a27] text-[#f2efea]' : 'text-[#c4c4c0] hover:bg-[#141414] hover:text-[#f2efea]'}`}># {c.title}</Link>)}
      <Link href="/dashboard/chat?newChannel=1" className="flex min-h-10 items-center rounded-[10px] px-3 text-[14px] text-[#8a8a86] hover:text-[#f2efea]">+ Channel</Link>
      <p className="px-3 pt-1 text-[12px] text-[#8a8a86]">Channels share one memory.</p>
    </div>
  </section>
}
