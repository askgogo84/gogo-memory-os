'use client'

import { useEffect, useState } from 'react'

export function BrowserLiveShot({runId,enabled=true}:{runId:string;enabled?:boolean}){
  const [stamp,setStamp]=useState(()=>Date.now())
  const [failed,setFailed]=useState(false)

  useEffect(()=>{
    if(!enabled)return
    const id=setInterval(()=>setStamp(Date.now()),1400)
    return()=>clearInterval(id)
  },[enabled])

  if(!enabled||failed)return <div className="grid min-h-[260px] place-items-center bg-[#f0eaf1] px-6 text-center text-[13px] leading-5 text-[#6b4a34]">Live browser preview is not available for this handoff.</div>

  return <img
    src={`/api/dashboard/agent/runs/${encodeURIComponent(runId)}/browser-shot?t=${stamp}`}
    alt="Live Gogo browser"
    className="block h-full min-h-[260px] w-full object-contain bg-white"
    onError={()=>setFailed(true)}
  />
}
