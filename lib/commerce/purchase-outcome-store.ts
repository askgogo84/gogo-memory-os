import {supabaseAdmin} from '@/lib/supabase-admin'
import {getPurchase, assertPurchaseFeatureEnabled} from './purchase-handoff'
import {MerchantOrderReadback, validateMerchantOrderReadback, merchantOutcomeView} from './purchase-outcome'
import {PurchaseBoundaryError} from './purchase-contract'

const TABLE = 'commerce_purchase_outcome_readbacks'

/**
 * Internal trust boundary: call ONLY from authenticated merchant provider adapter
 * after an independent same-account order readback. Never expose this function
 * through a customer-controlled POST or call it using LLM/customer text.
 */
export async function persistAuthenticatedMerchantOutcome(
  owner: string, purchaseId: string, merchantReadback: MerchantOrderReadback,
) {
  assertPurchaseFeatureEnabled()
  const purchase = await getPurchase(owner, purchaseId)
  if (!purchase) throw new PurchaseBoundaryError('purchase_not_found')
  const proof = validateMerchantOrderReadback(purchase, merchantReadback)
  const row = {
    purchase_id: purchase.id,
    owner_telegram_id: owner,
    provider: proof.provider,
    cart_id: proof.cartId,
    evidence_ref: proof.evidenceRef,
    evidence_sha256: proof.evidenceSha256,
    merchant_order_id: proof.orderId,
    merchant_payment_id: proof.paymentId,
    merchant_refund_id: proof.refundId,
    order_status: proof.orderStatus,
    payment_status: proof.paymentStatus,
    gross_paid_paise: proof.grossPaidPaise,
    refunded_paise: proof.refundedPaise,
    observed_at: proof.observedAt,
  }
  const {data,error} = await supabaseAdmin.from(TABLE).insert(row).select('*').single()
  if (!error) return merchantOutcomeView(data)
  if (error.code !== '23505') throw new PurchaseBoundaryError('purchase_store_unavailable')
  const {data:previous,error:lookupError} = await supabaseAdmin.from(TABLE)
    .select('*').eq('provider',proof.provider).eq('evidence_ref',proof.evidenceRef).maybeSingle()
  if (lookupError || !previous) throw new PurchaseBoundaryError('purchase_store_unavailable')
  if (previous.owner_telegram_id !== owner || previous.purchase_id !== purchase.id ||
      previous.evidence_sha256 !== proof.evidenceSha256) {
    throw new PurchaseBoundaryError('merchant_evidence_replay_conflict')
  }
  return merchantOutcomeView(previous)
}

export async function readVerifiedMerchantOutcome(owner: string, purchaseId: string) {
  assertPurchaseFeatureEnabled()
  const purchase = await getPurchase(owner, purchaseId)
  if (!purchase) throw new PurchaseBoundaryError('purchase_not_found')
  const {data,error} = await supabaseAdmin.from(TABLE).select('*')
    .eq('purchase_id',purchase.id).eq('owner_telegram_id',owner)
    .order('observed_at',{ascending:false}).order('created_at',{ascending:false})
    .limit(1).maybeSingle()
  if (error) throw new PurchaseBoundaryError('purchase_store_unavailable')
  return merchantOutcomeView(data)
}
