'use client'

// Phone navigation (21 Oct, Wajo layout): no bottom tabs. A slim top bar has the menu button (a drawer with Home,
// Tasks, Memory, Recent, More, Getting started, usage and Settings) and a live Gogo pill that opens the Gogo sheet.
// The Gogo chat page keeps its own header and composer.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useState } from 'react'
import { Companion } from '@/components/gogo/companion'
import { ThemeToggle } from './theme-toggle'
import { NAV, MORE, SETTINGS, NavLinks, SettingsLink, needsYouCount, useNavCounts, type NavCounts } from './dashboard-nav'
import { GettingStarted, RecentList, UsageCard } from './rail-cards'
import { GogoPill, GogoSheet } from './gogo-panel'
import { useGogoLive } from './gogo-live'
import type { ShellData } from '@/lib/dashboard/shell-data'

type MobileNav = { open: () => void; counts: NavCounts }
const Ctx = createContext<MobileNav>({ open: () => {}, counts: { approvals: 0, watchers: 0, handoffs: 0 } })

export function MobileNavProvider({ children, shell }: { children: React.ReactNode; shell: ShellData }) {
  const counts = useNavCounts()
  const { recent } = useGogoLive()
  const [isOpen, setOpen] = useState(false)
  const pathname = usePathname()
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])
  const close = () => setOpen(false)

  return <Ctx.Provider value={{ open: () => setOpen(true), counts }}>
    {children}
    <GogoSheet/>
    {isOpen && <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <button type="button" aria-label="Close menu" onClick={close} className="absolute inset-0 bg-black/60"/>
      <div className="dashboard-rail absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col overflow-y-auto border-r border-[#262626] px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(.75rem+env(safe-area-inset-top))]">
        <div className="flex items-center justify-between pb-2">
          <Link href="/dashboard/home" onClick={close} className="flex items-center gap-1">
            <Companion state="idle" size={48} label="Gogo"/>
            <span className="dashboard-brand-wordmark text-gogo-ink">AskGogo</span>
          </Link>
          <button type="button" onClick={close} aria-label="Close menu" className="grid h-11 w-11 place-items-center rounded-[12px] text-[#c4c4c0]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <Link href="/dashboard/chat" onClick={close} className="mb-2 flex min-h-11 items-center gap-2 rounded-[12px] border border-[#262626] bg-[#151515] px-3 text-[15px] font-medium text-[#f2efea]">+ New chat</Link>
        <NavLinks counts={counts} onNavigate={close} />
        <RecentList recent={recent} onNavigate={close}/>
        <div className="mt-auto space-y-2 pt-5">
          <GettingStarted setup={shell.setup} onNavigate={close}/>
          <UsageCard plan={shell.plan} meters={shell.meters} onNavigate={close}/>
          <ThemeToggle compact/>
          <SettingsLink name={shell.name} onNavigate={close}/>
        </div>
      </div>
    </div>}
  </Ctx.Provider>
}

/** The ☰ button with the Needs you count, for page headers on the phone. */
export function MobileMenuButton() {
  const { open, counts } = useContext(Ctx)
  const waiting = needsYouCount(counts)
  return <button type="button" onClick={open} aria-label={waiting ? `Open menu, ${waiting} need you` : 'Open menu'} className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[12px] text-[#f2efea] lg:hidden">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>
    {waiting > 0 && <span className="absolute right-0.5 top-1 min-w-[18px] rounded-full bg-[#ef7a27] px-1 text-center text-[11px] font-bold leading-[18px] text-[#1a0d04]">{waiting}</span>}
  </button>
}

function pageLabel(pathname: string) {
  const all = [...NAV, ...MORE, SETTINGS]
  const here = all.find(item => !item.href.includes('?') && (pathname === item.href || pathname.startsWith(item.href + '/')))
  if (pathname.startsWith('/dashboard/activity') || pathname === '/dashboard/agent') return 'Tasks'
  return here?.label === 'Home' ? 'AskGogo' : here?.label || 'AskGogo'
}

/** Slim phone top bar for every page except the Gogo chat, which has its own header. */
export function MobileTopBar() {
  const pathname = usePathname()
  if (pathname === '/dashboard/chat') return null
  return <div className="sticky top-0 z-30 -mx-4 mb-3 flex items-center gap-2 border-b border-[#1f1f1f] bg-[#0b0b0b] px-2 py-1.5 sm:-mx-6 lg:hidden">
    <MobileMenuButton />
    <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-[#ecebe8]">{pageLabel(pathname)}</span>
    <GogoPill/>
  </div>
}
