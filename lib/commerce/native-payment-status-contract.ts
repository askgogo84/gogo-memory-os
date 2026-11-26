import {createHash} from 'node:crypto'
import {PurchaseBoundaryError} from './purchase-contract'

export type PaymentReadbackScope = {
  paasId:string
  orderId:string
  purchaseId:string
  attemptId:string
}
export type MerchantPaymentStatus = {
  paasId:string
  orderId?:string
  status:string
  terminal:boolean
  isTerminalSuccess:boolean
  isTerminalFailure:boolean
  confirmed?:boolean
}
export type CheckedPaymentStatus = {
  purchaseId:string;attemptId:string;paasId:string;orderId:string
  status:string;terminal:boolean
  paymentVerified:boolean;orderVerified:boolean;paymentFailed:boolean
  observedAt:string;evidenceSha256:string
}
const valid=(s:unknown):s is string=>typeof s==='string'&&
  s.length>0&&s.length<=200&&/^[A-Za-z0-9:_-]+$/.test(s)
const reject=(why:string):never=>{throw new PurchaseBoundaryError(why)}
/** Validate transaction IDs from first-party checkout, never a model/user claim. */
export function validateMerchantPaymentStatus(
  scope:PaymentReadbackScope,provider:unknown,now=Date.now(),
):CheckedPaymentStatus{
  if(!scope||!valid(scope.paasId)||!valid(scope.orderId)||
    !valid(scope.purchaseId)||!valid(scope.attemptId)||!provider||
    typeof provider!=='object'||!Number.isFinite(now))
    return reject('payment_readback_unverified')
  const raw=provider as Record<string,unknown>
  if(raw.paasId!==scope.paasId||
    (raw.orderId!==undefined&&raw.orderId!==scope.orderId)||
    !valid(raw.status)||typeof raw.terminal!=='boolean'||
    typeof raw.isTerminalSuccess!=='boolean'||
    typeof raw.isTerminalFailure!=='boolean'||
    (raw.confirmed!==undefined&&typeof raw.confirmed!=='boolean')||
    (raw.isTerminalSuccess&&raw.isTerminalFailure)||
    (!raw.terminal&&(raw.isTerminalSuccess||raw.isTerminalFailure||raw.confirmed===true))||
    (raw.terminal&&raw.isTerminalSuccess===raw.isTerminalFailure)||
    (raw.confirmed===true&&raw.isTerminalSuccess!==true))
    return reject('payment_readback_unverified')
  const snapshot={
    purchaseId:scope.purchaseId,attemptId:scope.attemptId,paasId:scope.paasId,
    orderId:scope.orderId,status:raw.status as string,
    terminal:raw.terminal as boolean,
    paymentVerified:raw.terminal===true&&raw.isTerminalSuccess===true,
    orderVerified:raw.terminal===true&&raw.isTerminalSuccess===true&&raw.confirmed===true,
    paymentFailed:raw.terminal===true&&raw.isTerminalFailure===true,
    observedAt:new Date(now).toISOString(),
  }
  return {...snapshot,evidenceSha256:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}
}
export function paymentStatusPublicView(value:CheckedPaymentStatus|null){
  if(!value)return {
    verification:'not_available' as const,paymentVerified:false,orderVerified:false,
    paymentFailed:false,notice:'No authenticated Swiggy payment status is available. Check the merchant app before taking another action.',
  }
  return {
    verification:'swiggy_payment_status_readback' as const,status:value.status,
    observedAt:value.observedAt,paymentVerified:value.paymentVerified,
    orderVerified:value.orderVerified,paymentFailed:value.paymentFailed,
    notice:value.paymentFailed?
      'Swiggy reports a terminal payment failure. Confirm order and refund details in Swiggy before starting a new purchase.':
      value.paymentVerified?
        value.orderVerified?'Swiggy verified payment and reported auto-confirmation. Check order history for fulfillment.':
          'Swiggy verified payment, but final order confirmation is not established. Do not place another order.':
        'Payment is not verified as complete. Do not repeat checkout; check again only after the merchant-specified interval.',
  }
}
