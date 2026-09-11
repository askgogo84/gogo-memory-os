'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TAB_ICONS } from './icons'

// Mobile prioritises the product promise: daily context, agentic work and memory.
// Talk to Gogo remains available as the floating action button.
export const TABS = [
  { key: 'today', label: 'Today', href: '/dashboard/today' },
  { key: 'agent', label: 'Agent', href: '/dashboard/agent' },
  { key: 'memory', label: 'Memory', href: '/dashboard/memory' },
  { key: 'calendar', label: 'Calendar', href: '/dashboard/calendar' },
  { key: 'you', label: 'You', href: '/dashboard/you' },
] as const

export function TabBar() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[480px] border-t border-gogo-ink/8 bg-gogo-surface/96 shadow-[0_-10px_32px_rgba(45,32,22,.05)] backdrop-blur-xl lg:hidden">
      {TABS.map(({ key, label, href }) => {
        const Icon = TAB_ICONS[key]
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors duration-300 ${active ? 'text-gogo-teal' : 'text-gogo-ink/42'}`}
          >
            {active && <span className="absolute top-0 h-[3px] w-7 rounded-b-full bg-gogo-teal" />}
            <Icon className="block h-[22px] w-[22px]" />
            <span className="text-[10.5px] font-semibold">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
