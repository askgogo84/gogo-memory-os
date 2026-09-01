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
    <nav className="hidden w-[224px] shrink-0 flex-col border-r border-gogo-ink/8 bg-gogo-rail px-4 py-5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:self-start">
      <div className="flex items-center justify-between px-2 pb-5">
        <div className="flex items-center gap-2.5">
          <img src="/gogo-figure.png" alt="" className="h-9 w-9 rounded-full" />
          <div>
            <div className="font-serif text-[18px] font-semibold tracking-[-0.3px] text-gogo-ink">AskGogo</div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gogo-ink-3">Control center</div>
          </div>
        </div>
        <ThemeToggle />
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
              className={`flex items-center gap-[11px] rounded-[13px] px-3 py-2.5 text-sm transition-all duration-300 ${active ? 'bg-gogo-surface font-bold text-gogo-orange shadow-[0_5px_20px_rgba(62,35,18,0.06)]' : 'font-medium text-gogo-ink-2 hover:bg-gogo-surface/65 hover:text-gogo-ink'}`}
            >
              <Icon className="block h-[19px] w-[19px] shrink-0" />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>

      <div className="mt-6 border-t border-gogo-ink/8 pt-4">
        <div className="mb-2 px-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-gogo-ink-3">Account</div>
        <Link
          href="/dashboard/usage"
          aria-current={usageActive ? 'page' : undefined}
          className={`flex items-center gap-[11px] rounded-[13px] px-3 py-2.5 text-sm transition-all duration-300 ${usageActive ? 'bg-gogo-surface font-bold text-gogo-orange shadow-[0_5px_20px_rgba(62,35,18,0.06)]' : 'font-medium text-gogo-ink-2 hover:bg-gogo-surface/65 hover:text-gogo-ink'}`}
        >
          <UsageIcon className="block h-[19px] w-[19px] shrink-0" />
          <span>Usage & plan</span>
        </Link>
      </div>

      <div className="mt-auto rounded-[18px] border border-gogo-ink/8 bg-gogo-surface/65 p-3.5">
        <div className="text-[12.5px] font-bold text-gogo-ink">AskGogo lives in WhatsApp</div>
        <p className="mt-1 text-[11.5px] leading-5 text-gogo-ink-3">Use this dashboard to see, organise and control what Gogo remembers.</p>
      </div>
    </nav>
  )
}
