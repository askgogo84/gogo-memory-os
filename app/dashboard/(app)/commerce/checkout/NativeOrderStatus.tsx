'use client'
import {useState} from 'react'
type Report={status:string;orders:Array<{orderId:string|null;orderStatus:string;orderVerified:boolean;
 paymentVerified:boolean;paymentStatus:string}>;notice:string;paymentVerified:boolean;allVerified:boolean;partial:boolean}
export default function NativeOrderStatus({purchaseId}:{purchaseId:string}){
 const [report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 async function check(){
   setBusy(true);setError('')
   try{
     const res=await fetch('/api/commerce/purchases/'+encodeURIComponent(purchaseId)+'/native-status',{cache:'no-store'})
     if(!res.ok)throw Error('unavailable')
     setReport(await res.json())
   }catch{setReport(null);setError('Merchant history is not available. Verify the order directly in Swiggy.')}
   finally{setBusy(false)}
 }
 return <section className="space-y-2 rounded-xl border border-[#292929] p-4">
   <h3 className="text-lg font-medium">Verify native Swiggy order history</h3>
   <button disabled={busy} onClick={()=>void check()}
    className="rounded-lg border border-[#2fb8a6] px-3 py-2 text-sm disabled:opacity-50">
    {busy?'Checking authenticated merchant orders…':'Check order history (read-only)'}</button>
   {report&&<div className="space-y-2 text-sm">
     {report.orders.map((order,i)=><p key={order.orderId||i}>
       {order.orderId||'Unknown order'}: {order.orderVerified?'Verified merchant order':'Not independently verified'} ({order.orderStatus})
     </p>)}
     <p className="text-[#a0a0a0]">{report.notice}</p>
   </div>}
   {error&&<p role="alert" className="text-sm">{error}</p>}
   <p className="text-xs text-[#a0a0a0]">Order history alone does not prove that payment settled or a refund completed.</p>
 </section>
}
