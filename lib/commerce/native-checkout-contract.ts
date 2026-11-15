import {createHash} from 'node:crypto'
import {PurchaseBoundaryError} from './purchase-contract'
import type {NativePaymentChoice} from './native-payment-contract'

const fail=(code:string):never=>{throw new PurchaseBoundaryError(code)}
const sha=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)
const id=(s:unknown)=>typeof s==='string'&&s.length>0&&s.length<=200
export type NativeReviewScope={
  owner:string;purchaseId:string;cartSha256:string
  addressId:string;deliveryAddress:string;cartId:string
  totalPaise:number;choices:NativePaymentChoice[]
}
export function nativeReviewHash(scope:NativeReviewScope) {
  if(!id(scope.owner)||!id(scope.purchaseId)||!sha(scope.cartSha256)||
    !id(scope.addressId)||!id(scope.cartId)||
    !id(scope.deliveryAddress)||!Array.isArray(scope.choices)||scope.choices.length>40||
    !Number.isSafeInteger(scope.totalPaise)||scope.totalPaise<=0||
    scope.totalPaise>5000000) return fail('native_checkout_review_invalid')
  const choices=scope.choices.map(x=>({
    mode:x.mode,methodId:x.methodId,label:x.label,
  })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if(choices.some(c=>!id(c.methodId)||!id(c.label)||
    !['upi_intent','upi_qr','cash_on_delivery','swiggy_money'].includes(c.mode))||
    new Set(choices.map(c=>c.mode+':'+c.methodId)).size!==choices.length)
    return fail('native_checkout_review_invalid')
  return createHash('sha256').update(JSON.stringify({
    owner:scope.owner,purchaseId:scope.purchaseId,cartSha256:scope.cartSha256,
    addressId:scope.addressId,deliveryAddress:scope.deliveryAddress,
    cartId:scope.cartId,totalPaise:scope.totalPaise,choices,
  })).digest('hex')
}
export type NativeCheckoutConsent={
  reviewId:unknown;reviewSha256:unknown;snapshotSha256:unknown
  totalPaise:unknown;methodId:unknown;mode:unknown
  acknowledge:unknown;addressAccepted:unknown
}
export function authorizeNativeCheckoutAttempt(
  review:{id:string;review_sha256:string;snapshot_sha256:string;amount_paise:number;
    choices_snapshot:NativePaymentChoice[];expires_at:string},
  consent:NativeCheckoutConsent, now=Date.now(),
):NativePaymentChoice {
  if(!review||!consent||consent.reviewId!==review.id||
    consent.reviewSha256!==review.review_sha256 ||
    consent.snapshotSha256!==review.snapshot_sha256 ||
    consent.totalPaise!==review.amount_paise ||
    consent.acknowledge!==true || consent.addressAccepted!==true||
    !id(consent.methodId)||typeof consent.mode!=='string'||
    !Number.isFinite(now)||Date.parse(review.expires_at)<=now ||
    !Array.isArray(review.choices_snapshot)) return fail('native_checkout_approval_mismatch')
  const chosen=review.choices_snapshot.find(x=>
    x.methodId===consent.methodId&&x.mode===consent.mode)
  if(!chosen) return fail('native_checkout_method_changed')
  // Only the exact previously returned merchant method can be selected.
  return chosen
}
export function summarizeNativeCheckoutResponse(data:Record<string,unknown>){
  const scalar=(x:unknown)=>typeof x==='string'&&x.length<=200&&
    /^[A-Za-z0-9:_-]+$/.test(x)?x:null
  const refs:Array<{orderId:string|null;status:string|null;error:string|null}>=[]
  const list=Array.isArray(data.orders)?data.orders.slice(0,20):[data]
  for(const row of list){
    if(!row || typeof row!=='object')continue
    const x=row as Record<string,unknown>
    refs.push({orderId:scalar(x.orderId),status:scalar(x.status),error:scalar(x.error)})
  }
  const pending=data.status==='PENDING_PAYMENT'
  return {
    orderRefs:refs,paymentPending:pending,
    // A checkout transport response is not independently verified order/payment evidence.
    orderVerified:false as const,paymentVerified:false as const,
    notice:pending
      ? 'The merchant created a pending-payment attempt. Complete payment in the merchant app and verify the order there. Do not submit checkout again.'
      : 'Merchant checkout replied. Order and payment are not independently verified. Check the merchant app before any further attempt.',
  }
}
