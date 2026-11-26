import {supabaseAdmin} from '@/lib/supabase-admin'
import {readCommerceConnection} from './connection-store'
import {CommerceMcpClient} from './mcp'
import {getPurchase,assertPurchaseFeatureEnabled} from './purchase-handoff'
import {commerceEnabled} from './providers'
import {PurchaseBoundaryError} from './purchase-contract'

const ATTEMPTS='commerce_native_checkout_attempts'
const OBS='commerce_native_payment_readbacks'
const deny=(reason:string):never=>{throw new PurchaseBoundaryError(reason)}

/**
 * One and only one user-triggered confirmation after independently verified
 * UPI terminal success from the original Swiggy paasId/orderId pair. Never
 * retries or assumes success from a transport acknowledgement.
 */
export async function confirmNativePaidOrderOnce(owner:string,purchaseId:string){
 assertPurchaseFeatureEnabled()
 if(process.env.COMMERCE_NATIVE_CONFIRMATION_ENABLED!=='true'||
    process.env.COMMERCE_NATIVE_CHECKOUT_ENABLED!=='true'||!commerceEnabled('swiggy'))
    return deny('native_confirmation_disabled')
 const purchase=await getPurchase(owner,purchaseId)
 if(!purchase||purchase.provider!=='swiggy'||purchase.status!=='native_checkout_started')
    return deny('purchase_not_ready')
 const {data:attempt,error}=await supabaseAdmin.from(ATTEMPTS)
  .select('id,payment_paas_id,payment_order_id,confirmation_claimed_at,status')
  .eq('owner_telegram_id',owner).eq('purchase_id',purchaseId).maybeSingle()
 if(error) return deny('purchase_store_unavailable')
 if(!attempt||attempt.status!=='response_received'||attempt.confirmation_claimed_at||
    typeof attempt.payment_paas_id!=='string'||typeof attempt.payment_order_id!=='string')
    return deny('native_confirmation_not_ready')
 const {data:proof,error:proofError}=await supabaseAdmin.from(OBS)
  .select('paas_id,order_id,terminal,payment_verified,order_verified,payment_failed,observed_at')
  .eq('owner_telegram_id',owner).eq('attempt_id',attempt.id)
  .eq('purchase_id',purchaseId)
  .order('observed_at',{ascending:false}).limit(1).maybeSingle()
 if(proofError) return deny('purchase_store_unavailable')
 if(!proof||proof.paas_id!==attempt.payment_paas_id||
    proof.order_id!==attempt.payment_order_id||proof.terminal!==true||
    proof.payment_verified!==true||proof.order_verified===true||
    proof.payment_failed===true||!Number.isFinite(Date.parse(proof.observed_at))||
    Date.now()-Date.parse(proof.observed_at)>120000)
    return deny('native_confirmation_payment_not_verified')
 const token=await readCommerceConnection(owner,'swiggy')
 if(!token?.accessToken)return deny('provider_auth_required')
 const client=new CommerceMcpClient('swiggy','grocery',token.accessToken)
 // Merchant history may already have auto-confirmed asynchronously.
 // If so, never call confirm_order again.
 const existing=await client.readTool('get_orders',{count:20,orderType:'INSTAMART',activeOnly:false})
 if(!existing||!Array.isArray(existing.orders))return deny('native_confirmation_order_readback_required')
 if(existing.orders.some((row:any)=>row?.orderId===attempt.payment_order_id&&
      row?.deliveryAddress?.id===purchase.address_id&&
      ['PLACED','DELIVERED','ON_THE_WAY','OUT_FOR_DELIVERY'].includes(String(row.status).toUpperCase()))){
   return {status:'already_in_merchant_history',orderVerified:true,
     notice:'Swiggy already shows this order for the selected address; no additional confirmation was sent.'}
 }
 // Pre-claim before the irreversible merchant confirmation.
 const now=new Date().toISOString()
 const {data:claim,error:claimError}=await supabaseAdmin.from(ATTEMPTS)
  .update({confirmation_claimed_at:now,updated_at:now})
  .eq('id',attempt.id).eq('owner_telegram_id',owner)
  .eq('purchase_id',purchaseId).is('confirmation_claimed_at',null)
  .select('id').maybeSingle()
 if(claimError)return deny('purchase_store_unavailable')
 if(!claim)return deny('native_confirmation_already_attempted')
 try{
   const response=await client.confirmInstamartPaidOrder(attempt.payment_order_id,attempt.payment_paas_id)
   const code=typeof response.status==='string'?response.status.slice(0,100):'UNKNOWN'
   await supabaseAdmin.from(ATTEMPTS).update({
      confirmation_result_status:code,confirmation_finished_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),
   }).eq('id',attempt.id).eq('owner_telegram_id',owner).eq('purchase_id',purchaseId)
   return {status:'confirmation_response_received',orderVerified:false,
      notice:'Swiggy responded to the one-time confirmation. Verify the final order state in Swiggy order history; no second confirmation will be sent.'}
 }catch{
   return {status:'confirmation_outcome_unknown',orderVerified:false,
      notice:'Order confirmation may have succeeded. Do not retry; check Swiggy order history and contact support if needed.'}
 }
}
