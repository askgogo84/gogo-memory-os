import {createHash, randomUUID} from 'node:crypto'
import {supabaseAdmin} from '@/lib/supabase-admin'
import type {CommerceTask} from './task'
import type {CommerceMcpClient} from './mcp'
import {readInstamartProducts, explicitInrPaise} from './swiggy-read'
import {swiggyAddressPage} from './addresses'

type Item = {spinId: string; skuId: string; quantity: number}
type Client = Pick<CommerceMcpClient, 'readTool' | 'updateInstamartCart'>
type Selection = {spinId: string; skuId: string; quantity: number}
const key = (item: Item) => JSON.stringify([item.spinId, item.skuId])
const canonical = (items: Item[]) => JSON.stringify(items.map(item => [item.spinId, item.skuId, item.quantity]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
const tokenBinding = (token: string) => createHash('sha256').update(token).digest('hex')
const id = (value: any) => typeof value === 'string' && value.length > 0 && value.length <= 512

function cartItems(data: any, addressId: string, allowEmpty: boolean): Item[] {
  if (!data || data.addressWarning || data.cartWarning || data.unserviceableItems?.length || !Array.isArray(data.items) || data.items.length > 100) throw Error('cart_unverified')
  if (allowEmpty && data.cartAbsent === true && data.items.length === 0 && (!data.selectedAddressDetails?.id || data.selectedAddressDetails.id === addressId)) return []
  if (data.cartAbsent || !id(data.cartId) || data.selectedAddressDetails?.id !== addressId) throw Error('cart_address_unverified')
  const items: Item[] = data.items.map((item: any) => {
    if (!id(item?.spinId) || !id(item?.skuId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999 || item.isInStockAndAvailable !== true) throw Error('cart_item_unverified')
    return {spinId: item.spinId, skuId: item.skuId, quantity: item.quantity}
  })
  if (new Set(items.map(key)).size !== items.length) throw Error('cart_item_unverified')
  return items
}

async function transition(owner: string, task: CommerceTask, metadata: Record<string, any>, summary: string, status: 'paused' | 'outcome_unknown') {
  const {data, error} = await supabaseAdmin.from('agent_runs').update({status, metadata_json: metadata, summary, updated_at: new Date().toISOString()})
    .eq('id', task.id).eq('telegram_id', owner).eq('type', 'grocery_comparison').eq('status', task.status).eq('updated_at', task.updated_at)
    .select('id,type,status,updated_at,summary,metadata_json').maybeSingle()
  if (error || !data) throw Error('commerce_task_changed')
  return data as CommerceTask
}

// Reconciliation is read-only. Neither retries nor a repeated browser click can add again.
export async function reconcileInstamartCart(owner: string, task: CommerceTask, token: string, client: Client): Promise<CommerceTask> {
  const operation = task.metadata_json.commerce?.cartOperation
  if (task.type !== 'grocery_comparison' || task.metadata_json.state !== 'cart_outcome_unknown' || task.status !== 'outcome_unknown' || !operation || operation.tokenBinding !== tokenBinding(token)) throw Error('cart_account_or_operation_changed')
  const data = await client.readTool('get_cart', {})
  const items = cartItems(data, operation.addressId, false)
  if (canonical(items) !== canonical(operation.expected)) throw Error('cart_outcome_unverified')
  const payable = explicitInrPaise(data.billBreakdown?.toPay?.value)
  const total = payable !== null && explicitInrPaise(data.cartTotalAmount) === payable ? payable : null
  const checkedAt = new Date().toISOString()
  const summary = 'Instamart cart contents verified: ' + operation.name + ' — ' + operation.variant + ', added quantity ' + operation.quantity + '. Existing items were included in the verified basket. '
    + (total === null ? 'Payable total and delivery fee details remain unverified. ' : 'Provider payable total for the whole cart: ₹' + (total / 100).toFixed(2) + '. Separate fee details are not verified. ')
    + 'Checked: ' + checkedAt + '. No order was placed. A provider cart link was not supplied; opening the correct cart on your phone is still unverified.'
  return transition(owner, task, {...task.metadata_json, state: 'cart_contents_verified', commerce: {...task.metadata_json.commerce, blocker: null,
    cartOperation: {...operation, verifiedAt: checkedAt}, cartReceipt: {cartId: data.cartId, addressId: operation.addressId, items, payablePaise: total, checkedAt, providerUrl: null, phoneVerified: false}}}, summary, 'paused')
}

export async function prepareInstamartCart(owner: string, task: CommerceTask, token: string, client: Client, selection: Selection): Promise<CommerceTask> {
  const commerce = task.metadata_json.commerce
  if (task.type !== 'grocery_comparison' || task.status !== 'paused' || task.metadata_json.state !== 'waiting_item_selection' || commerce?.provider !== 'swiggy' || commerce.cartOperation) throw Error('cart_readback_required')
  const address = commerce.address
  if (address?.source !== 'provider_saved_address' || !id(address.id)) throw Error('select_saved_address')
  if (!id(selection.spinId) || !id(selection.skuId) || !Number.isSafeInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 99) throw Error('invalid_selection')
  const age = Date.now() - Date.parse(commerce.catalogue?.observedAt || '')
  const offered = commerce.catalogue?.products?.find((item: any) => item.id === selection.spinId && item.skuId === selection.skuId)
  if (!offered || !Number.isFinite(age) || age < 0 || age > 300000) throw Error('refresh_products')
  const page = swiggyAddressPage(await client.readTool('get_addresses', {page: address.page || 1, pageSize: 10}))
  if (!page.addresses.some(item => item.id === address.id)) throw Error('reselect_saved_address')
  const products = await readInstamartProducts(client, address.id, task.metadata_json.subject)
  const current = products.find(item => item.id === selection.spinId && item.skuId === selection.skuId && item.productId === offered.productId && item.variant === offered.variant)
  if (!current) throw Error('item_no_longer_available')
  const baseline = await client.readTool('get_cart', {})
  const expected = cartItems(baseline, address.id, true)
  const existing = expected.find(item => item.spinId === selection.spinId && item.skuId === selection.skuId)
  const quantity = (existing?.quantity || 0) + selection.quantity
  if (quantity > 999 || (current.maxQuantity !== null && quantity > current.maxQuantity)) throw Error('quantity_unavailable')
  if (existing) existing.quantity = quantity
  else expected.push({spinId: selection.spinId, skuId: selection.skuId, quantity})
  if (expected.length > 100) throw Error('cart_too_large')
  const operation = {id: randomUUID(), requestedAt: new Date().toISOString(), tokenBinding: tokenBinding(token), addressId: address.id,
    name: current.name, variant: current.variant, quantity: selection.quantity, expected}
  // Persist BEFORE the outbound write. If this fails, no provider mutation is attempted.
  const claimed = await transition(owner, task, {...task.metadata_json, state: 'cart_outcome_unknown', commerce: {...commerce, cartOperation: operation}},
    'An Instamart cart change was requested. Its outcome is unverified. Check the cart before trying another addition; no order was placed.', 'outcome_unknown')
  try { await client.updateInstamartCart(address.id, expected) } catch { /* It may have applied: only read back, never retry the write. */ }
  try { return await reconcileInstamartCart(owner, claimed, token, client) } catch { return claimed }
}
