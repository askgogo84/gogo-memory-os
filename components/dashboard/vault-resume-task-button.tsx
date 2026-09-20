'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function VaultResumeTaskButton({runId}:{runId:string}){
  const router=useRouter()
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function resume(){
    if(busy)return
    setBusy(true);setError('')
    try{
      const res=await fetch('/api/dashboard/agent/runs/'+encodeURIComponent(runId)+'/resume',{
        method:'POST',headers:{'content-type':'application/json'},body:'{}',
      })
      const data=await res.json().catch(()=>({}))
      if(!res.ok||!data?.ok)throw new Error(String(data?.error||'resume_failed'))
      router.refresh()
    }catch{
      setError('Gogo could not resume this task yet. Open the login or Take Control and try again.')
    }finally{setBusy(false)}
  }
  return <div>
    <button type="button" onClick={resume} disabled={busy}
      className="inline-flex h-11 w-full items-center justify-center rounded-[11px] bg-[#2FB8A6] px-4 text-[13px] font-bold text-[#0B0B0B] disabled:opacity-50">
      {busy?'Resuming…':'Retry with saved login'}
    </button>
    {error&&<p role="alert" className="mt-2 text-[11px] leading-4 text-[#9a8778]">{error}</p>}
  </div>
}
