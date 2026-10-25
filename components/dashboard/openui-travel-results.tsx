'use client'
import Link from 'next/link'
import {useMemo,useState} from 'react'
import type {SavedTravelResult,TravelCard} from '@/lib/openui/travel-observation'

type Sort='amount'|'time'|'name'
function validAt(at:string|null){
  if(!at)return 'Observation time unavailable'
  const ms=Date.parse(at)
  if(!Number.isFinite(ms))return 'Observation time unavailable'
  return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(ms))+' IST'
}
function amountNumber(c:TravelCard){
  if(!c.amount)return Infinity
  const num=Number(c.amount.replace(/[^\d.]/g,''))
  return Number.isFinite(num)?num:Infinity
}
function followup(data:SavedTravelResult,card:TravelCard){
  const phrase=data.kind==='flight'?'this observed flight option':'this hotel option'
  const prompt='Read-only: recheck '+phrase+' ('+card.title.slice(0,70)+') for '+data.title.slice(0,100)+
    '. Show provider-supported current availability, date, fare/price basis, fees and booking link if available. Do not book, reserve, pay, or modify anything.'
  return '/dashboard/chat?prompt='+encodeURIComponent(prompt.slice(0,800))
}
export function OpenUITravelResults({data,compact=false,fullHref}:{data:SavedTravelResult;compact?:boolean;fullHref?:string}){
  const [sort,setSort]=useState<Sort>('amount')
  const [pricedOnly,setPricedOnly]=useState(false)
  const rows=useMemo(()=>{
    const list=pricedOnly?data.cards.filter(c=>c.amount!==null):[...data.cards]
    if(sort==='name')return list.sort((a,b)=>a.title.localeCompare(b.title))
    if(sort==='time')return list.sort((a,b)=>(Date.parse(b.observedAt||'')||0)-(Date.parse(a.observedAt||'')||0))
    return list.sort((a,b)=>amountNumber(a)-amountNumber(b))
  },[data,sort,pricedOnly])
  const shown=compact?rows.slice(0,4):rows
  return <section className="w-full min-w-0 rounded-[18px] border border-[#24433e] bg-[#141414] p-4 text-[#f2efea]" aria-label="Interactive travel search results">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[12px] font-bold uppercase tracking-[.1em] text-[#4cd0bd]">{data.kind==='flight'?'Observed flights':'Provider-returned hotels'}</div>
        <h2 className="mt-1 break-words text-[19px] font-bold">{data.title}</h2>
        <div className="mt-1 text-[12px] text-[#a8a8a4]">{data.cards.length} result{data.cards.length===1?'':'s'} · {data.source}</div>
      </div>
      {fullHref&&<Link href={fullHref} className="min-h-10 rounded-xl border border-[#24433e] px-3 py-2 text-[12px] font-semibold text-[#4cd0bd]">Full results</Link>}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-[#2f2f2f] px-3 text-[13px]">
        <input type="checkbox" checked={pricedOnly} onChange={e=>setPricedOnly(e.target.checked)} className="accent-[#4cd0bd]"/> Observed amount only
      </label>
      <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[#2f2f2f] px-3 text-[13px]">
        Sort <select value={sort} aria-label="Sort travel options" onChange={e=>setSort(e.target.value as Sort)} className="bg-transparent text-[13px] text-[#f2efea]">
          <option className="bg-[#141414]" value="amount">Amount</option>
          <option className="bg-[#141414]" value="time">Latest observation</option>
          <option className="bg-[#141414]" value="name">Name</option>
        </select>
      </label>
    </div>
    <div className="mt-3 grid gap-3">
      {shown.map(c=><article key={c.id} className="rounded-[15px] border border-[#2f2f2f] bg-[#1c1c1c] p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words text-[16px] font-semibold">{c.title}</h3>
            {c.subtitle&&<p className="mt-1 break-words text-[13px] text-[#c4c4c0]">{c.subtitle}</p>}
          </div>
          <div className="shrink-0 text-right"><div className="text-[18px] font-bold tabular-nums">{c.amount||'—'}</div>
            <div className="max-w-[125px] text-[11px] text-[#a8a8a4]">{c.amount?'Observed amount':'Unverified price'}</div></div>
        </div>
        <p className="mt-2 text-[12px] text-[#a8a8a4]">{validAt(c.observedAt)}</p>
        {c.details.length>0&&<p className="mt-1 text-[12px] text-[#c4c4c0]">{c.details.join(' · ')}</p>}
        <p className="mt-1 text-[12px] leading-5 text-[#e2b04a]">{c.priceBasis}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {c.sourceUrl&&<a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-[#24433e] px-3 text-[12px] text-[#8be6d8]">Open search source ↗</a>}
          <Link href={followup(data,c)} className="inline-flex min-h-11 items-center rounded-xl border border-[#4cd0bd] px-3 text-[12px] font-semibold text-[#8be6d8]">Recheck in Chat</Link>
        </div>
      </article>)}
      {!shown.length&&<p className="rounded-xl border border-[#2f2f2f] p-5 text-center text-[13px] text-[#c4c4c0]">No qualifying observed results. Clear the filter to see all available options.</p>}
    </div>
    {compact&&rows.length>shown.length&&fullHref&&<Link className="mt-3 block text-center text-[13px] text-[#4cd0bd]" href={fullHref}>View all {rows.length} results</Link>}
    <p className="mt-3 text-[12px] leading-5 text-[#b4b4b0]">{data.notice}</p>
  </section>
}
