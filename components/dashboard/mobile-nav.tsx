'use client'

// Phone navigation: a menu button opens a side drawer with every section (no bottom tab bar), so pages get the
// whole screen. The Gogo chat page puts the menu button in its own header; other pages get a slim top bar.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useState } from 'react'
import { GogoCharacter } from '@/components/gogo/gogo-character'
import { ThemeToggle } from './theme-toggle'
import { NAV, NavLinks, SafeModeNote, needsYouCount, useNavCounts, type NavCounts } from './dashboard-nav'

type MobileNav = { open: () => void; counts: NavCounts }
const Ctx = createContext<MobileNav>({ open: () => {}, counts: { approvals: 0, watchers: 0, handoffs: 0 } })

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const counts = useNavCounts()
  const [isOpen, setOpen] = useState(false)
  const pathname = usePathname()
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  return <Ctx.Provider value={{ open: () => setOpen(true), counts }}>
    {children}
    {isOpen && <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/60"/>
      <div className="dashboard-rail absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col overflow-y-auto border-r border-[#262626] px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(.75rem+env(safe-area-inset-top))]">
        <div className="flex items-center justify-between px-1 pb-3">
          <Link href="/dashboard/home" onClick={() => setOpen(false)} className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#f2efea]"><GogoCharacter state="calm" size={38} showStatus={false}/></span>
            <span className="dashboard-brand-wordmark text-gogo-ink">AskGogo</span>
          </Link>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="grid h-11 w-11 place-items-center rounded-[12px] text-[#c4c4c0]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <NavLinks counts={counts} onNavigate={() => setOpen(false)} />
        <div className="mt-auto space-y-3 pt-5"><ThemeToggle compact/><SafeModeNote/></div>
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
    {waiting > 0 && <span className="absolute right-0.5 top-1 min-w-[18px] rounded-full bg-[#d9a441] px-1 text-center text-[11px] font-bold leading-[18px] text-[#0b0b0b]">{waiting}</span>}
  </button>
}

/** Slim phone top bar for every page except the Gogo chat, which has its own header. */
export function MobileTopBar() {
  const pathname = usePathname()
  if (pathname === '/dashboard/chat') return null
  const here = NAV.find(item => !item.href.includes('?') && (pathname === item.href || pathname.startsWith(item.href + '/')))
  return <div className="sticky top-0 z-30 -mx-4 mb-3 flex items-center gap-2 border-b border-[#1f1f1f] bg-[#0b0b0b] px-2 py-1.5 sm:-mx-6 lg:hidden">
    <MobileMenuButton />
    <span className="truncate text-[17px] font-semibold text-[#ecebe8]">{here?.label || 'AskGogo'}</span>
    <Link href="/dashboard/chat" className="ml-auto min-h-10 rounded-full border border-[#2a2a2a] px-4 py-2 text-[14px] text-[#d8d8d3]">Ask Gogo</Link>
  </div>
}
