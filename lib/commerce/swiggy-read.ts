import type {CommerceMcpClient} from './mcp'
import type {CommerceQuote, QuoteScope} from './evidence'
import {verifiedCartMatches} from './evidence'

type Reader = Pick<CommerceMcpClient, 'readTool'>
export type RestaurantChoice = {id: string; name: string; distanceKm: number | null; deliveryMinutes: number | null}
export type FoodChoice = {id: string; restaurantId: string; name: string; needsCustomization: boolean; pricePaise: null}
export type GroceryChoice = {id: string; skuId: string; productId: string; name: string; variant: string; maxQuantity: number | null; pricePaise: null}
const text = (value: unknown, limit = 180) => typeof value === 'string' && value.trim() && value.length <= limit ? value.trim() : null
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const identity = (value: unknown) => text(value, 512)

// Published schemas do not specify units for bare numeric price fields yet.
// Do not convert these to rupees or confuse menu prices with delivered quotes.
export async function readFoodRestaurants(client: Reader, addressId: string, query: string) {
  const data = await client.readTool('search_restaurants', {addressId, query})
  if (!Array.isArray(data?.restaurants)) throw new Error('commerce_catalogue_invalid')
  const choices: RestaurantChoice[] = []
  for (const row of data.restaurants.slice(0, 100)) {
    const id = identity(row?.id), name = text(row?.name)
    if (!id || !name || row.availabilityStatus !== 'OPEN' || choices.some(choice => choice.id === id)) continue
    choices.push({id, name, distanceKm: positive(row.distanceKm), deliveryMinutes: positive(row.deliveryTimeMinutes)})
  }
  return choices.slice(0, 8)
}

export async function readFoodMenu(client: Reader, addressId: string, query: string, restaurantId: string, vegetarian: boolean) {
  const data = await client.readTool('search_menu', {addressId, query, restaurantIdOfAddedItem: restaurantId, ...(vegetarian ? {vegFilter: 1} : {})})
  if (!Array.isArray(data?.items)) throw new Error('commerce_catalogue_invalid')
  const choices: FoodChoice[] = []
  for (const row of data.items.slice(0, 100)) {
    const id = identity(row?.menu_item_id), name = text(row?.name)
    if (!id || !name || row.restaurant_id !== restaurantId || row.inStock !== 1 || (vegetarian && row.isVeg !== true) || choices.some(choice => choice.id === id)) continue
    const needsCustomization = row.hasVariants !== false || row.hasAddons !== false
      || !!row.variations?.length || !!row.variantsV2?.length || !!row.addons?.length
    choices.push({id, restaurantId, name, needsCustomization, pricePaise: null})
  }
  return choices.slice(0, 10)
}

export async function readInstamartProducts(client: Reader, addressId: string, query: string) {
  const data = await client.readTool('search_products', {addressId, query})
  if (!Array.isArray(data?.products)) throw new Error('commerce_catalogue_invalid')
  const choices: GroceryChoice[] = []
  for (const product of data.products.slice(0, 100)) {
    if (product?.inStock !== true || product?.isAvail !== true || !Array.isArray(product.variations)) continue
    for (const row of product.variations.slice(0, 30)) {
      const id = identity(row?.spinId), skuId = identity(row?.skuId), productId = identity(product.productId)
      const name = text(row?.displayName), variant = text(row?.quantityDescription)
      if (!id || !skuId || !productId || !name || !variant || row.isInStockAndAvailable !== true || choices.some(choice => choice.id === id && choice.skuId === skuId)) continue
      choices.push({id, skuId, productId, name, variant, maxQuantity: Number.isSafeInteger(row.maxQuantity) && row.maxQuantity > 0 ? row.maxQuantity : null, pricePaise: null})
    }
  }
  return choices.slice(0, 20)
}

// Accept explicit INR strings only; plain numbers/ambiguous units stay unknown.
export function explicitInrPaise(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(?:₹|INR|Rs\.?)\s*(\d+(?:\.\d{1,2})?)$/i)
  if (!match) return null
  const [whole, fraction = ''] = match[1].split('.')
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(paise) ? paise : null
}

// Existing-cart read only; comparison must not mutate a cart to obtain fees.
export async function readInstamartQuote(client: Reader, scope: QuoteScope & {addressId: string}, expected: CommerceQuote['items']): Promise<CommerceQuote> {
  const data = await client.readTool('get_cart', {})
  if (scope.service !== 'grocery' || data?.selectedAddressDetails?.id !== scope.addressId || !identity(data.cartId)
      || data.cartAbsent || data.addressWarning || data.cartWarning || data.unserviceableItems?.length || !Array.isArray(data.items)) throw new Error('commerce_cart_unverified')
  const payable = explicitInrPaise(data.billBreakdown?.toPay?.value)
  if (payable === null || explicitInrPaise(data.cartTotalAmount) !== payable) throw new Error('commerce_amount_unit_unverified')
  const items = data.items.map((row: any) => {
    if (!identity(row?.spinId) || !identity(row?.skuId) || !Number.isSafeInteger(row.quantity) || row.quantity <= 0 || row.isInStockAndAvailable !== true) throw new Error('commerce_cart_item_unverified')
    return {id: row.spinId, variantKey: row.skuId, quantity: row.quantity}
  })
  const quote: CommerceQuote = {owner: scope.owner, runId: scope.runId, basketKey: scope.basketKey, deliveryContextId: scope.deliveryContextId,
    provider: 'swiggy', service: 'grocery', addressId: scope.addressId, cartId: data.cartId, currency: 'INR', evidence: 'provider_cart', observedAt: Date.now(),
    available: true, items, itemPaise: null, deliveryPaise: null, otherFeesPaise: null, discountPaise: null,
    payablePaise: payable, payableIncludesDelivery: true, providerUrl: null}
  if (!verifiedCartMatches(quote, scope, expected)) throw new Error('commerce_cart_basket_mismatch')
  return quote
}
