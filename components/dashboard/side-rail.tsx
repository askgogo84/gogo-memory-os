'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef } from 'react'

const items = [
  { href: '/dashboard/home', label: 'Home', icon: '✦' },
  { href: '/dashboard/today', label: 'Today', icon: '✦' },
  { href: '/dashboard/chat', label: 'Talk to Gogo', icon: '◉' },
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
      <div className="mt-5">
        <div className="px-3 text-[8px] font-bold uppercase tracking-[0.18em] text-gogo-ink-4">{title}</div>
        <div className="mt-2 space-y-1">
          {links.map((item) => {
            const active = navActive(pathname, item.href)
            return (
              <Link key={item.href} href={item.href} onClick={feedback}
                aria-current={active ? 'page' : undefined}
                className={`group flex items-center gap-3 rounded-[13px] px-3 py-2.5 text-[11px] font-medium transition duration-150 active:scale-[.985] ${active ? 'bg-white text-gogo-orange shadow-[0_6px_18px_rgba(62,35,18,.07)] ring-1 ring-gogo-orange/10' : 'text-gogo-ink-2 hover:bg-white/65 hover:text-gogo-ink'}`}>
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] transition ${active ? 'bg-gogo-orange/10 text-gogo-orange' : 'bg-white/70 text-gogo-ink-4 group-hover:bg-white'}`}>{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-gogo-orange" aria-hidden="true" />}
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <aside className="hidden h-screen w-[178px] shrink-0 border-r border-gogo-ink/7 bg-gogo-cream/70 px-3 py-5 lg:flex lg:flex-col xl:w-[190px]">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <img src="/gogo-float.gif" alt="AskGogo" className="h-8 w-8 object-contain" />
          <div><div className="font-serif text-[17px] font-semibold leading-none text-gogo-ink">AskGogo</div><div className="mt-1 text-[7px] font-semibold uppercase tracking-[0.16em] text-gogo-ink-4">Your calm space</div></div>
        </div>
      </div>

      <NavGroup title="Your world" links={items} />
      <div className="my-4 border-t border-gogo-ink/7" />
      <NavGroup title="Gogo" links={gogoItems} />
      <div className="my-4 border-t border-gogo-ink/7" />
      <NavGroup title="Account" links={accountItems} />

      <div className="mt-auto rounded-[16px] border border-gogo-ink/7 bg-white/65 p-3">
        <div className="flex items-center gap-2 text-[8.5px] font-semibold text-gogo-ink-2"><span className="h-2 w-2 rounded-full bg-emerald-400" />One Gogo, everywhere</div>
        <div className="mt-2 text-[8px] leading-4 text-gogo-ink-4">WhatsApp and this dashboard share the same memory, lists, reminders and actions.</div>
      </div>
    </aside>
  )
}
