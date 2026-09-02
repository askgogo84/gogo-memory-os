'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TodayIcon, MemoryIcon, CalendarIcon, ListsIcon, YouIcon, UsageIcon } from './icons'
import { ThemeToggle } from './theme-toggle'

const NAV = [
  { key: 'home', label: 'Home', href: '/dashboard/home', Icon: TodayIcon },
  { key: 'chat', label: 'Talk to Gogo', href: '/dashboard/chat', Icon: MemoryIcon },
  { key: 'today', label: 'Today', href: '/dashboard/today', Icon: TodayIcon },
  { key: 'memory', label: 'Memory', href: '/dashboard/memory', Icon: MemoryIcon },
  { key: 'tasks', label: 'Tasks', href: '/dashboard/tasks', Icon: ListsIcon },
  { key: 'calendar', label: 'Calendar', href: '/dashboard/calendar', Icon: CalendarIcon },
  { key: 'lists', label: 'Lists', href: '/dashboard/lists', Icon: ListsIcon },
  { key: 'you', label: 'You', href: '/dashboard/you', Icon: YouIcon },
] as const

const GOGO_NAV = [
  { key: 'learn', label: 'Learn with Gogo', href: '/dashboard/learn', Icon: ListsIcon },
  { key: 'personalize', label: 'Personalize Gogo', href: '/dashboard/personalize', Icon: YouIcon },
] as const

export function SideRail() {
  const pathname = usePathname()
  const usageActive = pathname === '/dashboard/usage' || pathname.startsWith('/dashboard/usage/')

  return (
    <nav className="relative z-20 hidden w-[244px] shrink-0 flex-col border-r border-gogo-ink/7 bg-gogo-rail/88 px-4 py-5 backdrop-blur-2xl lg:sticky lg:top-0 lg:flex lg:h-screen lg:self-start">
      <div className="flex items-center justify-between px-2 pb-5">
        <Link href="/dashboard/home" className="group flex items-center gap-3" aria-label="AskGogo Home">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-gogo-orange/20 blur-md transition group-hover:bg-gogo-orange/30" />
            <img src="/gogo-figure.png" alt="" className="gogo-float relative h-10 w-10 rounded-full" />
          </div>
          <div>
            <div className="font-serif text-[19px] font-semibold tracking-[-0.35px] text-gogo-ink">AskGogo</div>
            <div className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-gogo-ink-3">Your calm space</div>
          </div>
        </Link>
        <ThemeToggle />
      </div>

      <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">Your world</div>
      <div className="flex flex-col gap-[3px]">
        {NAV.map(({ key, label, href, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`group flex items-center gap-[11px] rounded-[14px] px-3 py-2 text-sm transition-all duration-300 ${active ? 'bg-gogo-surface font-bold text-gogo-orange shadow-[0_8px_28px_rgba(62,35,18,0.07)]' : 'font-medium text-gogo-ink-2 hover:bg-gogo-surface/60 hover:text-gogo-ink'}`}
            >
              <span className={`grid h-8 w-8 place-items-center rounded-[11px] transition-colors ${active ? 'bg-gogo-orange-tint text-gogo-orange' : 'bg-gogo-surface/45 text-gogo-ink-3 group-hover:text-gogo-orange'}`}>
                <Icon className="block h-[18px] w-[18px] shrink-0" />
              </span>
              <span>{label}</span>
            </Link>
          )
        })}
      </div>

      <div className="mt-5 border-t border-gogo-ink/7 pt-4">
        <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">Gogo</div>
        <div className="flex flex-col gap-[3px]">
          {GOGO_NAV.map(({ key, label, href, Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link key={key} href={href} aria-current={active ? 'page' : undefined} className={`group flex items-center gap-[11px] rounded-[14px] px-3 py-2 text-sm transition-all duration-300 ${active ? 'bg-gogo-surface font-bold text-gogo-plum shadow-[0_8px_28px_rgba(62,35,18,0.07)]' : 'font-medium text-gogo-ink-2 hover:bg-gogo-surface/60 hover:text-gogo-ink'}`}>
                <span className={`grid h-8 w-8 place-items-center rounded-[11px] ${active ? 'bg-gogo-plum/10 text-gogo-plum' : 'bg-gogo-surface/45 text-gogo-ink-3 group-hover:text-gogo-plum'}`}><Icon className="block h-[18px] w-[18px] shrink-0" /></span>
                <span>{label}</span>
              </Link>
            )
          })}
        </div>
      </div>

      <div className="mt-5 border-t border-gogo-ink/7 pt-4">
        <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">Account</div>
        <Link
          href="/dashboard/usage"
          aria-current={usageActive ? 'page' : undefined}
          className={`flex items-center gap-[11px] rounded-[14px] px-3 py-2 text-sm transition-all duration-300 ${usageActive ? 'bg-gogo-surface font-bold text-gogo-orange shadow-[0_8px_28px_rgba(62,35,18,0.07)]' : 'font-medium text-gogo-ink-2 hover:bg-gogo-surface/60 hover:text-gogo-ink'}`}
        >
          <span className={`grid h-8 w-8 place-items-center rounded-[11px] ${usageActive ? 'bg-gogo-orange-tint text-gogo-orange' : 'bg-gogo-surface/45 text-gogo-ink-3'}`}>
            <UsageIcon className="block h-[18px] w-[18px] shrink-0" />
          </span>
          <span>Usage & plan</span>
        </Link>
      </div>

      <div className="mt-auto overflow-hidden rounded-[20px] border border-gogo-ink/7 bg-gogo-surface/62 p-3.5 shadow-[0_14px_40px_rgba(62,35,18,0.04)]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.10)]" />
          <div className="text-[11.5px] font-bold text-gogo-ink">One Gogo, everywhere</div>
        </div>
        <p className="mt-1.5 text-[10.5px] leading-4.5 text-gogo-ink-3">WhatsApp and this dashboard share the same memory, lists, reminders and actions.</p>
      </div>
    </nav>
  )
}
