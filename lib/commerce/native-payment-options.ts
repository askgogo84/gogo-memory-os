import {readCommerceConnection} from './connection-store'
import {CommerceMcpClient} from './mcp'
import {commerceEnabled} from './providers'
import {readCommerceTask} from './task'
import {canonicalItems, PurchaseBoundaryError, sameSnapshot, snapshotFromVerifiedCart} from './purchase-contract'
import {getPurchase, assertPurchaseFeatureEnabled} from './purchase-handoff'
import {explicitInrPaise} from './swiggy-read'
import {verifiedInstamartPaymentChoices} from './native-payment-contract'

/**
 * Reads LIVE payment options for the exact owner + authenticated merchant cart.
 * Does not save a preferred payment method, launch UPI or call checkout.
 * Returns no OAuth tokens, card identifiers, delivery-address text or VPA.
 */
export async function readNativeInstamartPaymentOptions(owner:string,purchaseId:string) {
  assertPurchaseFeatureEnabled()
  if(!commerceEnabled('swiggy')) throw new PurchaseBoundaryError('provider_approval_required')
  const purchase=await getPurchase(owner,purchaseId)
  if(!purchase || purchase.provider!=='swiggy' || !['awaiting_provider_handoff','pending_approval'].includes(purchase.status))
    throw new PurchaseBoundaryError('purchase_not_ready')
  if(Date.parse(purchase.expires_at)<=Date.now()) throw new PurchaseBoundaryError('purchase_expired')
  const task=await readCommerceTask(owner,purchase.source_run_id)
  if(!task) throw new PurchaseBoundaryError('commerce_task_changed')
  const snapshot=snapshotFromVerifiedCart(owner,task)
  if(!sameSnapshot(purchase,snapshot)) throw new PurchaseBoundaryError('purchase_snapshot_changed_new_task_required')
  const token=await readCommerceConnection(owner,'swiggy')
  if(!token?.accessToken) throw new PurchaseBoundaryError('provider_auth_required')
  const client=new CommerceMcpClient('swiggy','grocery',token.accessToken)
  // Compare live readback again: earlier cart evidence alone cannot authorize
  // payment-method display against an unknown or modified current basket.
  const cart=await client.readTool('get_cart',{})
  if(cart?.cartId!==purchase.cart_id || cart?.selectedAddressDetails?.id!==purchase.address_id ||
      !Array.isArray(cart.items) || cart.items.length>100 ||
      cart.items.some((item:any)=>item.isInStockAndAvailable!==true)) {
    throw new PurchaseBoundaryError('cart_refresh_required')
  }
  const liveItems=canonicalItems(cart.items.map((x:any)=>({spinId:x.spinId,skuId:x.skuId,quantity:x.quantity})))
  if(JSON.stringify(liveItems)!==JSON.stringify(canonicalItems(purchase.items_snapshot)))
    throw new PurchaseBoundaryError('cart_contents_changed')
  const payable=explicitInrPaise(cart.billBreakdown?.toPay?.value)
  const cartTotal=explicitInrPaise(cart.cartTotalAmount)
  if(payable===null || cartTotal!==payable || payable!==purchase.amount_paise)
    throw new PurchaseBoundaryError('delivered_total_unverified_or_limit')
  const options=verifiedInstamartPaymentChoices(await client.readTool('get_payment_options',{}))
  return {
    provider:'swiggy' as const,
    snapshotSha256:purchase.snapshot_sha256 as string,
    totalPaise:purchase.amount_paise as number,
    checkedAt:new Date().toISOString(),
    ...options,
    checkoutEnabled:false,
    notice:'Read-only payment choices returned by Swiggy. Selecting a method or making a payment is not enabled. Verify your merchant cart before paying.',
  }
}
