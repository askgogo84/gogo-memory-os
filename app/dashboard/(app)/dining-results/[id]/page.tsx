'use client'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import type { DiningObservation } from '@/lib/openui/dining-observation'
import { OpenUIDiningResults } from '@/components/dashboard/openui-dining-results'

function isCurrentDiningRead(value: unknown, id: string): value is DiningObservation {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<DiningObservation>
  return record.id === id &&
    typeof record.restaurant === 'string' && record.restaurant.trim().length > 0 &&
    typeof record.note === 'string' &&
    ['checking','needs_review','historical_slots','unavailable'].includes(String(record.status)) &&
    ['restaurant_reservation_slot','restaurant_reservation_research'].includes(String(record.runType)) &&
    Array.isArray(record.observedSlots) && record.observedSlots.every(slot => typeof slot === 'string')
}

export default function DiningResultsPage({params}:{params:Promise<{id:string}>}){
  const {id}=use(params)
  const [data,setData]=useState<DiningObservation|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    let active=true
    let busy=false
    // A route/owner navigation cannot retain another saved record while revalidating.
    setData(null)
    setError('')
    const refresh=async()=>{
      if(busy||(typeof document!=='undefined'&&document.hidden))return
      busy=true
      try{
        const res=await fetch('/api/openui/dining/'+encodeURIComponent(id),{
          cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000),
        })
        if(!res.ok)throw new Error(res.status===401?'Please sign in to view your dining research.':res.status===404?'No restaurant evidence was found for this account.':'Saved dining research could not be loaded.')
        const body: unknown=await res.json()
        if(!isCurrentDiningRead(body,id))throw new Error('Saved dining evidence was incomplete. Recheck this record.')
        if(active){setData(body);setError('')}
      }catch(e){
        // Failed auth, malformed results and network errors revoke prior private cards.
        if(active){setData(null);setError(e instanceof Error?e.message:'Unable to load saved research.')}
      }finally{busy=false}
    }
    void refresh()
    const timer=setInterval(()=>void refresh(),30000)
    return()=>{active=false;clearInterval(timer)}
  },[id])
  // The effect runs AFTER render: never flash a previous route's private cards.
  const visibleData=data?.id===id?data:null
  return <main className="mx-auto w-full max-w-[760px] space-y-4 pb-10">
    <Link href="/dashboard/activity" className="text-[14px] font-semibold text-[#2fb8a6]">← Activity</Link>
    <h1 className="font-serif text-[27px] text-[#f2efea]">Dining research</h1>
    {error&&<p role="alert" className="rounded-xl border border-[#665230] p-4 text-[#e2b04a]">{error}</p>}
    {!visibleData&&!error&&<p role="status" className="text-[15px] text-[#b4b4b0]">Loading your saved provider observations…</p>}
    {visibleData&&<OpenUIDiningResults data={visibleData}/>}
  </main>
}
