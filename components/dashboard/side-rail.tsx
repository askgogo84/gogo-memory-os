'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TAB_ICONS } from './icons'
import { TABS } from './tab-bar'

// ── The desktop nav surface ───────────────────────────────────────────────────
// On lg+ the bottom TabBar is hidden and this left rail takes over (mockup 1i:
// "the same thread widened, not a different product. Left rail replaces the tab
// bar."). It is the first IN-FLOW child of the shell's lg flex-row, sitting to
// the left of <main> INSIDE the centred 1180px frame — so it stays adjacent to
// the content at every viewport width instead of tracking the viewport edge.
//
// lg:sticky + lg:top-0 + lg:self-start + lg:h-screen keep it pinned and full-
// height: self-start opts out of the row's align-items:stretch so h-screen (not
// the content height) governs it, and sticky/top-0 re-pin it during scroll on
// long pages. This preserves the always-visible, viewport-tall behaviour the old
// fixed rail had, but as normal flow so it aligns within the frame (fixed would
// not). NB: sticky is in-flow — it does not shift <main>'s geometry.
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
    <nav className="hidden w-[212px] flex-col gap-[22px] border-r border-gogo-ink/8 bg-gogo-rail px-4 py-[22px] lg:flex lg:sticky lg:top-0 lg:h-screen lg:self-start">
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
