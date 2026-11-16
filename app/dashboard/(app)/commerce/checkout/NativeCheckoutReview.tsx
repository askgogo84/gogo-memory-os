'use client'
import {useEffect,useState} from 'react'
import NativeOrderStatus from './NativeOrderStatus'
import NativePaymentStatus from './NativePaymentStatus'
type Choice={mode:string;methodId:string;label:string}
type Review={state:string;reviewId?:string;reviewSha256?:string;snapshotSha256?:string;
totalPaise?:number;deliveryAddress?:string;choices?:Choice[];
items?:Array<{name:string;variant:string;quantity:number}>;expiresAt?:string;canCheckout:boolean;notice:string}
export default function NativeCheckoutReview({purchaseId}:{purchaseId:string}){
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false)
 const [review,setReview]=useState<Review|null>(null),[choice,setChoice]=useState('')
 const [ack,setAck]=useState(false),[addressAck,setAddressAck]=useState(false)
 const [attempted,setAttempted]=useState(false),[notice,setNotice]=useState('')
 useEffect(()=>{
   let live=true
   void fetch('/api/commerce',{cache:'no-store'}).then(async response=>{
     if(!response.ok)throw Error('disabled');return response.json()
   }).then(body=>{if(live)setEnabled(body.nativeCheckoutEnabled===true)})
     .catch(()=>{if(live)setEnabled(false)})
   return ()=>{live=false}
 },[])
 if(!enabled)return null
 async function run(payload:Record<string,unknown>){
   const response=await fetch('/api/commerce/purchases/'+encodeURIComponent(purchaseId)+'/native',{
     method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store',
   })
   const data=await response.json()
   if(!response.ok)throw new Error(data.error||'outcome_unavailable')
   return data
 }
 async function prepare(){
   if(busy||attempted)return
   setBusy(true);setNotice('');setReview(null)
   try{
     const data=await run({action:'prepare'})
     setReview(data);setChoice('');setAck(false);setAddressAck(false)
     if(!data.canCheckout)setAttempted(true)
   }catch(e){setNotice('Checkout review unavailable: '+(e instanceof Error?e.message:'unavailable')+'. No order was requested.')}
   finally{setBusy(false)}
 }
 async function execute(){
   if(busy||attempted||!review||!review.canCheckout||!choice||!ack||!addressAck)return
   const method=review.choices?.find(x=>x.mode+':'+x.methodId===choice)
   if(!method)return
   // Suppress retry even when the network acknowledgement is lost.
   setAttempted(true);setBusy(true);setNotice('')
   try{
     const result=await run({action:'execute',reviewId:review.reviewId,reviewSha256:review.reviewSha256,
       snapshotSha256:review.snapshotSha256,totalPaise:review.totalPaise,
       mode:method.mode,methodId:method.methodId,acknowledge:true,addressAccepted:true})
     setNotice(result.notice||'Checkout attempt recorded. Verify status in Swiggy.')
   }catch{
     setNotice('Checkout outcome unknown. Check Swiggy orders and payment records. Do not retry this purchase.')
   }finally{setReview(null);setBusy(false)}
 }
 return <section className="space-y-4 rounded-xl border border-[#605035] p-4">
   <h3 className="text-lg font-medium">Native Swiggy checkout — controlled pilot</h3>
   <p className="text-sm text-[#a0a0a0]">One confirmed merchant checkout can place an order or debit Swiggy Money immediately. Never repeat an uncertain attempt.</p>
   {!review&&!attempted&&<button disabled={busy} onClick={()=>void prepare()}
     className="rounded-lg border border-[#2fb8a6] px-3 py-2 disabled:opacity-50">
     {busy?'Verifying live cart…':'Prepare full address and payment review'}</button>}
   {review?.canCheckout&&<>
     <p className="text-xs text-[#a0a0a0]">For this pilot, UPI intent and QR remain read-only until the complete device payment continuation is validated.</p>
     <p className="text-xl font-medium">₹{((review.totalPaise||0)/100).toFixed(2)} total</p>
     <p className="text-sm">Delivery address: {review.deliveryAddress}</p>
     <ul className="list-disc pl-5 text-sm">
       {(review.items||[]).map((item,i)=><li key={i}>{item.name}{item.variant?' — '+item.variant:''} × {item.quantity}</li>)}
     </ul>
     <p className="text-sm">Review expires {new Date(review.expiresAt||'').toLocaleString('en-IN')}</p>
     <label className="block text-sm">Select verified Swiggy payment method
       <select value={choice} onChange={event=>setChoice(event.target.value)}
         className="mt-2 block w-full rounded-lg bg-[#222] p-2">
         <option value="">Choose one</option>
         {(review.choices||[]).filter(method=>method.mode==='cash_on_delivery'||method.mode==='swiggy_money').map(method=><option key={method.mode+':'+method.methodId}
           value={method.mode+':'+method.methodId}>{method.label} ({method.mode.replaceAll('_',' ')})</option>)}
       </select>
     </label>
     <label className="flex gap-2 text-sm"><input type="checkbox" checked={addressAck}
       onChange={e=>setAddressAck(e.target.checked)}/>I confirmed the exact delivery address above.</label>
     <label className="flex gap-2 text-sm"><input type="checkbox" checked={ack}
       onChange={e=>setAck(e.target.checked)}/>I approve this cart, amount, and payment method; I understand an order or charge may occur immediately.</label>
     <button disabled={busy||attempted||!choice||!ack||!addressAck} onClick={()=>void execute()}
       className="rounded-lg border border-[#2fb8a6] px-3 py-2 disabled:opacity-50">
       {busy?'Submitting one attempt…':'Confirm and place ONE order'}</button>
   </>}
   {notice&&<p role="alert" className="rounded-lg border border-[#605035] p-3 text-sm">{notice}</p>}
   {attempted&&<NativePaymentStatus purchaseId={purchaseId}/>}
   {attempted&&<NativeOrderStatus purchaseId={purchaseId}/>}
   <p className="text-xs text-[#a0a0a0]">No automatic payment or order retry. A missing response is not proof the merchant rejected checkout.</p>
 </section>
}
