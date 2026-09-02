'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TAB_ICONS, UsageIcon } from './icons'
import { TABS } from './tab-bar'
import { ThemeToggle } from './theme-toggle'

export function SideRail() {
  const pathname = usePathname()
  const usageActive = pathname === '/dashboard/usage' || pathname.startsWith('/dashboard/usage/')

  return (
    <nav className="relative z-20 hidden w-[244px] shrink-0 flex-col border-r border-gogo-ink/7 bg-gogo-rail/88 px-4 py-5 backdrop-blur-2xl lg:sticky lg:top-0 lg:flex lg:h-screen lg:self-start">
      <div className="flex items-center justify-between px-2 pb-6">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-gogo-orange/20 blur-md" />
            <img src="/gogo-figure.png" alt="" className="relative h-10 w-10 rounded-full" />
          </div>
          <div>
            <div className="font-serif text-[19px] font-semibold tracking-[-0.35px] text-gogo-ink">AskGogo</div>
            <div className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-gogo-ink-3">Your calm space</div>
          </div>
        </div>
        <ThemeToggle />
      </div>

      <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">Your world</div>
      <div className="flex flex-col gap-[3px]">
        {TABS.map(({ key, label, href }) => {
          const Icon = TAB_ICONS[key]
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`group flex items-center gap-[11px] rounded-[14px] px-3 py-2.5 text-sm transition-all duration-300 ${active ? 'bg-gogo-surface font-bold text-gogo-orange shadow-[0_8px_28px_rgba(62,35,18,0.07)]' : 'font-medium text-gogo-ink-2 hover:bg-gogo-surface/60 hover:text-gogo-ink'}`}
            >
              <span className={`grid h-8 w-8 place-items-center rounded-[11px] transition-colors ${active ? 'bg-gogo-orange-tint text-gogo-orange' : 'bg-gogo-surface/45 text-gogo-ink-3 group-hover:text-gogo-orange'}`}>
                <Icon className="block h-[18px] w-[18px] shrink-0" />
              </span>
              <span>{label}</span>
            </Link>
          )
        })}
      </div>

      <div className="mt-7 border-t border-gogo-ink/7 pt-4">
        <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">Account</div>
        <Link
          href="/dashboard/usage"
          aria-current={usageActive ? 'page' : undefined}
          className={`flex items-center gap-[11px] rounded-[14px] px-3 py-2.5 text-sm transition-all duration-300 ${usageActive ? 'bg-gogo-surface font-bold text-gogo-orange shadow-[0_8px_28px_rgba(62,35,18,0.07)]' : 'font-medium text-gogo-ink-2 hover:bg-gogo-surface/60 hover:text-gogo-ink'}`}
        >
          <span className={`grid h-8 w-8 place-items-center rounded-[11px] ${usageActive ? 'bg-gogo-orange-tint text-gogo-orange' : 'bg-gogo-surface/45 text-gogo-ink-3'}`}>
            <UsageIcon className="block h-[18px] w-[18px] shrink-0" />
          </span>
          <span>Usage & plan</span>
        </Link>
      </div>

      <div className="mt-auto overflow-hidden rounded-[20px] border border-gogo-ink/7 bg-gogo-surface/62 p-4 shadow-[0_14px_40px_rgba(62,35,18,0.04)]">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.10)]" />
          <div className="text-[12px] font-bold text-gogo-ink">Everything is connected</div>
        </div>
        <p className="mt-2 text-[11.5px] leading-5 text-gogo-ink-3">AskGogo stays in WhatsApp. This space simply makes your day, memory and plans easier to see.</p>
      </div>
    </nav>
  )
}
