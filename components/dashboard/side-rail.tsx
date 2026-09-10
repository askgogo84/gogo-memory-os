'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef } from 'react'
import { GogoCharacter } from '@/components/gogo/gogo-character'

type NavItem = { href:string; label:string; icon:string }

const primaryItems: NavItem[] = [
  { href: '/dashboard/home', label: 'Home', icon: '⌂' },
  { href: '/dashboard/today', label: 'Daily Gogo', icon: '✦' },
  { href: '/dashboard/chat', label: 'Talk to Gogo', icon: '◉' },
  { href: '/dashboard/agent', label: 'Gogo Agent', icon: '◎' },
  { href: '/dashboard/memory', label: 'Gogo Memory', icon: '◇' },
]

const organiseItems: NavItem[] = [
  { href: '/dashboard/tasks', label: 'Tasks', icon: '☷' },
  { href: '/dashboard/calendar', label: 'Calendar', icon: '▣' },
  { href: '/dashboard/lists', label: 'Lists', icon: '≡' },
]

const gogoItems: NavItem[] = [
  { href: '/dashboard/learn', label: 'Learn with Gogo', icon: '↗' },
  { href: '/dashboard/personalize', label: 'Personalize Gogo', icon: '✣' },
]

const accountItems: NavItem[] = [
  { href: '/dashboard/you', label: 'You & connections', icon: '♙' },
  { href: '/dashboard/usage', label: 'Plan & usage', icon: '◌' },
]

function navActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SideRail() {
  const pathname = usePathname()
  const audioRef = useRef<AudioContext | null>(null)

  function feedback() {
    if (navigator.vibrate) navigator.vibrate(10)
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      const ctx = audioRef.current || new AudioCtx()
      audioRef.current = ctx
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.frequency.value = 540
      gain.gain.setValueAtTime(0.018, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.035)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start()
      oscillator.stop(ctx.currentTime + 0.035)
    } catch {}
  }

  function NavGroup({ title, links }: { title: string; links: NavItem[] }) {
    return (
      <div className="mt-5">
        <div className="px-3 text-[8.5px] font-extrabold uppercase tracking-[0.20em] text-gogo-plum">{title}</div>
        <div className="mt-2 space-y-1">
          {links.map((item) => {
            const active = navActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={feedback}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-[15px] border px-3 py-2.5 text-[11px] font-semibold transition duration-200 active:scale-[.985] ${active ? 'dashboard-nav-active text-gogo-ink' : 'border-transparent text-gogo-ink-2 hover:border-gogo-ink/7 hover:bg-gogo-surface/80 hover:text-gogo-ink hover:shadow-[0_8px_24px_rgba(45,32,22,.05)]'}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] text-[11px] transition ${active ? 'bg-gogo-orange text-white shadow-[0_7px_16px_rgba(239,122,39,.22)]' : 'bg-gogo-surface/76 text-gogo-ink-3 ring-1 ring-gogo-ink/6 group-hover:text-gogo-orange'}`}>{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {active && <span className="h-2 w-2 rounded-full bg-gogo-orange shadow-[0_0_0_4px_rgba(239,122,39,.11)]" aria-hidden="true" />}
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <aside className="dashboard-rail hidden h-screen w-[220px] shrink-0 border-r border-gogo-ink/8 px-3.5 py-4 lg:flex lg:flex-col xl:w-[230px]">
      <Link href="/dashboard/home" className="dashboard-brand mx-0.5 flex items-center gap-3 rounded-[20px] border border-gogo-ink/7 bg-gogo-surface/76 px-3 py-3 shadow-[0_12px_34px_rgba(45,32,22,.06)] backdrop-blur-xl">
        <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[15px] bg-[#fff7ef] ring-1 ring-gogo-orange/12">
          <GogoCharacter state="calm" size={42} showStatus />
        </div>
        <div className="min-w-0">
          <div className="dashboard-brand-wordmark text-[23px] leading-none text-gogo-ink">AskGogo</div>
          <div className="mt-1.5 text-[7.5px] font-bold uppercase tracking-[0.18em] text-gogo-ink-3">Meet Gogo</div>
        </div>
      </Link>

      <NavGroup title="Gogo" links={primaryItems} />
      <NavGroup title="Your world" links={organiseItems} />
      <NavGroup title="Make it yours" links={gogoItems} />
      <NavGroup title="Account" links={accountItems} />

      <div className="dashboard-rail-status mt-auto overflow-hidden rounded-[19px] p-4 shadow-[0_16px_36px_rgba(45,32,22,.11)]">
        <div className="flex items-center gap-2 text-[9.5px] font-bold"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.12)]" />One Gogo. Everywhere.</div>
        <div className="mt-2 text-[9px] leading-[1.55] opacity-75">Same memory, tasks, approvals and background work across WhatsApp and the dashboard.</div>
      </div>
    </aside>
  )
}
