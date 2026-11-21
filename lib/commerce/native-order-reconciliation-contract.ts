import {PurchaseBoundaryError} from './purchase-contract'
export type MerchantHistoryOrder={
  orderId:string;status:string;deliveryAddress?:{id?:string};
  paymentStatus?:string;refundStatus?:string;createdAt?:string
}
export type NativeAttemptRef={orderId:string|null;status:string|null;error:string|null}
/**
 * Merchant history is a SECOND authenticated readback of exact checkout ids.
 * Never infer an order from a matching total or items; merchant totals have
 * unspecified display units and may be split across several stores.
 */
export function reconcileNativeMerchantOrders(
 refs:NativeAttemptRef[],history:MerchantHistoryOrder[],addressId:string,
) {
 if(!Array.isArray(refs)||refs.length<1||refs.length>20||
   !Array.isArray(history)||history.length>40||
   typeof addressId!=='string'||!addressId)throw new PurchaseBoundaryError('order_readback_unavailable')
 const safe=(s:unknown)=>typeof s==='string'&&s.length>0&&s.length<=200
 const statuses=new Set(['PLACED','DELIVERED','OUT_FOR_DELIVERY','ON_THE_WAY'])
 const report=refs.map(ref=>{
   const id=safe(ref.orderId)?ref.orderId:null
   const candidates=id?history.filter(order=>order.orderId===id):[]
   // If duplicates or changed addresses are present, fail closed.
   const item=candidates.length===1&&candidates[0]?.deliveryAddress?.id===addressId?candidates[0]:null
   const status=item&&safe(item.status)?item.status:'UNKNOWN'
   return {
     orderId:id,orderStatus:status,orderVerified:item!==null&&statuses.has(status.toUpperCase()),
     paymentVerified:false as const, refundVerified:false as const,
     // Issuer payment-status proof / amount and paymentId binding are separate.
     paymentStatus:item&&safe(item.paymentStatus)?item.paymentStatus:'UNKNOWN',
     refundStatus:item&&safe(item.refundStatus)?item.refundStatus:'UNKNOWN',
     source:item?'authenticated_merchant_order_history' as const:'not_verified' as const,
   }
 })
 return {
   orders:report,anyVerified:report.some(x=>x.orderVerified),
   allVerified:report.length>0&&report.every(x=>x.orderVerified),
   partial:report.some(x=>x.orderVerified)&&report.some(x=>!x.orderVerified),
   paymentVerified:false as const,refundVerified:false as const,
   notice:'Only order IDs found in this authenticated merchant account at the exact saved delivery address are verified. Payment/refund confirmation still requires independent provider evidence. Missing orders are unknown, not failed.',
 }
}
