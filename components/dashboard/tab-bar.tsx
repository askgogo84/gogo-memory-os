'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TAB_ICONS } from './icons'

// ── The one navigation surface ────────────────────────────────────────────────
// Bottom tab bar, persistent, five items (app-flow §7). No hamburger, no nested
// nav, no back-button dependence — every surface is one tap from every other.
// Active tab in --gogo-orange, inactive in ink at 45% (UI/UX brief §6).
//
// Labels follow the mockup/icon-set IA, which supersedes the older brief text:
// "Reminders" → "Today" (a time-view on a spine, not a to-do list) and
// "Profile" → "You". Icons come straight from icons.tsx (TAB_ICONS), unmodified.

// The one source of nav truth. The desktop SideRail (side-rail.tsx) imports this
// same list so the two surfaces can never disagree about what the tabs are.
export const TABS = [
  { key: 'today', label: 'Today', href: '/dashboard/today' },
  { key: 'calendar', label: 'Calendar', href: '/dashboard/calendar' },
  { key: 'lists', label: 'Lists', href: '/dashboard/lists' },
  { key: 'usage', label: 'Usage', href: '/dashboard/usage' },
  { key: 'you', label: 'You', href: '/dashboard/you' },
] as const

export function TabBar() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-[480px] border-t border-gogo-ink/8 bg-gogo-surface lg:hidden">
      {TABS.map(({ key, label, href }) => {
        const Icon = TAB_ICONS[key]
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors duration-500 ease-calm ${
              active ? 'text-gogo-orange' : 'text-gogo-ink/45'
            }`}
          >
            <Icon className="block h-6 w-6" />
            <span className="text-[11px] font-medium">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
