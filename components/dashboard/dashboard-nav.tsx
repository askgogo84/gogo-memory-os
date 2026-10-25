'use client'

// One navigation list for the desktop side rail, the phone drawer and the phone bottom tabs, so all offer the same places.
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useGogoLive } from './gogo-live'

export type NavItem = {
  href: string
  label: string
  glyph: string
  match?: (pathname: string, section: string) => boolean
  badgeKey?: 'approvals' | 'watchers'
}

// Approved 22 Oct Duet-parity mock (Claude Duet + Wajo): three places — Chat (the one thread, with the morning brief
// on top), Tasks and Make. Everything else sits under a closed "More".
export const NAV: NavItem[] = [
  { href:'/dashboard/chat', label:'Chat', glyph:'◉', match:(p)=>p==='/dashboard/chat'||p==='/dashboard/home' },
  { href:'/dashboard/tasks', label:'Tasks', glyph:'✓', badgeKey:'approvals', match:(p,s)=>p==='/dashboard/tasks'||(p==='/dashboard/agent'&&(s==='approvals'||s==='background'))||p.startsWith('/dashboard/activity') },
  { href:'/dashboard/make', label:'Make', glyph:'▤' },
]

export const MORE: NavItem[] = [
  { href:'/dashboard/memory', label:'Memory', glyph:'◇' },
  { href:'/dashboard/calendar', label:'Calendar', glyph:'▦' },
  { href:'/dashboard/lists', label:'Lists', glyph:'≡' },
  { href:'/dashboard/library', label:'Library', glyph:'▣' },
  { href:'/dashboard/agent?section=goals', label:'Goals', glyph:'○', match:(p,s)=>p==='/dashboard/agent'&&s==='goals' },
  { href:'/dashboard/brain', label:'Brain', glyph:'◈' },
  { href:'/dashboard/you/vault', label:'Vault', glyph:'▰' },
  { href:'/dashboard/usage', label:'Usage', glyph:'◔' },
  { href:'/dashboard/alerts', label:'What you hear about', glyph:'◎' },
  // SecondBrain for Business (23 Oct pilot): shared team workspaces, read-only.
  { href:'/dashboard/business', label:'SecondBrain', glyph:'⬡' },
]

// One Settings page (approved mock): General, Connections, Permissions, Payments, Addresses, Notifications, Voice, Invites.
export const SETTINGS: NavItem = { href:'/dashboard/settings', label:'Settings', glyph:'⚙', match:(p)=>p==='/dashboard/settings'||p==='/dashboard/connections'||p==='/dashboard/you' }

export type NavCounts = { approvals: number; watchers: number; handoffs: number; serviceNotices?:number; unavailable?:boolean }

/** Waiting decisions (approvals and Take control handoffs) and background watches, from the shared live view.
 *  Several stops on the same site are one thing to do, as on Home (grouped in buildLive). */
export function useNavCounts(): NavCounts {
  const { counts } = useGogoLive()
  return counts
}

/** Decisions, browser handoffs and source-bound service warnings needing review. */
export function needsYouCount(counts: NavCounts) { return counts.approvals + counts.handoffs + (counts.serviceNotices||0) }

function isActive(item: NavItem, pathname: string, section: string) {
  return item.match ? item.match(pathname, section) : !item.href.includes('?') && (pathname === item.href || pathname.startsWith(item.href + '/'))
}

function NavLink({ item, collapsed, counts, onNavigate, pathname, section }: { item: NavItem; collapsed: boolean; counts: NavCounts; onNavigate?: () => void; pathname: string; section: string }) {
  const active = isActive(item, pathname, section)
  const badge = item.badgeKey === 'approvals' ? needsYouCount(counts) : item.badgeKey === 'watchers' ? counts.watchers : 0
  return <Link
    href={item.href}
    onClick={onNavigate}
    aria-current={active ? 'page' : undefined}
    aria-label={collapsed ? item.label : undefined}
    title={collapsed ? item.label : undefined}
    className={`dashboard-nav-link relative flex min-h-11 items-center gap-3 rounded-[12px] border text-[15px] font-medium transition ${collapsed ? 'justify-center px-0' : 'px-3'} ${active ? 'dashboard-nav-active text-gogo-ink' : 'border-transparent text-[#c4c4c0] hover:bg-[#141414] hover:text-[#f2efea]'}`}
  >
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border text-[14px] ${active ? 'border-[#2fb8a6]/30 bg-[#132a27] text-[#2fb8a6]' : 'border-[#1f1f1f] bg-[#111] text-[#8a8a86]'}`}>{item.glyph}</span>
    {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
    {item.badgeKey==='approvals'&&counts.unavailable&&<span role="status" className="text-[#d9a441]" title="Attention items could not be loaded">?</span>}
    {!counts.unavailable&&badge > 0 && (collapsed
      ? <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-[#ef7a27]" aria-hidden="true"/>
      : <span className="min-w-6 rounded-full bg-[#ef7a27] px-2 py-0.5 text-center text-[12px] font-bold text-[#1a0d04]" aria-label={`${badge} need you`}>{badge}</span>)}
  </Link>
}

export function NavLinks({ collapsed = false, counts, onNavigate }: { collapsed?: boolean; counts: NavCounts; onNavigate?: () => void }) {
  const pathname = usePathname()
  const section = useSearchParams().get('section') || ''
  const inMore = MORE.some(item => isActive(item, pathname, section))
  const [moreOpen, setMoreOpen] = useState(inMore)
  return <nav className="space-y-1" aria-label="AskGogo dashboard">
    {NAV.map(item => <NavLink key={item.label} item={item} collapsed={collapsed} counts={counts} onNavigate={onNavigate} pathname={pathname} section={section}/>)}
    {!collapsed && <>
      <button type="button" onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen || inMore}
        className="flex min-h-10 w-full items-center gap-2 rounded-[12px] px-3 text-[13px] font-medium text-[#8a8a86] hover:text-[#f2efea]">
        <span aria-hidden="true">{moreOpen || inMore ? '▾' : '▸'}</span>More
      </button>
      {(moreOpen || inMore) && <div className="space-y-1">{MORE.map(item => <NavLink key={item.label} item={item} collapsed={false} counts={counts} onNavigate={onNavigate} pathname={pathname} section={section}/>)}</div>}
    </>}
  </nav>
}

export function SettingsLink({ collapsed = false, onNavigate, name }: { collapsed?: boolean; onNavigate?: () => void; name?: string }) {
  const pathname = usePathname()
  const active = isActive(SETTINGS, pathname, '')
  return <Link href={SETTINGS.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} aria-label={collapsed ? 'Settings' : undefined}
    className={`flex min-h-12 items-center gap-3 rounded-[12px] ${collapsed ? 'justify-center' : 'px-2'} ${active ? 'bg-[#1a1a1a]' : 'hover:bg-[#141414]'} text-[#f2efea]`}>
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1d1d1d] text-[13px] font-semibold">{(name || 'G').slice(0, 1).toUpperCase()}</span>
    {!collapsed && <span className="flex min-w-0 flex-col"><span className="truncate text-[14px] font-medium">{name || 'You'}</span><span className="text-[12px] text-[#8a8a86]">Settings</span></span>}
  </Link>
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
