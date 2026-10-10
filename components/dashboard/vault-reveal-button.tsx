'use client'

import { useEffect, useState } from 'react'

// Shows a Gogo-generated password for 60 seconds, with a Copy button. Never stored in the page.
export function VaultRevealButton({id}:{id:string}){
  const [secret,setSecret]=useState<string|null>(null)
  const [busy,setBusy]=useState(false)
  const [note,setNote]=useState('')
  useEffect(()=>{
    if(!secret)return
    const t=setTimeout(()=>{setSecret(null);setNote('')},60_000)
    return ()=>clearTimeout(t)
  },[secret])
  async function reveal(){
    if(busy)return
    if(secret){setSecret(null);setNote('');return}
    setBusy(true);setNote('')
    try{
      const res=await fetch('/api/dashboard/vault/reveal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id}),cache:'no-store'})
      const data=await res.json().catch(()=>({}))
      if(!res.ok||!data?.secret){setNote('Could not show the password. Try again.');return}
      setSecret(String(data.secret))
    }finally{setBusy(false)}
  }
  async function copy(){
    if(!secret)return
    try{await navigator.clipboard.writeText(secret);setNote('Copied.')}catch{setNote('Copy failed. Select the password and copy it.')}
  }
  return <div className="mt-3">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={reveal} disabled={busy} className="rounded-full border border-gogo-ink/12 px-3 py-1.5 text-[11px] font-semibold text-gogo-ink-2 disabled:opacity-50">{busy?'Opening…':secret?'Hide password':'Show password'}</button>
      {secret?<button type="button" onClick={copy} className="rounded-full bg-gogo-ink px-3 py-1.5 text-[11px] font-semibold text-white">Copy</button>:null}
    </div>
    {secret?<p className="mt-2 select-all break-all rounded-[10px] bg-gogo-cream/70 px-3 py-2 font-mono text-[13px] text-gogo-ink">{secret}</p>:null}
    {note?<p className="mt-1 text-[11px] text-gogo-ink-3">{note}</p>:null}
  </div>
}
