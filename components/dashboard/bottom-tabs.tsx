'use client'

// Phone bottom tabs (approved 22 Oct Duet-parity mock): Chat · Tasks · Make, with the Needs you count on Tasks.
// Hidden on the chat itself, which is a full-screen layer with its own menu, channel pill and Needs you.
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { NAV, needsYouCount, useNavCounts } from './dashboard-nav'

const ICON: Record<string, React.ReactNode> = {
  Chat: <path d="M4 5h16v11H8l-4 4z"/>,
  Tasks: <path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>,
  Make: <><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></>,
}

export const BOTTOM_TABS_HEIGHT = 'calc(60px + env(safe-area-inset-bottom))'

export function BottomTabs() {
  const pathname = usePathname()
  const section = useSearchParams().get('section') || ''
  const counts = useNavCounts()
  const waiting = needsYouCount(counts)
  // The chat is its own full-screen layer on the phone (approved 22 Oct full-screen chat mock).
  if (pathname === '/dashboard/chat') return null
  return <nav aria-label="Main" className="dashboard-bottom-tabs fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-[#1f1f1f] bg-[#0b0b0b] px-2 pb-[env(safe-area-inset-bottom)] lg:hidden">
    {NAV.map(item => {
      const active = item.match ? item.match(pathname, section) : pathname === item.href || pathname.startsWith(item.href + '/')
      const badge = item.badgeKey === 'approvals' && !counts.unavailable ? waiting : 0
      return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
        className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[12px] ${active ? 'font-semibold text-[#2fb8a6]' : 'text-[#8a8a86]'}`}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[item.label]}</svg>
        <span>{item.label}{badge > 0 ? ` · ${badge}` : ''}</span>
      </Link>
    })}
  </nav>
}
