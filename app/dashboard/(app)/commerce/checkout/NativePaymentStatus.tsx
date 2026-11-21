'use client'
import {useState} from 'react'
type Result={verification?:string;status?:string;paymentVerified:boolean;orderVerified:boolean;
 paymentFailed:boolean;notice:string}
export default function NativePaymentStatus({purchaseId}:{purchaseId:string}){
 const [result,setResult]=useState<Result|null>(null)
 const [busy,setBusy]=useState(false),[attemptedConfirm,setAttemptedConfirm]=useState(false)
 const [message,setMessage]=useState('')
 async function act(action:'check'|'confirm'){
   if(busy||(action==='confirm'&&attemptedConfirm))return
   setBusy(true);setMessage('')
   if(action==='confirm')setAttemptedConfirm(true)
   try{
     const route=action==='check'?'payment-status':'native-confirm'
     const response=await fetch('/api/commerce/purchases/'+encodeURIComponent(purchaseId)+'/'+route,{
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({action}),cache:'no-store',
     })
     const body=await response.json()
     if(!response.ok)throw new Error(body.error||'unavailable')
     if(action==='check')setResult(body)
     else setMessage(body.notice||'Confirmation attempt recorded; verify in Swiggy.')
   }catch(error){
     setMessage(action==='check'
       ? 'Payment status could not be verified. Check Swiggy and avoid retrying checkout.'
       : 'Confirmation outcome unknown. Do not send it again; check Swiggy order history.')
   }finally{setBusy(false)}
 }
 return <section className="space-y-2 rounded-xl border border-[#292929] p-4">
   <h3 className="text-lg font-medium">Swiggy payment and confirmation</h3>
   <p className="text-sm text-[#a0a0a0]">Checks only the payment transaction originally returned by Swiggy. It cannot initiate another charge.</p>
   <button disabled={busy} onClick={()=>void act('check')}
      className="rounded-lg border border-[#2fb8a6] px-3 py-2 text-sm disabled:opacity-50">
      {busy?'Checking…':'Check the original payment status'}</button>
   {result&&<div className="space-y-1 text-sm">
     <p>Payment: {result.paymentVerified?'Verified by Swiggy':result.paymentFailed?'Failed per Swiggy':'Not yet verified'}</p>
     <p>Order auto-confirmed: {result.orderVerified?'Yes':'Not established'}</p>
     <p className="text-[#a0a0a0]">{result.notice}</p>
   </div>}
   {result?.paymentVerified&&!result.orderVerified&&!attemptedConfirm&&
     <button disabled={busy} onClick={()=>void act('confirm')}
       className="rounded-lg border border-[#605035] px-3 py-2 text-sm disabled:opacity-50">
       Complete this paid order once (if not already confirmed)</button>}
   {message&&<p role="alert" className="text-sm">{message}</p>}
   <p className="text-xs text-[#a0a0a0]">One-time confirmation is disabled unless independently authorized by the operator. No automatic repeat after an uncertain result.</p>
 </section>
}
