'use client'

// One navigation list for the desktop side rail and the phone drawer, so both always offer the same places.
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

export type NavItem = {
  href: string
  label: string
  glyph: string
  match?: (pathname: string, section: string) => boolean
  badgeKey?: 'approvals' | 'watchers'
}

export const NAV: NavItem[] = [
  { href:'/dashboard/home', label:'Today', glyph:'⌂' },
  { href:'/dashboard/chat', label:'Gogo', glyph:'◉' },
  { href:'/dashboard/activity', label:'Activity', glyph:'↳' },
  { href:'/dashboard/agent?section=approvals', label:'Needs you', glyph:'!', badgeKey:'approvals', match:(p,s)=>p==='/dashboard/agent'&&s==='approvals' },
  { href:'/dashboard/agent?section=background', label:'Background', glyph:'◎', badgeKey:'watchers', match:(p,s)=>p==='/dashboard/agent'&&s==='background' },
  { href:'/dashboard/agent?section=goals', label:'Goals', glyph:'○', match:(p,s)=>p==='/dashboard/agent'&&s==='goals' },
  { href:'/dashboard/brain', label:'Brain', glyph:'◈' },
  { href:'/dashboard/memory', label:'Memory', glyph:'◇' },
  { href:'/dashboard/library', label:'Library', glyph:'▣' },
  { href:'/dashboard/connections', label:'Connections', glyph:'⌁' },
  { href:'/dashboard/you/vault', label:'Vault', glyph:'▰' },
  { href:'/dashboard/you', label:'You', glyph:'♙', match:(p,s)=>p==='/dashboard/you'&&!s },
]

export type NavCounts = { approvals: number; watchers: number; handoffs: number }

/** Waiting decisions (approvals and Take control handoffs) and background watches, refreshed on navigation. */
export function useNavCounts(): NavCounts {
  const pathname = usePathname()
  const [counts, setCounts] = useState<NavCounts>({ approvals: 0, watchers: 0, handoffs: 0 })
  useEffect(() => {
    let alive = true
    fetch('/api/agent/snapshot', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!alive || !data) return
        setCounts({
          approvals: Array.isArray(data.approvals) ? data.approvals.length : 0,
          watchers: Array.isArray(data.watchers) ? data.watchers.length : 0,
          handoffs: Array.isArray(data.handoffs) ? data.handoffs.length : 0,
        })
      }).catch(() => {})
    return () => { alive = false }
  }, [pathname])
  return counts
}

/** What "Needs you" counts: decisions to approve plus browser steps only the person can take. */
export function needsYouCount(counts: NavCounts) { return counts.approvals + counts.handoffs }

export function NavLinks({ collapsed = false, counts, onNavigate }: { collapsed?: boolean; counts: NavCounts; onNavigate?: () => void }) {
  const pathname = usePathname()
  const section = useSearchParams().get('section') || ''
  const active = (item: NavItem) => item.match ? item.match(pathname, section) : !item.href.includes('?') && (pathname === item.href || pathname.startsWith(item.href + '/'))
  return <nav className="space-y-1" aria-label="AskGogo dashboard">
    {NAV.map(item => {
      const isActive = active(item)
      const badge = item.badgeKey === 'approvals' ? needsYouCount(counts) : item.badgeKey === 'watchers' ? counts.watchers : 0
      return <Link
        key={item.label}
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        title={collapsed ? item.label : undefined}
        className={`dashboard-nav-link relative flex min-h-12 items-center gap-3 rounded-[12px] border text-[16px] font-medium transition ${collapsed ? 'justify-center px-0' : 'px-3'} ${isActive ? 'dashboard-nav-active text-gogo-ink' : 'border-transparent text-[#c4c4c0] hover:bg-[#141414] hover:text-[#f2efea]'}`}
      >
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border text-[14px] ${isActive ? 'border-[#2fb8a6]/30 bg-[#132a27] text-[#2fb8a6]' : 'border-[#1f1f1f] bg-[#111] text-[#8a8a86]'}`}>{item.glyph}</span>
        {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
        {badge > 0 && (collapsed
          ? <span className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ${item.badgeKey === 'approvals' ? 'bg-[#d9a441]' : 'bg-[#2fb8a6]'}`} aria-hidden="true"/>
          : <span className={`min-w-6 rounded-full px-2 py-0.5 text-center text-[13px] font-semibold ${item.badgeKey === 'approvals' ? 'bg-[#2a2111] text-[#d9a441]' : 'bg-[#123d38] text-[#2fb8a6]'}`}>{badge}</span>)}
      </Link>
    })}
  </nav>
}

export function SafeModeNote() {
  return <div className="dashboard-rail-status rounded-[14px] p-4">
    <div className="flex items-center gap-2 text-[15px] font-semibold text-[#e0e0dc]">
      <span className="h-2 w-2 rounded-full bg-[#2fb8a6]" />
      Safe mode on
    </div>
    <p className="mt-2 text-[14px] leading-[1.5] text-[#b4b4b0]">Gogo asks before anything that sends, spends, books or submits.</p>
  </div>
}
