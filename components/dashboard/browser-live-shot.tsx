'use client'

import { useEffect, useState } from 'react'

export function BrowserLiveShot({runId,enabled=true}:{runId:string;enabled?:boolean}){
  const [stamp,setStamp]=useState(()=>Date.now())
  const [failed,setFailed]=useState(false)

  useEffect(()=>{
    if(!enabled)return
    // A single transient 502 must not permanently hide a live browser.
    const id=setInterval(()=>setStamp(Date.now()),3000)
    return()=>clearInterval(id)
  },[enabled])

  if(!enabled)return <div className="grid min-h-[260px] place-items-center bg-[#f0eaf1] px-6 text-center text-[13px] leading-5 text-[#6b4a34]">Live browser preview is not available for this handoff.</div>

  return <div className="relative min-h-[260px] bg-[#f0eaf1]">
    <img
      src={`/api/dashboard/agent/runs/${encodeURIComponent(runId)}/browser-shot?t=${stamp}`}
      alt="Live Gogo browser"
      className="block h-full min-h-[260px] w-full object-contain bg-white"
      onLoad={()=>setFailed(false)}
      onError={()=>setFailed(true)}
    />
    {failed&&<div role="status" className="absolute inset-0 grid place-items-center bg-[#f0eaf1] px-6 text-center text-[13px] leading-5 text-[#6b4a34]">Preview reconnecting. Take control opens the live browser in a new tab.</div>}
  </div>
}
