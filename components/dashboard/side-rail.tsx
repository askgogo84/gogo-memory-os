'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ThemeToggle } from './theme-toggle'
import { GogoCharacter } from '@/components/gogo/gogo-character'
import { NavLinks, SafeModeNote, useNavCounts } from './dashboard-nav'

export const RAIL_COLLAPSED_KEY = 'askgogo-rail-collapsed'

/** Desktop side menu. Collapses to icons (remembered in this browser) so pages get the full width. */
export function SideRail() {
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
    <aside className={`dashboard-rail hidden h-screen shrink-0 py-5 transition-[width] lg:flex lg:flex-col ${collapsed ? 'w-[80px] px-3' : 'w-[248px] px-3.5 xl:w-[264px]'}`}>
      <Link href="/dashboard/home" aria-label="AskGogo home" className={`dashboard-brand flex items-center gap-3 rounded-[14px] border ${collapsed ? 'justify-center px-0 py-2' : 'px-3 py-3'}`}>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#f2efea] text-[#0b0b0b]">
          <GogoCharacter state="calm" size={46} showStatus={false} />
        </div>
        {!collapsed && <div className="min-w-0">
          <div className="dashboard-brand-wordmark text-gogo-ink">AskGogo</div>
          <div className="mt-1 text-[12px] tracking-[.02em] text-[#a8a8a4]">One Gogo, everywhere</div>
        </div>}
      </Link>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto"><NavLinks collapsed={collapsed} counts={counts} /></div>

      {!collapsed && <div className="pb-3 pt-3"><ThemeToggle compact/></div>}
      {!collapsed && <SafeModeNote />}
      <button type="button" onClick={toggle} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'}
        className={`mt-3 flex min-h-11 items-center gap-3 rounded-[12px] border border-[#2a2a2a] text-[15px] text-[#c4c4c0] hover:text-[#f2efea] ${collapsed ? 'justify-center' : 'px-3'}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>
        {!collapsed && <span>Collapse menu</span>}
      </button>
    </aside>
  )
}
