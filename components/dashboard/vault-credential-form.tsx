'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'

export function VaultCredentialForm(props:{
  provider:string
  providerLabel:string
  usernameLabel:string
  secretLabel:string
  note:string
  accountLabelDefault:string
}){
  const router=useRouter()
  const [username,setUsername]=useState('')
  const [secret,setSecret]=useState('')
  const [accountLabel,setAccountLabel]=useState(props.accountLabelDefault)
  const [show,setShow]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [saved,setSaved]=useState(false)

  async function submit(e:FormEvent){
    e.preventDefault()
    if(busy)return
    setBusy(true);setError('');setSaved(false)
    try{
      const res=await fetch('/api/dashboard/vault',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({provider:props.provider,username,secret,accountLabel}),
      })
      const data=await res.json().catch(()=>({}))
      if(!res.ok||!data?.ok)throw new Error(String(data?.error||'save_failed'))
      setSecret('')
      setSaved(true)
      setTimeout(()=>router.push('/dashboard/you/vault'),650)
    }catch{
      setError('Could not save this login securely. Check the details and try again.')
    }finally{
      setBusy(false)
    }
  }

  return <form onSubmit={submit} className="space-y-5">
    <div>
      <label className="mb-2 block text-[12px] font-semibold text-gogo-ink-2">Account label</label>
      <input value={accountLabel} onChange={e=>setAccountLabel(e.target.value)} autoComplete="off" maxLength={120}
        className="h-12 w-full rounded-[14px] border border-gogo-ink/12 bg-white px-4 text-[16px] text-gogo-ink outline-none focus:border-[#2FB8A6]"/>
    </div>
    <div>
      <label className="mb-2 block text-[12px] font-semibold text-gogo-ink-2">{props.usernameLabel}</label>
      <input value={username} onChange={e=>setUsername(e.target.value)} required autoComplete="username"
        className="h-12 w-full rounded-[14px] border border-gogo-ink/12 bg-white px-4 text-[16px] text-gogo-ink outline-none focus:border-[#2FB8A6]"/>
    </div>
    <div>
      <label className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-gogo-ink-2">{props.secretLabel}<span aria-hidden="true">🔒</span></label>
      <div className="relative">
        <input value={secret} onChange={e=>setSecret(e.target.value)} required type={show?'text':'password'} autoComplete="current-password"
          className="h-12 w-full rounded-[14px] border border-gogo-ink/12 bg-white px-4 pr-14 text-[16px] text-gogo-ink outline-none focus:border-[#2FB8A6]"/>
        <button type="button" onClick={()=>setShow(v=>!v)} className="absolute right-2 top-1/2 min-h-10 -translate-y-1/2 rounded-[10px] px-3 text-[12px] font-semibold text-gogo-ink-3">{show?'Hide':'Show'}</button>
      </div>
    </div>

    <div className="rounded-[14px] border border-gogo-ink/10 bg-gogo-cream/60 p-4 text-[12px] leading-5 text-gogo-ink-3">
      {props.note}<br/>
      Gogo never puts this password into chat, memory, Activity, or model prompts.
    </div>

    {error&&<p role="alert" className="rounded-[12px] border border-red-900/15 bg-red-50 px-3 py-2 text-[12px] text-red-800">{error}</p>}
    {saved&&<p role="status" className="rounded-[12px] border border-emerald-900/10 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-800">✓ Login saved securely.</p>}

    <button type="submit" disabled={busy||!username||!secret}
      className="flex h-12 w-full items-center justify-center rounded-[14px] bg-gogo-ink px-5 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
      {busy?'Saving securely…':'Save to Vault'}
    </button>
  </form>
}
