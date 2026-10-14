'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs=[
  { key: 'today', label:'Today',href:'/dashboard/home',glyph:'⌂'},
  { key: 'gogo', label:'Gogo',href:'/dashboard/chat',glyph:'◉'},
  { key: 'activity', label:'Activity',href:'/dashboard/activity',glyph:'↳'},
  { key: 'memory', label:'Memory',href:'/dashboard/memory',glyph:'◇'},
  { key: 'you', label:'You',href:'/dashboard/you',glyph:'♙'},
] as const

export function TabBar(){
  const pathname=usePathname()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[520px] border-t border-[#1f1f1f] bg-[#0f0f0f]/98 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      {tabs.map(t=>{
        const active=pathname===t.href||pathname.startsWith(t.href+'/')
        return <Link key={t.key} href={t.href} className={`relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[12px] font-semibold transition ${active?'text-[#f2efea]':'text-[#a8a8a4]'}`}>
          {active&&<span className="absolute top-0 h-[2px] w-7 rounded-b-full bg-[#2fb8a6]"/>}
          <span className={`text-[22px] ${active?'text-[#2fb8a6]':'text-[#a8a8a4]'}`}>{t.glyph}</span>
          <span>{t.label}</span>
        </Link>
      })}
    </nav>
  )
}
