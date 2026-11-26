'use client'
import {useState} from 'react'

type Options={
  choices:Array<{mode:string;methodId:string;label:string}>
  agenticEligible:boolean; totalPaise:number; checkedAt:string
  checkoutEnabled:false;notice:string
}

export default function NativePaymentOptions({purchaseId}:{purchaseId:string}){
  const [options,setOptions]=useState<Options|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const show=async()=>{
    setBusy(true);setError('');setOptions(null)
    try{
      const response=await fetch('/api/commerce/purchases/'+encodeURIComponent(purchaseId)+'/payment-options',{cache:'no-store'})
      const data=await response.json()
      if(!response.ok) throw new Error(data.error||'provider_unavailable')
      setOptions(data)
    }catch(e){setError('Payment options unavailable: '+(e instanceof Error?e.message:'provider_unavailable')+'. No checkout was initiated.')}
    finally{setBusy(false)}
  }
  return <section className="space-y-3 rounded-xl border border-[#292929] p-4">
    <h3 className="text-lg font-medium">Merchant payment methods (read-only pilot)</h3>
    <p className="text-sm text-[#a0a0a0]">AskGogo can check live Swiggy options for the exact cart. It cannot place orders or initiate a payment in this pilot.</p>
    <button disabled={busy} onClick={()=>void show()} className="rounded-lg border border-[#2fb8a6] px-3 py-2 text-sm disabled:opacity-50">
      {busy?'Reading merchant methods…':'Check live payment options'}
    </button>
    {error&&<p role="alert" className="text-sm">{error}</p>}
    {options&&<div className="text-sm space-y-2">
      <p>Provider payable: ₹{(options.totalPaise/100).toFixed(2)}. Checked: {new Date(options.checkedAt).toLocaleString('en-IN')}</p>
      <ul className="list-disc pl-5">{options.choices.map(choice=><li key={choice.methodId}>{choice.label} ({choice.mode.replaceAll('_',' ')})</li>)}</ul>
      <p className="text-[#a0a0a0]">{options.notice}</p>
    </div>}
  </section>
}
