'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { GogoCharacter } from '@/components/gogo/gogo-character'

type NavItem = {
  href: string
  label: string
  glyph: string
  match?: (pathname:string, section:string)=>boolean
  badgeKey?: 'approvals'|'watchers'
}

const nav: NavItem[] = [
  { href:'/dashboard/home', label:'Today', glyph:'⌂' },
  { href:'/dashboard/chat', label:'Gogo', glyph:'◉' },
  { href:'/dashboard/activity', label:'Activity', glyph:'↳' },
  { href:'/dashboard/agent?section=approvals', label:'Needs you', glyph:'!', badgeKey:'approvals', match:(p,s)=>p==='/dashboard/agent'&&s==='approvals' },
  { href:'/dashboard/agent?section=background', label:'Background', glyph:'◎', badgeKey:'watchers', match:(p,s)=>p==='/dashboard/agent'&&s==='background' },
  { href:'/dashboard/agent?section=goals', label:'Goals', glyph:'○', match:(p,s)=>p==='/dashboard/agent'&&s==='goals' },
  { href:'/dashboard/brain', label:'Brain', glyph:'◈' },
  { href:'/dashboard/memory', label:'Memory', glyph:'◇' },
  { href:'/dashboard/library', label:'Library', glyph:'▣' },
  { href:'/dashboard/connections', label:'Connections', glyph:'⌁' },
  { href:'/dashboard/you/vault', label:'Vault', glyph:'▰' },
  { href:'/dashboard/you', label:'You', glyph:'♙', match:(p,s)=>p==='/dashboard/you'&&!s },
]

export function SideRail() {
  const pathname=usePathname()
  const params=useSearchParams()
  const section=params.get('section')||''
  const [counts,setCounts]=useState({approvals:0,watchers:0})

  useEffect(()=>{
    let alive=true
    fetch('/api/agent/snapshot',{cache:'no-store',credentials:'same-origin'})
      .then(r=>r.ok?r.json():null)
      .then(data=>{
        if(!alive||!data)return
        setCounts({
          approvals:Array.isArray(data.approvals)?data.approvals.length:0,
          watchers:Array.isArray(data.watchers)?data.watchers.length:0,
        })
      }).catch(()=>{})
    return()=>{alive=false}
  },[pathname])

  function active(item:NavItem){
    if(item.match)return item.match(pathname,section)
    if(item.href.includes('?'))return false
    return pathname===item.href||pathname.startsWith(item.href+'/')
  }

  return (
    <aside className="dashboard-rail hidden h-screen w-[248px] shrink-0 px-3.5 py-5 lg:flex lg:flex-col xl:w-[264px]">
      <Link href="/dashboard/home" className="dashboard-brand flex items-center gap-3 rounded-[14px] border px-3 py-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#f2efea] text-[#0b0b0b]">
          <GogoCharacter state="calm" size={46} showStatus={false} />
        </div>
        <div className="min-w-0">
          <div className="dashboard-brand-wordmark text-gogo-ink">AskGogo</div>
          <div className="mt-1 text-[12px] tracking-[.02em] text-[#a8a8a4]">One Gogo, everywhere</div>
        </div>
      </Link>

      <nav className="mt-5 space-y-1.5" aria-label="AskGogo dashboard">
        {nav.map(item=>{
          const isActive=active(item)
          const badge=item.badgeKey?counts[item.badgeKey]:0
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={isActive?'page':undefined}
              className={`dashboard-nav-link relative flex items-center gap-3 rounded-[12px] border px-3 py-2.5 text-[16px] font-medium transition ${isActive?'dashboard-nav-active text-gogo-ink':'border-transparent text-[#c4c4c0] hover:bg-[#141414] hover:text-[#f2efea]'}`}
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border text-[14px] ${isActive?'border-[#2fb8a6]/30 bg-[#132a27] text-[#2fb8a6]':'border-[#1f1f1f] bg-[#111] text-[#8a8a86]'}`}>{item.glyph}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {badge>0&&<span className={`min-w-6 rounded-full px-2 py-0.5 text-center text-[13px] font-semibold ${item.badgeKey==='approvals'?'bg-[#2a2111] text-[#d9a441]':'bg-[#123d38] text-[#2fb8a6]'}`}>{badge}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="dashboard-rail-status mt-auto rounded-[14px] p-4">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-[#e0e0dc]">
          <span className="h-2 w-2 rounded-full bg-[#2fb8a6]" />
          Safe mode on
        </div>
        <p className="mt-2 text-[14px] leading-[1.5] text-[#b4b4b0]">Gogo asks before anything that sends, spends, books or submits.</p>
      </div>
    </aside>
  )
}

