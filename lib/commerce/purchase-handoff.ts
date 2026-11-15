import {supabaseAdmin} from '@/lib/supabase-admin'
import {readCommerceTask} from './task'
import {commerceEnabled} from './providers'
import {
  PURCHASES_ENABLED, PurchaseBoundaryError, validRunId,
  purchaseState, purchaseView, sameSnapshot, snapshotFromVerifiedCart,
} from './purchase-contract'

const TABLE = 'commerce_purchase_intents'
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Row = Record<string, any>

export function assertPurchaseFeatureEnabled() {
  if (!PURCHASES_ENABLED()) throw new PurchaseBoundaryError('purchase_feature_disabled')
}

/** Service-role-only, owner-scoped read. No merchant credentials or card details returned. */
export async function getPurchase(owner: string, id: string): Promise<Row | null> {
  if (!owner || !ID.test(id)) return null
  const {data, error} = await supabaseAdmin.from(TABLE)
    .select('*').eq('id', id).eq('owner_telegram_id', owner).maybeSingle()
  if (error) throw new PurchaseBoundaryError('purchase_store_unavailable')
  return data as Row | null
}

export async function createPurchase(owner: string, runId: string) {
  assertPurchaseFeatureEnabled()
  if (!validRunId(runId)) throw new PurchaseBoundaryError('invalid_commerce_task')
  if (!commerceEnabled('swiggy')) throw new PurchaseBoundaryError('provider_approval_required')
  const task = await readCommerceTask(owner, runId)
  if (!task) throw new PurchaseBoundaryError('verified_cart_required')
  const snapshot = snapshotFromVerifiedCart(owner, task)
  // Fail closed on changed carts, or an earlier approval with the same task.
  const {data: existing, error: readError} = await supabaseAdmin.from(TABLE)
    .select('*').eq('owner_telegram_id', owner).eq('source_run_id', runId).maybeSingle()
  if (readError) throw new PurchaseBoundaryError('purchase_store_unavailable')
  if (existing) {
    if (!sameSnapshot(existing, snapshot)) throw new PurchaseBoundaryError('purchase_snapshot_changed_new_task_required')
    return purchaseView(existing)
  }
  const {data, error} = await supabaseAdmin.from(TABLE).insert({
    owner_telegram_id: owner, source_run_id: runId,
    provider: snapshot.provider, cart_id: snapshot.cartId,
    address_id: snapshot.addressId, items_snapshot: snapshot.items,
    snapshot_sha256: snapshot.sha256, amount_paise: snapshot.amountPaise,
    currency: 'INR', checkout_url: snapshot.checkoutUrl,
    phone_cart_verified: snapshot.phoneCartVerified,
    status: purchaseState(snapshot), expires_at: snapshot.expiresAt,
  }).select('*').single()
  if (error) {
    // Only a duplicate owner+run intent may be read back. Other failures are not success.
    if (error.code !== '23505') throw new PurchaseBoundaryError('purchase_store_unavailable')
    const {data: concurrent, error: concurrentError} = await supabaseAdmin.from(TABLE)
      .select('*').eq('owner_telegram_id', owner).eq('source_run_id', runId).maybeSingle()
    if (concurrentError || !concurrent) throw new PurchaseBoundaryError('purchase_store_unavailable')
    if (!sameSnapshot(concurrent, snapshot)) throw new PurchaseBoundaryError('purchase_snapshot_changed_new_task_required')
    return purchaseView(concurrent)
  }
  return purchaseView(data)
}

export async function readPurchaseView(owner: string, id: string) {
  assertPurchaseFeatureEnabled()
  const row = await getPurchase(owner, id)
  if (!row) throw new PurchaseBoundaryError('purchase_not_found')
  return purchaseView(row)
}

/** Approval is exact-amount + exact-snapshot + one-time. This cannot charge anything. */
export async function approvePurchase(owner: string, id: string, input: Record<string, unknown>) {
  assertPurchaseFeatureEnabled()
  const row = await getPurchase(owner, id)
  if (!row) throw new PurchaseBoundaryError('purchase_not_found')
  if (row.status !== 'pending_approval') throw new PurchaseBoundaryError('purchase_not_ready')
  if (input.acknowledge !== true ||
    input.snapshotSha256 !== row.snapshot_sha256 ||
    input.totalPaise !== row.amount_paise ||
    input.merchant !== row.provider) throw new PurchaseBoundaryError('approval_snapshot_mismatch')
  if (!row.checkout_url || !row.phone_cart_verified) throw new PurchaseBoundaryError('provider_checkout_unverified')
  if (Date.parse(row.expires_at) <= Date.now()) throw new PurchaseBoundaryError('purchase_expired')
  const task = await readCommerceTask(owner, row.source_run_id)
  if (!task) throw new PurchaseBoundaryError('commerce_task_changed')
  const latest = snapshotFromVerifiedCart(owner, task)
  if (!sameSnapshot(row, latest) || latest.checkoutUrl !== row.checkout_url ||
    latest.phoneCartVerified !== true) throw new PurchaseBoundaryError('purchase_snapshot_changed_new_task_required')

  // Compare-and-swap: a concurrent approval cannot turn a second request into an
  // independent payment attempt. The approval grants only a browser handoff.
  const {data, error} = await supabaseAdmin.from(TABLE)
    .update({status: 'approved', approved_at: new Date().toISOString(), updated_at: new Date().toISOString()})
    .eq('owner_telegram_id', owner).eq('id', id).eq('status', 'pending_approval')
    .eq('snapshot_sha256', latest.sha256).gt('expires_at', new Date().toISOString())
    .select('*').maybeSingle()
  if (error) throw new PurchaseBoundaryError('purchase_store_unavailable')
  if (!data) throw new PurchaseBoundaryError('purchase_state_changed')
  return purchaseView(data)
}

/** Explicit user action, never called from an agent background loop. Records handoff,
 * NOT payment, order placement or merchant acceptance. */
export async function openPurchaseHandoff(owner: string, id: string, sha256: unknown) {
  assertPurchaseFeatureEnabled()
  const row = await getPurchase(owner, id)
  if (!row) throw new PurchaseBoundaryError('purchase_not_found')
  if (sha256 !== row.snapshot_sha256) throw new PurchaseBoundaryError('approval_snapshot_mismatch')
  if (!['approved', 'handoff_opened'].includes(row.status) || !row.checkout_url || !row.phone_cart_verified) {
    throw new PurchaseBoundaryError('purchase_not_approved')
  }
  if (Date.parse(row.expires_at) <= Date.now()) throw new PurchaseBoundaryError('purchase_expired')
  const task = await readCommerceTask(owner, row.source_run_id)
  if (!task) throw new PurchaseBoundaryError('commerce_task_changed')
  const latest = snapshotFromVerifiedCart(owner, task)
  if (!sameSnapshot(row, latest) || latest.checkoutUrl !== row.checkout_url || latest.phoneCartVerified !== true) {
    throw new PurchaseBoundaryError('purchase_snapshot_changed_new_task_required')
  }
  if (row.status === 'handoff_opened') return {checkoutUrl: row.checkout_url, ...purchaseView(row)}
  const {data, error} = await supabaseAdmin.from(TABLE)
    .update({status: 'handoff_opened', handoff_opened_at: new Date().toISOString(), updated_at: new Date().toISOString()})
    .eq('owner_telegram_id', owner).eq('id', id).eq('status', 'approved')
    .eq('snapshot_sha256', latest.sha256).gt('expires_at', new Date().toISOString())
    .select('*').maybeSingle()
  if (error) throw new PurchaseBoundaryError('purchase_store_unavailable')
  if (!data) throw new PurchaseBoundaryError('purchase_state_changed')
  return {...purchaseView(data), checkoutUrl: row.checkout_url}
}

export async function cancelPurchase(owner: string, id: string) {
  assertPurchaseFeatureEnabled()
  const row = await getPurchase(owner, id)
  if (!row) throw new PurchaseBoundaryError('purchase_not_found')
  if (row.status === 'cancelled') return purchaseView(row)
  if (!['awaiting_provider_handoff', 'pending_approval', 'approved'].includes(row.status)) {
    throw new PurchaseBoundaryError('purchase_handoff_may_be_active')
  }
  const {data, error} = await supabaseAdmin.from(TABLE)
    .update({status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString()})
    .eq('id', id).eq('owner_telegram_id', owner).eq('status', row.status).select('*').maybeSingle()
  if (error) throw new PurchaseBoundaryError('purchase_store_unavailable')
  if (!data) throw new PurchaseBoundaryError('purchase_state_changed')
  return purchaseView(data)
}
