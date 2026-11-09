'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { DiningObservation } from '@/lib/openui/dining-observation'

function retryPrompt(data:DiningObservation,time?:string){
  const base=`Read-only: recheck table availability at ${data.restaurant}${data.partySize?` for ${data.partySize} people`:''}${data.requestedDate?` on ${data.requestedDate}`:''}${time?` at ${time}`:data.requestedWindow?` around ${data.requestedWindow}`:''}. Use the provider's current booking page. Do not reserve, submit, send, pay or change an account.`
  return '/dashboard/chat?prompt='+encodeURIComponent(base.slice(0,700))
}
function when(value:string|null){
  if(!value)return 'Time not established'
  return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value))+' IST'
}
export function OpenUIDiningResults({data}:{data:DiningObservation}){
  const [sort,setSort]=useState<'early'|'late'>('early')
  const slots=useMemo(()=>sort==='early'?[...data.observedSlots].sort():[...data.observedSlots].sort().reverse(),[data.observedSlots,sort])
  return <section aria-label="Recorded restaurant search" className="rounded-[18px] border border-[#24433e] bg-[#141414] p-4 text-[#f2efea] sm:p-5">
    <p className="text-[12px] font-bold uppercase tracking-[.1em] text-[#4cd0bd]">Interactive dining research · read-only</p>
    <h2 className="mt-2 text-[22px] font-bold">{data.restaurant}</h2>
    <p className="mt-1 text-[14px] text-[#b4b4b0]">
      {data.partySize?`${data.partySize} guests`:'Party size unverified'}
      {' · '}{data.requestedDate||'Date unverified'}
      {data.requestedWindow?` · ${data.requestedWindow}`:''}
    </p>
    <div className="mt-3 rounded-xl border border-[#665230] bg-[#1a1710] p-3">
      <p className="text-[13px] font-semibold text-[#e2b04a]">Not a booking or a real-time availability check</p>
      <p className="mt-1 text-[13px] leading-[1.5] text-[#c4c4c0]">{data.note}</p>
      <p className="mt-2 text-[12px] text-[#a8a8a4]">Saved record: {when(data.observedAt)}</p>
    </div>
    {slots.length>0&&<div className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold">Previously observed time slots</h3>
        <label className="flex items-center gap-2 text-[12px] text-[#c4c4c0]">Order
          <select aria-label="Sort observed dining times" value={sort} onChange={e=>setSort(e.target.value as 'early'|'late')}
            className="min-h-10 rounded-lg border border-[#2f2f2f] bg-[#151515] px-2 text-[#f2efea]">
            <option value="early">Earliest first</option><option value="late">Latest first</option>
          </select>
        </label>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {slots.map(slot=><Link key={slot} href={retryPrompt(data,slot)}
          aria-label={`Recheck ${slot}, not book`}
          className="grid min-h-12 place-items-center rounded-xl border border-[#24433e] bg-[#123d38] text-[15px] font-semibold text-[#8be6d8]">
          {slot} · Recheck
        </Link>)}
      </div>
      <p className="mt-2 text-[12px] text-[#a8a8a4]">Selecting a slot prepares a read-only question. It does not reserve that time.</p>
    </div>}
    {data.status==='checking'&&<p role="status" className="mt-4 text-[14px] text-[#c4c4c0]">Research is still running. Refresh to see its recorded outcome.</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      {data.sourceUrl&&<a href={data.sourceUrl} target="_blank" rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center rounded-xl border border-[#2f2f2f] px-4 text-[13px] font-semibold text-[#8be6d8]">
        Open recorded provider page ↗
      </a>}
      <Link href={retryPrompt(data)} className="inline-flex min-h-11 items-center rounded-xl bg-[#efe6d7] px-4 text-[13px] font-bold text-[#0b0b0b]">
        Recheck in Chat
      </Link>
      <Link href={`/dashboard/activity/${encodeURIComponent(data.id)}`}
        className="inline-flex min-h-11 items-center rounded-xl border border-[#2f2f2f] px-4 text-[13px] text-[#c4c4c0]">
        View task status
      </Link>
    </div>
    <p className="mt-4 text-[12px] leading-[1.55] text-[#a8a8a4]">
      Guest name, contact information, connected accounts and approval records are not displayed here.
      Any later booking needs a fresh provider check and AskGogo's existing exact-action approval and verified receipt.
    </p>
  </section>
}
