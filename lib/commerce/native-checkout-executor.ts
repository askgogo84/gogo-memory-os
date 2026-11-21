import {supabaseAdmin} from '@/lib/supabase-admin'
import {readCommerceConnection} from './connection-store'
import {CommerceMcpClient} from './mcp'
import {assertPurchaseFeatureEnabled,getPurchase} from './purchase-handoff'
import {readNativeInstamartPaymentOptions} from './native-payment-options'
import {
  nativeReviewHash,authorizeNativeCheckoutAttempt,summarizeNativeCheckoutResponse,
  type NativeCheckoutConsent,
} from './native-checkout-contract'
import {PurchaseBoundaryError} from './purchase-contract'

const REVIEWS='commerce_native_checkout_reviews'
const ATTEMPTS='commerce_native_checkout_attempts'
const flag=()=>process.env.COMMERCE_NATIVE_CHECKOUT_ENABLED==='true'
const nowIso=()=>new Date().toISOString()
function enabled(){
  assertPurchaseFeatureEnabled()
  if(!flag()||process.env.COMMERCE_SWIGGY_ENABLED!=='true')
    throw new PurchaseBoundaryError('native_checkout_disabled')
}
async function priorAttempt(owner:string,purchaseId:string){
  const {data,error}=await supabaseAdmin.from(ATTEMPTS).select('*')
    .eq('owner_telegram_id',owner).eq('purchase_id',purchaseId).maybeSingle()
  if(error)throw new PurchaseBoundaryError('purchase_store_unavailable')
  return data
}
/** One short-lived exact-address, exact-cart, exact-method-list review. */
export async function prepareNativeCheckout(owner:string,purchaseId:string){
  enabled()
  if(await priorAttempt(owner,purchaseId)) return {
    state:'outcome_unknown',notice:'An attempt has already been recorded. Check Swiggy orders and payment before doing anything else.',canCheckout:false,
  }
  const purchase=await getPurchase(owner,purchaseId)
  if(!purchase||purchase.provider!=='swiggy'||purchase.status!=='awaiting_provider_handoff')
    throw new PurchaseBoundaryError('native_checkout_purchase_unavailable')
  const quote=await readNativeInstamartPaymentOptions(owner,purchaseId)
  if(quote.agenticEligible!==true)throw new PurchaseBoundaryError('native_agentic_payment_not_allowed')
  const scope={
    owner,purchaseId,cartSha256:purchase.snapshot_sha256 as string,
    addressId:purchase.address_id as string,deliveryAddress:quote.deliveryAddress,
    cartId:purchase.cart_id as string,totalPaise:purchase.amount_paise as number,
    choices:quote.choices,items:quote.cartItems,
  }
  const reviewSha256=nativeReviewHash(scope)
  const expiresAt=new Date(Math.min(Date.parse(purchase.expires_at),
    Date.now()+2*60_000)).toISOString()
  const {data,error}=await supabaseAdmin.from(REVIEWS).insert({
    owner_telegram_id:owner,purchase_id:purchaseId,
    review_sha256:reviewSha256,snapshot_sha256:scope.cartSha256,
    amount_paise:scope.totalPaise,address_sha256:nativeReviewHash({...scope,choices:[]}),
    choices_snapshot:scope.choices,expires_at:expiresAt,
  }).select('id').single()
  if(error||!data)throw new PurchaseBoundaryError('purchase_store_unavailable')
  return {
    state:'review_ready',reviewId:data.id as string,reviewSha256,
    snapshotSha256:scope.cartSha256,
    totalPaise:scope.totalPaise,deliveryAddress:scope.deliveryAddress,
    choices:scope.choices,items:scope.items,expiresAt,canCheckout:true,
    notice:'Checkout will create an order or charge the selected method. This action needs your explicit final confirmation.',
  }
}

/**
 * User-triggered native checkout. Fail closed before outbound call.
 * Insert unique purchase attempt BEFORE first external mutation; never retry
 * a timeout or lost acknowledgement, even if the previous result is unknown.
 */
export async function executeApprovedNativeCheckout(owner:string,purchaseId:string,consent:NativeCheckoutConsent) {
  enabled()
  if(await priorAttempt(owner,purchaseId))throw new PurchaseBoundaryError('native_checkout_already_attempted')
  const {data:review,error:readError}=await supabaseAdmin.from(REVIEWS).select('*')
    .eq('id',consent.reviewId).eq('purchase_id',purchaseId)
    .eq('owner_telegram_id',owner).maybeSingle()
  if(readError||!review)throw new PurchaseBoundaryError('native_checkout_review_unavailable')
  const method=authorizeNativeCheckoutAttempt(review,consent)
  const purchase=await getPurchase(owner,purchaseId)
  if(!purchase||purchase.status!=='awaiting_provider_handoff'||
    purchase.snapshot_sha256!==review.snapshot_sha256||
    purchase.amount_paise!==review.amount_paise||
    Date.parse(purchase.expires_at)<=Date.now()) throw new PurchaseBoundaryError('native_checkout_purchase_changed')
  // Enterprise company requests cannot bypass the independently approved
  // spend/budget path through consumer checkout.
  const {data:corporate,error:corpError}=await supabaseAdmin
    .from('commerce_enterprise_spend_requests').select('id')
    .eq('purchase_id',purchaseId).maybeSingle()
  if(corpError)throw new PurchaseBoundaryError('purchase_store_unavailable')
  if(corporate)throw new PurchaseBoundaryError('enterprise_checkout_requires_separate_execution')
  // Fetch live cart AND available methods again; abort on ANY price, address,
  // basket or method list change. No order mutation has happened yet.
  const latest=await readNativeInstamartPaymentOptions(owner,purchaseId)
  if(latest.agenticEligible!==true)throw new PurchaseBoundaryError('native_agentic_payment_not_allowed')
  const exactHash=nativeReviewHash({
    owner,purchaseId,cartSha256:purchase.snapshot_sha256,
    addressId:purchase.address_id,deliveryAddress:latest.deliveryAddress,
    cartId:purchase.cart_id,totalPaise:purchase.amount_paise,choices:latest.choices,
    items:latest.cartItems,
  })
  if(exactHash!==review.review_sha256)
    throw new PurchaseBoundaryError('native_checkout_review_changed')
  const token=await readCommerceConnection(owner,'swiggy')
  if(!token?.accessToken)throw new PurchaseBoundaryError('provider_auth_required')
  const client=new CommerceMcpClient('swiggy','grocery',token.accessToken)
  // This unique insert is the single-use claim. Conflicting requests never
  // cause a second checkout call, including after a network timeout.
  const {data:attempt,error}=await supabaseAdmin.from(ATTEMPTS).insert({
    owner_telegram_id:owner,purchase_id:purchaseId,review_id:review.id,
    review_sha256:review.review_sha256,snapshot_sha256:purchase.snapshot_sha256,
    payment_mode:method.mode,payment_method_id:method.methodId,
    status:'outcome_unknown',
  }).select('id').single()
  if(error){
    if(error.code==='23505')throw new PurchaseBoundaryError('native_checkout_already_attempted')
    throw new PurchaseBoundaryError('purchase_store_unavailable')
  }
  if(!attempt)throw new PurchaseBoundaryError('purchase_store_unavailable')
  // Atomic status claim against cancellation: if cancellation wins the race
  // no merchant order is sent. If this claim wins, proposal cancellation is
  // disabled and cannot misrepresent a real checkout as "cancelled".
  const {data:claimed,error:claimError}=await supabaseAdmin
    .from('commerce_purchase_intents')
    .update({status:'native_checkout_started',updated_at:nowIso()})
    .eq('id',purchaseId).eq('owner_telegram_id',owner)
    .eq('status','awaiting_provider_handoff')
    .eq('snapshot_sha256',review.snapshot_sha256)
    .gt('expires_at',nowIso()).select('id').maybeSingle()
  if(claimError||!claimed)return {
    attemptId:attempt.id,status:'outcome_unknown',orderVerified:false,
    paymentVerified:false,
    notice:'The purchase proposal changed before checkout. No merchant checkout call was initiated by this request. This one-time claim cannot be reused.',
  }
  try{
    // This is the ONLY outbound order mutation in the system and never retries.
    const provider=await client.placeInstamartCheckout(purchase.address_id,method)
    const response=summarizeNativeCheckoutResponse(provider)
    const {error:storeError}=await supabaseAdmin.from(ATTEMPTS)
      .update({status:'response_received',provider_order_refs:response.orderRefs,
        payment_paas_id:response.paymentReference?.paasId??null,
        payment_order_id:response.paymentReference?.orderId??null,
        payment_poll_interval_ms:response.paymentReference?.pollingIntervalMs??null,
        updated_at:nowIso()}).eq('id',attempt.id).eq('owner_telegram_id',owner)
      .eq('status','outcome_unknown')
    if(storeError)throw new Error('attempt_reconciliation_write_failed')
    return {...response,attemptId:attempt.id,status:'response_received'}
  }catch{
    // The external call may have applied. Never automatically run it again.
    return {attemptId:attempt.id,status:'outcome_unknown',orderVerified:false,
      paymentVerified:false,notice:'The merchant checkout outcome is unknown. Verify orders and payments in Swiggy. AskGogo will not retry this purchase.'}
  }
}
