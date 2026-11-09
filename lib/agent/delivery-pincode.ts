// 26 Oct (owner): "hand control back so I can set my pincode" meant typing into the remote Take Control view on a
// phone. Gogo now enters the delivery pincode itself on store pages: the one written in the request, else the
// person's own saved pincode (COMPARISON_PINCODE, the same value price comparisons already use). Setting a delivery
// location is not a purchase; the read still never adds to cart, orders or submits anything else.

const STORE_HOSTS = [
  'croma.com', 'reliancedigital.in', 'flipkart.com', 'amazon.in', 'vijaysales.com', 'tatacliq.com',
  'blinkit.com', 'zeptonow.com', 'swiggy.com', 'bigbasket.com', 'jiomart.com', 'myntra.com', 'nykaa.com',
]

export function isStoreHost(host: string) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '')
  return STORE_HOSTS.some(s => h === s || h.endsWith('.' + s))
}

/** A 6-digit pincode the person wrote next to pin/pincode/deliver, e.g. "pincode 560086", "deliver to 560086". */
export function requestedPincode(text: string): string | null {
  const m = String(text || '').match(/\b(?:pin\s*code|pincode|pin|deliver(?:y)?\s+(?:to|at|in)|postal\s+code)\s*(?:is|:|-|=)?\s*(\d{6})\b/i)
  return m && /^[1-9]\d{5}$/.test(m[1]) ? m[1] : null
}

export function savedPincode(env: Record<string, string | undefined> = process.env): string | null {
  const pin = String(env.COMPARISON_PINCODE || '').trim()
  return /^[1-9]\d{5}$/.test(pin) ? pin : null
}

/** The objective with a pincode instruction added for a store page, or unchanged. */
export function withDeliveryPincode(objective: string, url: string, env: Record<string, string | undefined> = process.env) {
  let host = ''
  try { host = new URL(url).hostname } catch { return { objective, pincode: null as string | null } }
  if (!isStoreHost(host)) return { objective, pincode: null as string | null }
  // Comparison reads already carry their own pincode instruction.
  if (/If asked for a delivery pincode, enter \d{6}/.test(objective)) return { objective, pincode: null as string | null }
  const pin = requestedPincode(objective) || savedPincode(env)
  if (!pin) return { objective, pincode: null as string | null }
  return {
    objective: `${objective}\n\nIf the page asks for a delivery pincode or location, enter ${pin} and press Continue/Apply. This only sets the delivery location (not a purchase); then read the page.`,
    pincode: pin,
  }
}
