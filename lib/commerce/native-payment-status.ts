import {supabaseAdmin} from '@/lib/supabase-admin'
import {readCommerceConnection} from './connection-store'
import {CommerceMcpClient} from './mcp'
import {assertPurchaseFeatureEnabled,getPurchase} from './purchase-handoff'
import {commerceEnabled} from './providers'
import {PurchaseBoundaryError} from './purchase-contract'
import {validateMerchantPaymentStatus,paymentStatusPublicView} from './native-payment-status-contract'

const ATTEMPTS='commerce_native_checkout_attempts'
const OBS='commerce_native_payment_readbacks'
const no=()=>{throw new PurchaseBoundaryError('payment_status_not_available')}

/**
 * Explicit customer-origin readback for a saved PaaS transaction. Some Swiggy
 * status reads can auto-confirm a completed UPI order. Never run this from
 * a background agent or on a GET request; user must trigger POST.
 */
export async function checkNativePaymentOnce(owner:string,purchaseId:string){
  assertPurchaseFeatureEnabled()
  if(process.env.COMMERCE_NATIVE_CHECKOUT_ENABLED!=='true'||!commerceEnabled('swiggy'))
    throw new PurchaseBoundaryError('native_checkout_disabled')
  const purchase=await getPurchase(owner,purchaseId)
  if(!purchase||purchase.status!=='native_checkout_started'||purchase.provider!=='swiggy')
    return no()
  const {data:attempt,error}=await supabaseAdmin.from(ATTEMPTS)
    .select('id,payment_paas_id,payment_order_id,payment_last_check_at,payment_poll_interval_ms,created_at,status')
    .eq('owner_telegram_id',owner).eq('purchase_id',purchaseId).maybeSingle()
  if(error)throw new PurchaseBoundaryError('purchase_store_unavailable')
  if(!attempt||attempt.status!=='response_received'||
    typeof attempt.payment_paas_id!=='string'||typeof attempt.payment_order_id!=='string')
    return no()
  const interval=Number(attempt.payment_poll_interval_ms||10000)
  if(!Number.isSafeInteger(interval)||interval<5000||interval>120000)
    return no()
  if(attempt.payment_last_check_at &&
    Date.now()-Date.parse(attempt.payment_last_check_at)<interval)
    throw new PurchaseBoundaryError('payment_check_too_soon')
  // Compare-and-swap is the poll cadence lease. A parallel request cannot
  // invoke the same provider status read before the minimum interval.
  const now=new Date().toISOString()
  let update=supabaseAdmin.from(ATTEMPTS)
    .update({payment_last_check_at:now,updated_at:now})
    .eq('id',attempt.id).eq('owner_telegram_id',owner)
    .eq('purchase_id',purchaseId).eq('status','response_received')
  update=attempt.payment_last_check_at
    ? update.eq('payment_last_check_at',attempt.payment_last_check_at)
    : update.is('payment_last_check_at',null)
  const {data:claimed,error:claimError}=await update.select('id').maybeSingle()
  if(claimError)throw new PurchaseBoundaryError('purchase_store_unavailable')
  if(!claimed)throw new PurchaseBoundaryError('payment_check_in_progress')
  const token=await readCommerceConnection(owner,'swiggy')
  if(!token?.accessToken)throw new PurchaseBoundaryError('provider_auth_required')
  const client=new CommerceMcpClient('swiggy','grocery',token.accessToken)
  let response:unknown
  try{
    response=await client.readTool('check_payment_status',{
      paasId:attempt.payment_paas_id,orderId:attempt.payment_order_id,
    })
  }catch{throw new PurchaseBoundaryError('payment_readback_unavailable')}
  const verified=validateMerchantPaymentStatus({
    paasId:attempt.payment_paas_id,orderId:attempt.payment_order_id,
    purchaseId,attemptId:attempt.id,
  },response)
  const {error:storeError}=await supabaseAdmin.from(OBS).insert({
    owner_telegram_id:owner,purchase_id:purchaseId,attempt_id:attempt.id,
    paas_id:verified.paasId,order_id:verified.orderId,
    evidence_sha256:verified.evidenceSha256,
    status:verified.status,terminal:verified.terminal,
    payment_verified:verified.paymentVerified,
    order_verified:verified.orderVerified,payment_failed:verified.paymentFailed,
    observed_at:verified.observedAt,
  })
  if(storeError && storeError.code!=='23505')
    throw new PurchaseBoundaryError('purchase_store_unavailable')
  return paymentStatusPublicView(verified)
}
