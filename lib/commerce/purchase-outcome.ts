import {createHash} from 'node:crypto'
import {PurchaseBoundaryError} from './purchase-contract'

/**
 * Contract for an AUTHENTICATED, SERVER-SIDE merchant order readback.
 * This is not a public webhook payload or customer-submitted confirmation.
 * Only an allowlisted merchant adapter with verified account/cart binding may call
 * the persistence service. Never interpret checkout-link release as an order.
 */
export type MerchantOrderReadback = {
  source: 'authenticated_merchant_order_readback'
  provider: 'swiggy' | 'zepto'
  purchaseId: string
  cartId: string
  accountScopeVerified: true
  observedAt: string
  evidenceRef: string
  orderId: string | null
  paymentId: string | null
  refundId: string | null
  orderStatus: 'not_reported' | 'pending' | 'placed' | 'delivered' | 'cancelled'
  paymentStatus: 'not_reported' | 'pending' | 'failed' | 'captured' | 'partially_refunded' | 'refunded'
  grossPaidPaise: number | null
  refundedPaise: number
  currency: 'INR'
}

export type PurchaseForReconciliation = {
  id: string
  owner_telegram_id: string
  provider: string
  cart_id: string
  amount_paise: number
  currency: string
  status: string
  approved_at: string | null
  handoff_released_at: string | null
}

const ref = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= 160 && /^[A-Za-z0-9_.:\/-]+$/.test(v)
const paise = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 5_000_000
const orderStates = new Set(['not_reported','pending','placed','delivered','cancelled'])
const paymentStates = new Set(['not_reported','pending','failed','captured','partially_refunded','refunded'])
const reject = () => { throw new PurchaseBoundaryError('merchant_evidence_unverified') }

export function validateMerchantOrderReadback(
  purchase: PurchaseForReconciliation,
  input: MerchantOrderReadback,
  now = Date.now(),
) {
  if (!purchase || purchase.status !== 'handoff_released' ||
      !purchase.approved_at || !purchase.handoff_released_at ||
      !paise(purchase.amount_paise) || purchase.amount_paise === 0 ||
      purchase.currency !== 'INR' || !input ||
      input.source !== 'authenticated_merchant_order_readback' ||
      input.accountScopeVerified !== true ||
      input.purchaseId !== purchase.id || input.provider !== purchase.provider ||
      input.cartId !== purchase.cart_id || input.currency !== 'INR' ||
      !ref(input.evidenceRef) ||
      !orderStates.has(input.orderStatus) || !paymentStates.has(input.paymentStatus)) reject()
  const observed = Date.parse(input.observedAt)
  const handoff = Date.parse(purchase.handoff_released_at)
  if (!Number.isFinite(now) || !Number.isFinite(observed) || !Number.isFinite(handoff) ||
      observed > now + 30_000 || observed < handoff - 30_000 ||
      now - observed > 24 * 60 * 60_000) reject()
  for (const value of [input.orderId, input.paymentId, input.refundId]) {
    if (value !== null && !ref(value)) reject()
  }
  if (!paise(input.refundedPaise) || input.refundedPaise > purchase.amount_paise) reject()
  const hasOrder = ['placed','delivered','cancelled'].includes(input.orderStatus)
  const hasPayment = ['captured','partially_refunded','refunded'].includes(input.paymentStatus)
  if (hasOrder && !input.orderId) reject()
  if (!hasPayment && (input.grossPaidPaise !== null || input.refundedPaise !== 0 || input.refundId !== null)) reject()
  if (hasPayment && (!input.paymentId || input.grossPaidPaise !== purchase.amount_paise)) reject()
  if (input.paymentStatus === 'captured' && (input.refundedPaise !== 0 || input.refundId !== null)) reject()
  if (input.paymentStatus === 'partially_refunded' &&
      (!input.refundId || input.refundedPaise <= 0 || input.refundedPaise >= purchase.amount_paise)) reject()
  if (input.paymentStatus === 'refunded' &&
      (!input.refundId || input.refundedPaise !== purchase.amount_paise)) reject()
  if (['not_reported','pending'].includes(input.orderStatus) && input.orderId !== null) reject()
  const evidence = {
    purchaseId: purchase.id,
    provider: input.provider,
    cartId: input.cartId,
    evidenceRef: input.evidenceRef,
    orderId: input.orderId,
    paymentId: input.paymentId,
    refundId: input.refundId,
    orderStatus: input.orderStatus,
    paymentStatus: input.paymentStatus,
    grossPaidPaise: input.grossPaidPaise,
    refundedPaise: input.refundedPaise,
    observedAt: new Date(observed).toISOString(),
  }
  return {...evidence, evidenceSha256: createHash('sha256').update(JSON.stringify(evidence)).digest('hex')}
}

export function merchantOutcomeView(row: Record<string, any> | null) {
  if (!row) return {
    verification: 'not_available' as const,
    orderVerified: false, paymentVerified: false, refundVerified: false,
    message: 'No independently verified merchant order or payment receipt is available. Check your merchant account before placing another order.',
  }
  const orderVerified = row.order_status === 'placed' || row.order_status === 'delivered'
  const paymentVerified = ['captured','partially_refunded','refunded'].includes(row.payment_status)
  const refundVerified = ['partially_refunded','refunded'].includes(row.payment_status)
  return {
    verification: 'authenticated_merchant_readback' as const,
    orderVerified, paymentVerified, refundVerified,
    orderStatus: row.order_status as string,
    paymentStatus: row.payment_status as string,
    orderId: row.order_id as string | null,
    observedAt: row.observed_at as string,
    message: 'Merchant status comes from authenticated server-side readback, not a checkout link or a user assertion. Recheck the merchant account if status changes.',
  }
}
