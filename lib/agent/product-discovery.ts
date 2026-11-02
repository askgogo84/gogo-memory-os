// Product discovery (2 Nov live): "find me a navy linen shirt under 2000" went to a web answer that pointed at a
// Flipkart category page and said "browse it yourself". Open-ended product asks now read Google Shopping results
// for India (Serper /shopping, the same key as web search) and return real products with prices and stores,
// filtered to the budget. Read-only: no cart, no sign-in, no purchase. A specific model across named stores stays
// with the price comparison ("compare iPhone 17 on Amazon and Flipkart").

const clean = (v: unknown, max = 120) => String(v ?? '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)

const PRODUCT_NOUN = /\b(shirts?|t-?shirts?|tees?|polos?|kurtas?|kurtis?|sarees?|sari|lehengas?|dress(?:es)?|tops?|blouses?|jeans|trousers?|pants|chinos|shorts|joggers|track ?pants|jackets?|blazers?|hoodies?|sweaters?|sweatshirts?|coats?|suits?|nehru jackets?|shoes|sneakers|loafers|sandals|slippers|heels|boots|flip ?flops|socks|belts?|wallets?|bags?|backpacks?|handbags?|totes?|luggage|suitcases?|trolley ?bags?|watch(?:es)?|smart ?watch(?:es)?|sunglasses|spectacles|caps?|hats?|scarf|scarves|earrings|necklaces?|rings?|bracelets?|perfumes?|deodorants?|headphones|earbuds|earphones|speakers?|power ?banks?|chargers?|mouse|keyboards?|monitors?|water ?bottles?|bottles?|mugs?|pillows?|bedsheets?|curtains?|towels?|lamps?|chairs?|desks?|mattress(?:es)?|cookware|pans?|kettles?|mixers?|toys?|books?)\b/i
const ASK = /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:find|show|suggest|recommend|get|search(?: for)?|look(?:ing)? for|i (?:want|need)(?: to buy)?|buy|shop for|any good)\b/i
const NOT_DISCOVERY = /\b(compare|comparison|price of|track|watch|alert|order status|my order|delivered|return|refund|recipe|restaurant|swiggy|zomato|instamart|blinkit|zepto|grocer(?:y|ies)|flight|hotel|train|ticket|movie)\b/i

export type ProductAsk = { query: string; maxPrice: number | null; minPrice: number | null }

function rupees(raw: string) {
  const m = String(raw || '').toLowerCase().replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k)?/)
  if (!m) return null
  const n = Number(m[1]) * (m[2] ? 1000 : 1)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** "find me a navy linen shirt under 2000" → {query:"navy linen shirt", maxPrice:2000}. Null when it isn't an open product ask. */
export function parseProductAsk(text: string): ProductAsk | null {
  const t = String(text || '').trim().replace(/[?.!]+$/, '')
  if (t.length > 160 || !ASK.test(t) || !PRODUCT_NOUN.test(t) || NOT_DISCOVERY.test(t)) return null
  let maxPrice: number | null = null, minPrice: number | null = null
  const between = t.match(/\b(?:between|from)\s*(?:rs\.?|inr|₹)?\s*([\d,.]+\s*k?)\s*(?:and|to|-)\s*(?:rs\.?|inr|₹)?\s*([\d,.]+\s*k?)/i)
  const under = t.match(/\b(?:under|below|less than|within|upto|up to|max(?:imum)?|budget(?: of)?|not more than)\s*(?:rs\.?|inr|₹)?\s*([\d,.]+\s*k?)/i)
  const above = t.match(/\b(?:above|over|more than)\s*(?:rs\.?|inr|₹)?\s*([\d,.]+\s*k?)/i)
  if (between) { minPrice = rupees(between[1]); maxPrice = rupees(between[2]) }
  else { if (under) maxPrice = rupees(under[1]); if (above) minPrice = rupees(above[1]) }
  const query = t
    .replace(ASK, '')
    .replace(/\b(?:between|from)\s*(?:rs\.?|inr|₹)?\s*[\d,.]+\s*k?\s*(?:and|to|-)\s*(?:rs\.?|inr|₹)?\s*[\d,.]+\s*k?/i, '')
    .replace(/\b(?:under|below|less than|within|upto|up to|max(?:imum)?|budget(?: of)?|not more than|above|over|more than)\s*(?:rs\.?|inr|₹)?\s*[\d,.]+\s*k?\b(?:\s*(?:rs|rupees|inr))?/gi, '')
    .replace(/^\s*(?:me|us)\b/i, '').replace(/^\s*(?:a|an|some|the|good|nice|best)\b\s*/gi, '').replace(/\b(?:online|for me|please|in india)\b/gi, '')
    .replace(/\s+/g, ' ').trim()
  if (!query || !PRODUCT_NOUN.test(query)) return null
  return { query: clean(query, 80), maxPrice, minPrice }
}

export type ShoppingItem = { title: string; source: string; link: string; price: number | null; priceText: string; rating?: number; ratingCount?: number }

export function priceFrom(text: unknown): number | null {
  const m = String(text || '').replace(/,/g, '').match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/i) || String(text || '').replace(/,/g, '').match(/^\s*(\d+(?:\.\d+)?)\s*$/)
  return m ? Math.round(Number(m[1])) : null
}

const COLOURS = new Set(['black', 'white', 'navy', 'blue', 'red', 'green', 'olive', 'grey', 'gray', 'beige', 'brown', 'tan', 'maroon', 'pink', 'yellow', 'orange', 'purple', 'cream', 'khaki', 'mustard', 'teal', 'silver', 'gold', 'charcoal', 'peach', 'lavender'])
const STOP = new Set(['for', 'men', 'mens', "men's", 'women', 'womens', "women's", 'with', 'and', 'the', 'a', 'an', 'of', 'in', 'size'])
/** Keep products that match the ask's words (colour, material, kind) and the budget; best match, then rating. */
export function pickProducts(ask: ProductAsk, items: ShoppingItem[], limit = 5): { picked: ShoppingItem[]; overBudget: ShoppingItem | null } {
  const words = ask.query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w))
  const noun = (ask.query.match(PRODUCT_NOUN)?.[0] || '').toLowerCase().replace(/(?:es|s)$/, '')
  const colours = words.filter(w => COLOURS.has(w))
  const scored = items
    .filter(i => i.title && /^https?:\/\//.test(i.link))
    .map(i => {
      const hay = i.title.toLowerCase()
      const hits = words.filter(w => hay.includes(w.replace(/(?:es|s)$/, ''))).length
      // A colour the person named is a must: a white shirt is not a navy one.
      const colourOk = colours.every(c => hay.includes(c))
      return { i, hits, nounOk: !noun || hay.includes(noun), colourOk }
    })
    .filter(x => x.nounOk && x.colourOk && x.hits >= Math.max(1, Math.ceil(words.length * 0.6)))
  const inBudget = scored.filter(x => x.i.price !== null && (ask.maxPrice === null || x.i.price <= ask.maxPrice) && (ask.minPrice === null || x.i.price >= ask.minPrice))
  const seen = new Set<string>()
  const picked = inBudget
    .sort((a, b) => b.hits - a.hits || (b.i.rating || 0) - (a.i.rating || 0) || (a.i.price || 0) - (b.i.price || 0))
    .map(x => x.i)
    .filter(i => { const k = i.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, limit)
  const overBudget = picked.length ? null : (scored.filter(x => x.i.price !== null).sort((a, b) => (a.i.price || 0) - (b.i.price || 0))[0]?.i || null)
  return { picked, overBudget }
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
function compactCount(n?: number) { if (!n) return ''; return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n) }

export function formatProducts(ask: ProductAsk, result: { picked: ShoppingItem[]; overBudget: ShoppingItem | null }) {
  const budget = ask.maxPrice ? ` under ${inr(ask.maxPrice)}` : ask.minPrice ? ` above ${inr(ask.minPrice)}` : ''
  if (!result.picked.length) {
    if (result.overBudget) return `🛍️ I couldn't find a ${ask.query}${budget} right now. The cheapest match I found is ${clean(result.overBudget.title, 90)} at ${result.overBudget.price !== null ? inr(result.overBudget.price) : result.overBudget.priceText} on ${clean(result.overBudget.source, 30)}:\n${result.overBudget.link}\n\nSay a higher budget or a different colour and I'll look again.`
    return `🛍️ I couldn't find a ${ask.query}${budget} in today's shopping results. Try a simpler description (for example the colour and the item) and I'll look again.`
  }
  const lines = result.picked.map((p, i) => {
    const rating = p.rating ? ` · ★${p.rating}${p.ratingCount ? ` (${compactCount(p.ratingCount)})` : ''}` : ''
    return `${i + 1}. *${clean(p.title, 90)}*\n${p.price !== null ? inr(p.price) : p.priceText} · ${clean(p.source, 30)}${rating}\n${p.link}`
  })
  return `🛍️ ${result.picked.length} ${ask.query}${budget}\n\n${lines.join('\n\n')}\n\nPrices from Google Shopping just now; check size and colour on the store page before you buy. I haven't added anything to a cart.`
}

// 2 Nov live: Serper's shopping links are Google product-viewer URLs full of long catalogue ids
// ("prds=catalogid:…,headlineOfferDocid:…"). The reply's privacy filter withholds long digit runs, so every link
// arrived broken ("[sensitive detail withheld],pvo:2,…"). Keep a store's own address when Serper gives one; else
// link a Google Shopping search for that exact product, which carries no ids.
export function shopLink(r: any): string {
  const raw = String(r?.link || '')
  try {
    const u = new URL(raw)
    const google = /(^|\.)google\.[a-z.]+$/i.test(u.hostname)
    if (/^https?:$/.test(u.protocol) && !google && !/\d{8,}/.test(raw)) return raw
  } catch { /* fall through to a search link */ }
  const q = `${clean(r?.title, 120)} ${clean(r?.source, 40)}`.replace(/\d{8,}/g, ' ').replace(/\s+/g, ' ').trim()
  if (!q) return ''
  return `https://www.google.com/search?${new URLSearchParams({ udm: '28', gl: 'in', q }).toString()}`
}

export async function searchShopping(query: string, fetchImpl: typeof fetch = fetch): Promise<ShoppingItem[]> {
  const key = process.env.SERPER_API_KEY
  if (!key) throw new Error('serper_missing_key')
  const res = await fetchImpl('https://google.serper.dev/shopping', {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'in', hl: 'en', num: 20 }), signal: AbortSignal.timeout(9000),
  })
  if (!res.ok) throw new Error(`serper_shopping_${res.status}`)
  const data: any = await res.json()
  const raw: any[] = Array.isArray(data?.shopping) ? data.shopping : []
  return raw.map((r: any): ShoppingItem => ({
    title: clean(r?.title, 160), source: clean(r?.source, 40), link: shopLink(r),
    price: priceFrom(r?.price), priceText: clean(r?.price, 30),
    rating: Number(r?.rating) || undefined, ratingCount: Number(r?.ratingCount) || undefined,
  }))
}

export async function tryProductDiscovery(params: { text: string; fetchImpl?: typeof fetch }) {
  const ask = parseProductAsk(params.text)
  if (!ask) return null
  const started = Date.now()
  try {
    const items = await searchShopping(`${ask.query}${ask.maxPrice ? ` under ${ask.maxPrice}` : ''}`, params.fetchImpl)
    const result = pickProducts(ask, items)
    console.log('PRODUCT_DISCOVERY:', JSON.stringify({ ms: Date.now() - started, results: items.length, picked: result.picked.length, budget: ask.maxPrice }))
    return { runId: 'product-discovery', status: 'completed' as const, capability: 'browser' as const, risk: 'low' as const, text: formatProducts(ask, result), handledBy: 'product-discovery' }
  } catch (err: any) {
    // A provider failure falls back to the normal web answer rather than an error reply.
    console.error('PRODUCT_DISCOVERY_FAILED:', String(err?.message || err).slice(0, 120))
    return null
  }
}
