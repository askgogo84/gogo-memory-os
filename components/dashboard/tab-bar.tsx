'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs=[
  {label:'Today',href:'/dashboard/home',glyph:'⌂'},
  {label:'Gogo',href:'/dashboard/chat',glyph:'◉'},
  {label:'Activity',href:'/dashboard/activity',glyph:'↳'},
  {label:'Memory',href:'/dashboard/memory',glyph:'◇'},
  {label:'You',href:'/dashboard/you',glyph:'♙'},
] as const

export function TabBar(){
  const pathname=usePathname()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[520px] border-t border-[#1f1f1f] bg-[#0f0f0f]/98 backdrop-blur-xl lg:hidden">
      {tabs.map(t=>{
        const active=pathname===t.href||pathname.startsWith(t.href+'/')
        return <Link key={t.label} href={t.href} className={`relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition ${active?'text-[#f2efea]':'text-[#6a6a6a]'}`}>
          {active&&<span className="absolute top-0 h-[2px] w-7 rounded-b-full bg-[#2fb8a6]"/>}
          <span className={`text-[18px] ${active?'text-[#2fb8a6]':'text-[#6a6a6a]'}`}>{t.glyph}</span>
          <span>{t.label}</span>
        </Link>
      })}
    </nav>
  )
}
