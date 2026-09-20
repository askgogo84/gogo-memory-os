'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function VaultRemoveButton({id}:{id:string}){
  const router=useRouter()
  const [busy,setBusy]=useState(false)
  async function remove(){
    if(busy||!confirm('Remove this saved login from AskGogo Vault?'))return
    setBusy(true)
    try{
      const res=await fetch('/api/dashboard/vault',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({id})})
      if(!res.ok)throw new Error('delete_failed')
      router.refresh()
    }finally{setBusy(false)}
  }
  return <button type="button" onClick={remove} disabled={busy} className="rounded-full border border-gogo-ink/12 px-3 py-1.5 text-[11px] font-semibold text-gogo-ink-2 disabled:opacity-50">{busy?'Removing…':'Remove'}</button>
}
