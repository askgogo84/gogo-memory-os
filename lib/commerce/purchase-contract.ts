import {createHash} from 'node:crypto'
import {commerceHandoffUrl} from './evidence'
import type {CommerceTask} from './task'

/**
 * Immutable proposal from an already provider-read-back cart. This is NOT a payment
 * instruction or proof of payment. Never infer a checkout URL from a merchant homepage.
 */
export const PURCHASE_TTL_MS = 5 * 60_000
export const PURCHASE_MAX_PAISE = 5_000_000 // Pilot safety ceiling: INR 50,000
export const PURCHASES_ENABLED = () => process.env.COMMERCE_PURCHASES_ENABLED === 'true'

export class PurchaseBoundaryError extends Error {
  constructor(public code: string) { super(code) }
}

export type PurchaseItem = {spinId: string; skuId: string; quantity: number}
export type PurchaseSnapshot = {
  owner: string; runId: string; provider: 'swiggy'
  cartId: string; addressId: string; items: PurchaseItem[]
  amountPaise: number; currency: 'INR'; checkoutUrl: string | null
  phoneCartVerified: boolean; checkedAt: string; expiresAt: string; sha256: string
}

export const validRunId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

const ident = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 512
const itemKey = (item: PurchaseItem) => JSON.stringify([item.spinId, item.skuId])
export function canonicalItems(value: unknown): PurchaseItem[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new PurchaseBoundaryError('cart_items_unverified')
  const items: PurchaseItem[] = []
  for (const row of value) {
    if (!row || !ident(row.spinId) || !ident(row.skuId) ||
      !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 999) {
      throw new PurchaseBoundaryError('cart_items_unverified')
    }
    items.push({spinId: row.spinId, skuId: row.skuId, quantity: row.quantity})
  }
  if (new Set(items.map(itemKey)).size !== items.length) throw new PurchaseBoundaryError('cart_duplicate_items')
  return items.sort((a, b) => itemKey(a).localeCompare(itemKey(b)))
}

export function snapshotFromVerifiedCart(owner: string, task: CommerceTask, now = Date.now()): PurchaseSnapshot {
  const commerce = task?.metadata_json?.commerce
  const receipt = commerce?.cartReceipt
  const operation = commerce?.cartOperation
  if (!owner || !validRunId(task?.id) || task.type !== 'grocery_comparison' ||
    task.status !== 'paused' || task.metadata_json.state !== 'cart_contents_verified' ||
    commerce?.provider !== 'swiggy' || !receipt || !operation || !operation.verifiedAt) {
    throw new PurchaseBoundaryError('verified_cart_required')
  }
  if (!ident(receipt.cartId) || !ident(receipt.addressId) ||
    receipt.addressId !== commerce?.address?.id || receipt.addressId !== operation.addressId) {
    throw new PurchaseBoundaryError('cart_address_unverified')
  }
  const checkedAt = Date.parse(receipt.checkedAt)
  const verifiedAt = Date.parse(operation.verifiedAt)
  if (!Number.isFinite(now) || !Number.isFinite(checkedAt) || !Number.isFinite(verifiedAt) ||
    checkedAt !== verifiedAt || checkedAt > now || now - checkedAt > PURCHASE_TTL_MS) {
    throw new PurchaseBoundaryError('cart_refresh_required')
  }
  const amount = receipt.payablePaise
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > PURCHASE_MAX_PAISE) {
    throw new PurchaseBoundaryError('delivered_total_unverified_or_limit')
  }
  const actual = canonicalItems(receipt.items)
  const expected = canonicalItems(operation.expected)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new PurchaseBoundaryError('cart_contents_changed')
  if (receipt.providerUrl != null && !commerceHandoffUrl('swiggy', receipt.providerUrl)) {
    throw new PurchaseBoundaryError('unsafe_provider_checkout_url')
  }
  const checkoutUrl = commerceHandoffUrl('swiggy', receipt.providerUrl || null)
  const phoneCartVerified = receipt.phoneVerified === true
  const fields = {
    owner, runId: task.id, provider: 'swiggy' as const, cartId: receipt.cartId as string,
    addressId: receipt.addressId as string, items: actual, amountPaise: amount as number,
    currency: 'INR' as const, checkoutUrl, phoneCartVerified,
    checkedAt: new Date(checkedAt).toISOString(),
  }
  const sha256 = createHash('sha256').update(JSON.stringify(fields)).digest('hex')
  // The customer has at most five minutes from the original provider readback,
  // not five new minutes per browser/endpoint request.
  return {...fields, expiresAt: new Date(checkedAt + PURCHASE_TTL_MS).toISOString(), sha256}
}

export function purchaseState(snapshot: PurchaseSnapshot): 'awaiting_provider_handoff' | 'pending_approval' {
  return snapshot.checkoutUrl && snapshot.phoneCartVerified ? 'pending_approval' : 'awaiting_provider_handoff'
}

export function sameSnapshot(row: Record<string, any>, snapshot: PurchaseSnapshot): boolean {
  return row.owner_telegram_id === snapshot.owner && row.source_run_id === snapshot.runId &&
    row.snapshot_sha256 === snapshot.sha256 && row.provider === snapshot.provider &&
    row.cart_id === snapshot.cartId && row.address_id === snapshot.addressId &&
    row.currency === 'INR' && row.amount_paise === snapshot.amountPaise
}

export function purchaseView(row: Record<string, any>, now = Date.now()) {
  const stale = Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) <= now
  const rawStatus = String(row.status)
  const status = stale && ['pending_approval', 'approved', 'awaiting_provider_handoff'].includes(rawStatus) ? 'expired' : rawStatus
  return {
    purchaseId: row.id,
    sourceRunId: row.source_run_id,
    provider: row.provider,
    state: status,
    totalPaise: row.amount_paise,
    currency: row.currency,
    cartVerified: true,
    phoneCartVerified: row.phone_cart_verified === true,
    checkoutLinkVerified: !!row.checkout_url,
    expiresAt: row.expires_at,
    snapshotSha256: row.snapshot_sha256,
    items: row.items_snapshot,
    // No checkout link before exact explicit approval; no payment credentials ever.
    checkoutUrl: status === 'handoff_opened' ? row.checkout_url : null,
    paymentVerified: false,
    orderPlaced: false,
    notice: status === 'awaiting_provider_handoff'
      ? 'Cart contents were read back, but a provider checkout link or correct phone cart was not verified. Nothing was ordered or charged.'
      : status === 'expired' ? 'The quote expired. Refresh the provider cart and start a new comparison. Nothing was ordered by AskGogo.'
      : status === 'handoff_opened' ? 'Merchant checkout was opened. AskGogo does not know whether you paid or ordered. Verify in the merchant account.'
      : 'No order was placed or charged by AskGogo. Final payment authentication happens only at the merchant.',
  }
}
