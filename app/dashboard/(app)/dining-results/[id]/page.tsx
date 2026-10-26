'use client'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import type { DiningObservation } from '@/lib/openui/dining-observation'
import { OpenUIDiningResults } from '@/components/dashboard/openui-dining-results'

export default function DiningResultsPage({params}:{params:Promise<{id:string}>}){
  const {id}=use(params)
  const [data,setData]=useState<DiningObservation|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    let active=true
    const refresh=async()=>{
      if(typeof document!=='undefined'&&document.hidden)return
      try{
        const res=await fetch('/api/openui/dining/'+encodeURIComponent(id),{
          cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000),
        })
        if(!res.ok)throw new Error(res.status===401?'Please sign in to view your dining research.':res.status===404?'No restaurant evidence was found for this account.':'Saved dining research could not be loaded.')
        const body=await res.json()
        if(active){setData(body);setError('')}
      }catch(e){if(active){setData(null);setError(e instanceof Error?e.message:'Unable to load saved research.')}}
    }
    void refresh()
    const timer=setInterval(()=>void refresh(),30000)
    return()=>{active=false;clearInterval(timer)}
  },[id])
  return <main className="mx-auto w-full max-w-[760px] space-y-4 pb-10">
    <Link href="/dashboard/activity" className="text-[14px] font-semibold text-[#2fb8a6]">← Activity</Link>
    <h1 className="font-serif text-[27px] text-[#f2efea]">Dining research</h1>
    {error&&<p role="alert" className="rounded-xl border border-[#665230] p-4 text-[#e2b04a]">{error}</p>}
    {!data&&!error&&<p role="status" className="text-[15px] text-[#b4b4b0]">Loading your saved provider observations…</p>}
    {data&&<OpenUIDiningResults data={data}/>}
  </main>
}
