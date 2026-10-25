import type {CommerceProvider} from './providers'

// Provider adapters must produce these records from readback, never model prose.
// Monetary values are integer paise after the adapter has verified the source unit.
export type CommerceQuote = {
  provider: CommerceProvider; service: 'food' | 'grocery'; owner: string; runId: string;
  addressId: string; deliveryContextId: string; basketKey: string;
  observedAt: number; currency: 'INR'; evidence: 'provider_cart';
  available: boolean; itemPaise: number | null; deliveryPaise: number | null;
  otherFeesPaise: number | null; discountPaise: number | null; payablePaise: number | null;
  payableIncludesDelivery: boolean;
  items: Array<{id: string; variantKey: string; quantity: number}>;
  cartId: string; providerUrl: string | null;
}

export type QuoteScope = {owner: string; runId: string; basketKey: string; deliveryContextId: string; service: 'food' | 'grocery'}
const money = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export function quoteProblem(quote: CommerceQuote, scope: QuoteScope, now = Date.now()): string | null {
  if (quote.owner !== scope.owner || quote.runId !== scope.runId) return 'wrong_task_owner'
  if (!quote.basketKey || quote.basketKey !== scope.basketKey || quote.service !== scope.service) return 'different_basket'
  if (!quote.deliveryContextId || quote.deliveryContextId !== scope.deliveryContextId || !quote.addressId) return 'different_delivery_address'
  const age = now - quote.observedAt
  if (!Number.isFinite(age) || age < 0 || age > 5 * 60_000) return 'refresh_required'
  if (quote.evidence !== 'provider_cart' || !quote.cartId || quote.currency !== 'INR') return 'unverified_cart'
  if (!quote.available) return 'unavailable'
  if (!quote.items.length || quote.items.some(item => !item.id || !item.variantKey || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) return 'unverified_items'
  if (!quote.payableIncludesDelivery || !money(quote.payablePaise)) return 'delivered_total_unknown'
  for (const value of [quote.itemPaise, quote.deliveryPaise, quote.otherFeesPaise, quote.discountPaise]) {
    if (value !== null && !money(value)) return 'invalid_amount'
  }
  return null
}

export function compareDeliveredQuotes(quotes: CommerceQuote[], scope: QuoteScope, now = Date.now()) {
  const accepted = quotes.filter(quote => !quoteProblem(quote, scope, now))
  // Compare a provider's latest readback, not duplicate snapshots of one cart.
  const latest = new Map<string, CommerceQuote>()
  for (const quote of accepted) {
    const key = `${quote.provider}:${quote.service}`
    if (!latest.has(key) || latest.get(key)!.observedAt < quote.observedAt) latest.set(key, quote)
  }
  const ranked = [...latest.values()].sort((a,b) => a.payablePaise! - b.payablePaise!)
  return {
    ranked,
    cheapest: ranked.length >= 2 ? ranked[0] : null,
    comparisonVerified: ranked.length >= 2,
    rejected: quotes.map(quote => ({provider: quote.provider, reason: quoteProblem(quote, scope, now)})).filter(item => item.reason),
  }
}

export function verifiedCartMatches(quote: CommerceQuote, scope: QuoteScope, expected: CommerceQuote['items'], now = Date.now()) {
  if (quoteProblem(quote, scope, now)) return false
  const canonical = (items: CommerceQuote['items']) => JSON.stringify(items.map(item => [item.id, item.variantKey, item.quantity]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
  return canonical(quote.items) === canonical(expected)
}

export function commerceHandoffUrl(provider: CommerceProvider, value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    const domains = provider === 'swiggy' ? ['swiggy.com'] : ['zepto.com', 'zepto.co.in']
    if (url.protocol !== 'https:' || url.username || url.password || !domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return null
    return url.href
  } catch { return null }
}

export function renderCommerceQuote(quote: CommerceQuote, scope: QuoteScope, now = Date.now()) {
  const problem = quoteProblem(quote, scope, now)
  if (problem) return `This cart needs verification (${problem.replaceAll('_', ' ')}). No order has been placed.`
  const price = (value: number | null) => value === null ? 'not provided' : `₹${(value / 100).toFixed(2)}`
  const url = commerceHandoffUrl(quote.provider, quote.providerUrl)
  return `${quote.provider === 'swiggy' ? 'Swiggy' : 'Zepto'} cart verified for your selected delivery address.\nItems: ${price(quote.itemPaise)}\nDelivery: ${price(quote.deliveryPaise)}\nOther fees: ${price(quote.otherFeesPaise)}\nDiscount: ${price(quote.discountPaise)}\nProvider payable total: ${price(quote.payablePaise)}\nChecked: ${new Date(quote.observedAt).toISOString()}\n${url ? `Open provider: ${url}` : 'The provider did not return a verified checkout link.'}\nNo order has been placed. Opening the correct cart on your phone is still unverified.`
}
