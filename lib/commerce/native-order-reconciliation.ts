import {supabaseAdmin} from '@/lib/supabase-admin'
import {assertPurchaseFeatureEnabled,getPurchase} from './purchase-handoff'
import {readCommerceConnection} from './connection-store'
import {CommerceMcpClient} from './mcp'
import {commerceEnabled} from './providers'
import {reconcileNativeMerchantOrders,type NativeAttemptRef,type MerchantHistoryOrder} from './native-order-reconciliation-contract'
import {PurchaseBoundaryError} from './purchase-contract'

/** Read-only merchant-side reconciliation of one unique checkout attempt. */
export async function readNativeMerchantOrders(owner:string,purchaseId:string){
  assertPurchaseFeatureEnabled()
  const purchase=await getPurchase(owner,purchaseId)
  if(!purchase||purchase.provider!=='swiggy')throw new PurchaseBoundaryError('purchase_not_found')
  const {data:attempt,error}=await supabaseAdmin.from('commerce_native_checkout_attempts')
    .select('id,status,provider_order_refs,created_at').eq('purchase_id',purchaseId)
    .eq('owner_telegram_id',owner).maybeSingle()
  if(error)throw new PurchaseBoundaryError('purchase_store_unavailable')
  if(!attempt)return {
    status:'not_attempted',orders:[],anyVerified:false,allVerified:false,partial:false,
    paymentVerified:false,refundVerified:false,
    notice:'AskGogo has no native checkout attempt for this purchase.',
  }
  if(!Array.isArray(attempt.provider_order_refs)||!attempt.provider_order_refs.length)return {
    status:'outcome_unknown',orders:[],anyVerified:false,allVerified:false,partial:false,
    paymentVerified:false,refundVerified:false,
    notice:'The checkout outcome or merchant order identifiers are unknown. Check Swiggy order history and payment records manually before trying anything else.',
  }
  if(!commerceEnabled('swiggy'))throw new PurchaseBoundaryError('provider_approval_required')
  const token=await readCommerceConnection(owner,'swiggy')
  if(!token?.accessToken)throw new PurchaseBoundaryError('provider_auth_required')
  const client=new CommerceMcpClient('swiggy','grocery',token.accessToken)
  const read=await client.readTool('get_orders',{count:20,orderType:'INSTAMART',activeOnly:false})
  if(!read||!Array.isArray(read.orders))throw new PurchaseBoundaryError('order_readback_unavailable')
  const result=reconcileNativeMerchantOrders(
    attempt.provider_order_refs as NativeAttemptRef[],
    read.orders as MerchantHistoryOrder[],
    purchase.address_id,
  )
  return {status:'merchant_history_checked',checkedAt:new Date().toISOString(),...result}
}
