'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TAB_ICONS } from './icons'
import { TABS } from './tab-bar'

// ── The desktop nav surface ───────────────────────────────────────────────────
// On lg+ the bottom TabBar is hidden and this left rail takes over (mockup 1i:
// "the same thread widened, not a different product. Left rail replaces the tab
// bar."). It is a fixed sibling of the shell, not a flex child of the centred
// 480px column — so it sits at the viewport's left edge while the column stays
// centred, and adds nothing to the flow that could shift <main>'s geometry.
//
// EVERYTHING here is lg:-prefixed / gated behind `hidden lg:flex`: below lg the
// component renders display:none, so narrow (mobile) output is byte-identical to
// before this phase. The tab list and icons come from tab-bar.tsx / icons.tsx —
// one source of nav truth, no second icon set.
//
// Active/inactive states mirror the mockup rail: active item on surface-white
// with the orange accent and a hairline shadow; inactive in warm ink-2.

export function SideRail() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-y-0 left-0 z-10 hidden w-[212px] flex-col gap-[22px] border-r border-gogo-ink/8 bg-gogo-rail px-4 py-[22px] lg:flex">
      <div className="flex items-center px-3">
        <span className="font-serif text-[18px] font-semibold tracking-[-0.3px] text-gogo-ink">AskGogo</span>
      </div>

      <div className="flex flex-col gap-[3px]">
        {TABS.map(({ key, label, href }) => {
          const Icon = TAB_ICONS[key]
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-[11px] rounded-xl px-3 py-2.5 text-sm transition-colors duration-500 ease-calm ${
                active
                  ? 'bg-gogo-surface font-bold text-gogo-orange shadow-[0_1px_3px_rgba(62,35,18,0.06)]'
                  : 'font-medium text-gogo-ink-2'
              }`}
            >
              <Icon className="block h-[19px] w-[19px] shrink-0" />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
