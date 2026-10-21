'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ThemeToggle } from './theme-toggle'
import { GogoAgent } from '@/components/gogo/gogo-agent'
import { NavLinks, SettingsLink, useNavCounts } from './dashboard-nav'
import { GettingStarted, RecentList, UsageCard } from './rail-cards'
import { useGogoLive } from './gogo-live'
import type { ShellData } from '@/lib/dashboard/shell-data'

export const RAIL_COLLAPSED_KEY = 'askgogo-rail-collapsed'

/** Desktop side menu (approved 21 Oct mock): Home · Tasks · Memory, Recent, Getting started, usage, Settings.
 *  Collapses to icons (remembered in this browser) so pages get the full width. */
export function SideRail({ shell }: { shell: ShellData }) {
  const counts = useNavCounts()
  const { recent } = useGogoLive()
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
      <Link href="/dashboard/home" aria-label="AskGogo home" className={`flex items-center gap-2 ${collapsed ? 'justify-center' : 'px-1'}`}>
        <GogoAgent state="idle" size={48} label="Gogo"/>
        {!collapsed && <span className="dashboard-brand-wordmark text-gogo-ink">AskGogo</span>}
      </Link>
      <Link href="/dashboard/chat" className={`mt-3 flex min-h-11 items-center gap-2 rounded-[12px] border border-[#262626] bg-[#151515] text-[15px] font-medium text-[#f2efea] hover:border-[#2fb8a6] ${collapsed ? 'justify-center' : 'px-3'}`} aria-label={collapsed ? 'New chat' : undefined}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        {!collapsed && 'New chat'}
      </Link>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        <NavLinks collapsed={collapsed} counts={counts} />
        {!collapsed && <RecentList recent={recent}/>}
      </div>

      {!collapsed && <div className="space-y-2 pt-3">
        <GettingStarted setup={shell.setup}/>
        <UsageCard plan={shell.plan} meters={shell.meters}/>
        <ThemeToggle compact/>
      </div>}
      <div className="mt-2"><SettingsLink collapsed={collapsed} name={shell.name}/></div>
      <button type="button" onClick={toggle} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'}
        className={`mt-2 flex min-h-10 items-center gap-3 rounded-[12px] text-[13px] text-[#8a8a86] hover:text-[#f2efea] ${collapsed ? 'justify-center' : 'px-3'}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>
        {!collapsed && <span>Collapse menu</span>}
      </button>
    </aside>
  )
}
