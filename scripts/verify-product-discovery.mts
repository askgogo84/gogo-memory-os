// 2 Nov live: "find me a navy linen shirt under 2000" → a category page and "browse it yourself".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { parseProductAsk, pickProducts, formatProducts, priceFrom, tryProductDiscovery } = await import('../lib/agent/product-discovery')

assert.deepEqual(parseProductAsk('find me a navy linen shirt under 2000'), { query: 'navy linen shirt', maxPrice: 2000, minPrice: null })
assert.deepEqual(parseProductAsk('Suggest white sneakers below ₹3,500'), { query: 'white sneakers', maxPrice: 3500, minPrice: null })
assert.deepEqual(parseProductAsk('looking for a black backpack between 1k and 2.5k'), { query: 'black backpack', maxPrice: 2500, minPrice: 1000 })
assert.equal(parseProductAsk('find me a kurta for Divya')?.maxPrice, null)
for (const no of ['compare iPhone 17 on Amazon and Flipkart', 'track the price of AirPods', 'find me a restaurant near Rajajinagar', 'order milk on instamart', 'what is a linen shirt', 'find me flights to Goa', 'remind me to buy a shirt'])
  assert.equal(parseProductAsk(no), null, no)
console.log('✓ open product asks are recognised with their budget; comparisons, watches, food and travel are not')

assert.equal(priceFrom('₹1,299.00'), 1299)
assert.equal(priceFrom('Rs. 899'), 899)
const items = [
  { title: 'Men Navy Blue Pure Linen Casual Shirt', source: 'Myntra', link: 'https://www.myntra.com/shirts/x/1', price: 1499, priceText: '₹1,499', rating: 4.3, ratingCount: 2100 },
  { title: 'Navy Linen Blend Slim Fit Shirt', source: 'AJIO', link: 'https://www.ajio.com/p/2', price: 1199, priceText: '₹1,199', rating: 4.1, ratingCount: 340 },
  { title: 'Navy Linen Shirt Premium', source: 'Tata CLiQ', link: 'https://www.tatacliq.com/p/3', price: 2899, priceText: '₹2,899' },
  { title: 'Navy Linen Nehru Jacket', source: 'Flipkart', link: 'https://www.flipkart.com/p/4', price: 1599, priceText: '₹1,599' },
  { title: 'White Linen Shirt', source: 'Amazon.in', link: 'https://www.amazon.in/dp/5', price: 999, priceText: '₹999' },
  { title: 'Men Navy Blue Pure Linen Casual Shirt', source: 'Myntra', link: 'https://www.myntra.com/shirts/x/1b', price: 1499, priceText: '₹1,499' },
]
{
  const ask = parseProductAsk('find me a navy linen shirt under 2000')!
  const r = pickProducts(ask, items)
  assert.deepEqual(r.picked.map(p => p.source), ['Myntra', 'AJIO'], JSON.stringify(r.picked.map(p => p.title)))
  const text = formatProducts(ask, r)
  assert.match(text, /^🛍️ 2 navy linen shirt under ₹2,000/)
  assert.match(text, /1\. \*Men Navy Blue Pure Linen Casual Shirt\*\n₹1,499 · Myntra · ★4\.3 \(2\.1k\)\nhttps:\/\/www\.myntra\.com/)
  assert.doesNotMatch(text, /Nehru|White Linen|2,899/, 'wrong item, wrong colour and over-budget results are left out')
  assert.match(text, /haven't added anything to a cart/)
  console.log('✓ real products in budget, matching colour and item, deduplicated, with store, price and link')
}
{
  const ask = parseProductAsk('find me a navy linen shirt under 500')!
  const text = formatProducts(ask, pickProducts(ask, items))
  assert.match(text, /couldn't find a navy linen shirt under ₹500/)
  assert.match(text, /cheapest match I found is .* at ₹1,199 on AJIO/)
  console.log('✓ nothing in budget → says so and names the cheapest real match')
}
// End to end with a fake provider, and a provider failure falls back to the normal web answer.
{
  process.env.SERPER_API_KEY = 'fixture'
  let body: any = null
  const fakeFetch: any = async (url: string, init: any) => { assert.equal(url, 'https://google.serper.dev/shopping'); body = JSON.parse(init.body); return new Response(JSON.stringify({ shopping: [{ title: 'Navy Linen Shirt Slim Fit', source: 'Myntra', link: 'https://www.myntra.com/a', price: '₹1,299', rating: 4.4, ratingCount: 120 }] }), { status: 200 }) }
  const r = await tryProductDiscovery({ text: 'find me a navy linen shirt under 2000', fetchImpl: fakeFetch })
  assert.equal(body.gl, 'in')
  assert.match(String(r?.text), /Navy Linen Shirt Slim Fit\*\n₹1,299 · Myntra/)
  const failing: any = async () => new Response('no', { status: 500 })
  assert.equal(await tryProductDiscovery({ text: 'find me a navy linen shirt under 2000', fetchImpl: failing }), null)
  assert.equal(await tryProductDiscovery({ text: "what's the weather", fetchImpl: fakeFetch }), null)
  console.log('✓ India shopping search end to end; provider failure falls back to the web answer')
}
{
  const src = readFileSync('lib/agent/product-discovery.ts', 'utf8')
  assert.doesNotMatch(src, /supabaseAdmin|\.insert\(|\.update\(/, 'read-only')
  assert.match(readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8'), /tryProductDiscovery\(\{ text \}\)/)
  assert.match(readFileSync('app/api/dashboard/chat/route.ts', 'utf8'), /tryProductDiscovery\(\{ text \}\)/)
  assert.match(readFileSync('lib/agent/brain.ts', 'utf8'), /parseProductAsk\(p\.text\)/)
  console.log('✓ read-only; wired on WhatsApp and dashboard before the web answer; the brain hands it over')
}
// 2 Nov live: Google product-viewer links carry long catalogue ids that the reply's privacy filter withholds,
// so every link arrived broken. Store links pass through; Google links become an id-free Shopping search.
{
  const { shopLink } = await import('../lib/agent/product-discovery')
  const { redactSecretShapedText } = await import('../lib/bot/memory-redaction')
  assert.equal(shopLink({ link: 'https://www.myntra.com/shirts/blu/123', title: 'x', source: 'Myntra' }), 'https://www.myntra.com/shirts/blu/123')
  const google = shopLink({ link: 'https://www.google.com/search?ibp=oshop&q=navy&prds=catalogid:17045821123456789,headlineOfferDocid:9876543210123,pvo:2&gl=in', title: 'Snitch Navy Linen Shirt', source: 'snitch.com' })
  assert.match(google, /^https:\/\/www\.google\.com\/search\?udm=28&gl=in&q=Snitch\+Navy\+Linen\+Shirt\+snitch\.com$/)
  assert.equal(redactSecretShapedText(google), google, 'the link survives the privacy filter unchanged')
  assert.doesNotMatch(shopLink({ link: 'https://shop.example.in/p/1234567890123', title: 'Shirt', source: 'Shop' }), /1234567890123/)
  assert.equal(shopLink({ link: '', title: '', source: '' }), '')
  console.log('✓ product links survive the privacy filter: store links kept, Google viewer links become id-free searches')
}
console.log('Product discovery checks passed')
