'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef } from 'react'

const items = [
  { href: '/dashboard/home', label: 'Home', icon: '✦' },
  { href: '/dashboard/today', label: 'Today', icon: '✦' },
  { href: '/dashboard/chat', label: 'Talk to Gogo', icon: '◉' },
  { href: '/dashboard/agent', label: 'Gogo Agent', icon: '◎' },
  { href: '/dashboard/memory', label: 'Memory', icon: '◇' },
  { href: '/dashboard/tasks', label: 'Tasks', icon: '☷' },
  { href: '/dashboard/calendar', label: 'Calendar', icon: '▣' },
  { href: '/dashboard/lists', label: 'Lists', icon: '≡' },
  { href: '/dashboard/you', label: 'You', icon: '♙' },
]

const gogoItems = [
  { href: '/dashboard/learn', label: 'Learn with Gogo', icon: '☷' },
  { href: '/dashboard/personalize', label: 'Personalize Gogo', icon: '♙' },
]

const accountItems = [
  { href: '/dashboard/usage', label: 'Usage & plan', icon: '◉' },
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

  function NavGroup({ title, links }: { title: string; links: typeof items }) {
    return (
      <div className="mt-6">
        <div className="px-3 text-[9px] font-extrabold uppercase tracking-[0.20em] text-gogo-plum">{title}</div>
        <div className="mt-2.5 space-y-1.5">
          {links.map((item) => {
            const active = navActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={feedback}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-[15px] border px-3 py-2.5 text-[11.5px] font-semibold transition duration-200 active:scale-[.985] ${active ? 'dashboard-nav-active text-gogo-ink' : 'border-transparent text-gogo-ink-2 hover:border-gogo-ink/7 hover:bg-gogo-surface/80 hover:text-gogo-ink hover:shadow-[0_8px_24px_rgba(62,35,18,.055)]'}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] text-[11px] transition ${active ? 'bg-gogo-orange text-white shadow-[0_7px_16px_rgba(241,130,25,.22)]' : 'bg-gogo-surface/78 text-gogo-ink-3 ring-1 ring-gogo-ink/6 group-hover:text-gogo-orange'}`}>{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {active && <span className="h-2 w-2 rounded-full bg-gogo-orange shadow-[0_0_0_4px_rgba(241,130,25,.11)]" aria-hidden="true" />}
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <aside className="dashboard-rail hidden h-screen w-[210px] shrink-0 border-r border-gogo-ink/8 px-3.5 py-5 lg:flex lg:flex-col xl:w-[220px]">
      <div className="dashboard-brand mx-0.5 flex items-center gap-3 rounded-[18px] border border-gogo-ink/7 bg-gogo-surface/74 px-3 py-3 shadow-[0_12px_34px_rgba(62,35,18,.07)] backdrop-blur-xl">
        <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-gogo-orange-tint ring-1 ring-gogo-orange/14">
          <img src="/gogo-float.gif" alt="AskGogo" className="h-9 w-9 object-contain" />
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
        </div>
        <div className="min-w-0">
          <div className="font-serif text-[19px] font-semibold leading-none tracking-[-.2px] text-gogo-ink">AskGogo</div>
          <div className="mt-1.5 text-[7.5px] font-bold uppercase tracking-[0.18em] text-gogo-ink-3">Your calm space</div>
        </div>
      </div>

      <NavGroup title="Your world" links={items} />
      <div className="my-4 border-t border-gogo-ink/8" />
      <NavGroup title="Gogo" links={gogoItems} />
      <div className="my-4 border-t border-gogo-ink/8" />
      <NavGroup title="Account" links={accountItems} />

      <div className="dashboard-rail-status mt-auto overflow-hidden rounded-[18px] p-4 shadow-[0_16px_36px_rgba(62,35,18,.12)]">
        <div className="flex items-center gap-2 text-[9.5px] font-bold"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.12)]" />One Gogo, everywhere</div>
        <div className="mt-2 text-[9px] leading-[1.55] opacity-75">WhatsApp and this dashboard share the same memory, lists, reminders and Agent activity.</div>
      </div>
    </aside>
  )
}
