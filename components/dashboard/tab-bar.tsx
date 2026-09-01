'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TAB_ICONS } from './icons'

// Mobile keeps five primary destinations. Usage remains available from the desktop
// rail / You surface; Memory earns a primary slot because saved knowledge is one of
// AskGogo's core jobs.
export const TABS = [
  { key: 'today', label: 'Today', href: '/dashboard/today' },
  { key: 'memory', label: 'Memory', href: '/dashboard/memory' },
  { key: 'calendar', label: 'Calendar', href: '/dashboard/calendar' },
  { key: 'lists', label: 'Lists', href: '/dashboard/lists' },
  { key: 'you', label: 'You', href: '/dashboard/you' },
] as const

export function TabBar() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[480px] border-t border-gogo-ink/8 bg-gogo-surface/95 shadow-[0_-8px_30px_rgba(62,35,18,0.04)] backdrop-blur-xl lg:hidden">
      {TABS.map(({ key, label, href }) => {
        const Icon = TAB_ICONS[key]
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors duration-300 ${active ? 'text-gogo-orange' : 'text-gogo-ink/45'}`}
          >
            {active && <span className="absolute top-0 h-[3px] w-7 rounded-b-full bg-gogo-orange" />}
            <Icon className="block h-[22px] w-[22px]" />
            <span className="text-[10.5px] font-semibold">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
