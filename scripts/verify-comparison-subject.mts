import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsePriceComparison, comparisonSearchUrl, comparisonProductLead, comparisonObjective } from '../lib/commerce/comparison-model'
// 16 Oct live: "compare price of iPhone 16 on Flipkart and Croma" kept "price of" in the product name; both stores failed.
assert.equal(parsePriceComparison('compare price of iPhone 16 on Flipkart and Croma')?.subject, 'iPhone 16')
assert.equal(parsePriceComparison('compare the prices of Sony WH-1000XM5 on amazon and flipkart')?.subject, 'Sony WH-1000XM5')
assert.equal(parsePriceComparison('compare amul butter on blinkit and zepto')?.subject, 'amul butter')
assert.equal(parsePriceComparison('compare prices for iphone 16 128GB on amazon and croma')?.subject, 'iphone 16 128GB')
assert.equal(comparisonProductLead('flipkart', 'iPhone 16', [{ url: 'https://www.flipkart.com/apple-iphone-16-black-128-gb/p/itmb07d67f995271', title: 'Apple iPhone 16 (Black, 128 GB)' }]), 'https://www.flipkart.com/apple-iphone-16-black-128-gb/p/itmb07d67f995271')
// With no product page from web search, start from the store's own search results.
assert.equal(comparisonSearchUrl('croma', 'iPhone 16'), 'https://www.croma.com/searchB?q=iPhone%2016%20128GB%3Arelevance&text=iPhone%2016%20128GB')
assert.equal(comparisonSearchUrl('flipkart', 'iPhone 16'), 'https://www.flipkart.com/search?q=iPhone%2016')
assert.equal(comparisonSearchUrl('amazon', 'iPhone 16'), 'https://www.amazon.in/s?k=iPhone%2016')
// 18 Oct: grocery stores start on their own search results too (home page led to the wrong item).
assert.equal(comparisonSearchUrl('blinkit', 'milk'), 'https://blinkit.com/s/?q=milk')
assert.equal(comparisonSearchUrl('zepto', 'Amul butter 500g'), 'https://www.zepto.com/search?query=Amul%20butter%20500g')
assert.equal(comparisonSearchUrl('swiggy', 'biryani'), null, 'food delivery keeps its own flow')
const pc = readFileSync(new URL('../lib/commerce/price-comparison.ts', import.meta.url), 'utf8')
assert.match(pc, /else startUrl = comparisonSearchUrl\(next\.provider, task\.metadata_json\.subject\) \|\| startUrl/)
assert.match(comparisonObjective({ metadata_json: { request: 'x', subject: 'iPhone 16', providers: [] } } as any, 'flipkart'), /goto to its own product link rather than clicking the tile/)
assert.match(pc, /row\.startUrl === comparisonSearchUrl\(row\.provider, task\.metadata_json\.subject\)/)
assert.match(pc, /row\.startUrl === comparisonSearchUrl\(row\.provider, task\.metadata_json\.subject\)/, 'a search-page start passes the saved-task check')
console.log('verify-comparison-subject: subject, search start and product goto ok')
// 16 Oct live: Croma's iPhone 16 (256GB) page was judged incomplete with no trace, and the reply used jargon.
{
  const sc = readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
  assert.match(sc, /the listed price of any variant of exactly that model answers it/)
  assert.match(sc, /A delivery-pincode or location box beside a visible listed price does not block a listed-price answer/)
  assert.match(sc, /console\.warn\('BROWSER_ASSESSMENT_INCOMPLETE:'/)
  const model = readFileSync(new URL('../lib/commerce/comparison-model.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(model, /did not expose the requested item|unverified unless stated above/)
  assert.doesNotMatch(pc, /India-scoped web search|leads, not confirmed/)
  console.log('verify-comparison-subject: variant rule, incomplete reason and plain wording ok')
}
// 16 Oct 6:56 pm live: "iPhone 16" opened the iPhone 16e page; Croma's page was judged against the two-store request.
{
  const m = await import('../lib/commerce/comparison-model')
  assert.equal(m.tokensEndWords('Apple iPhone 16e (White, 128 GB)', ['iPhone', '16']), false)
  assert.equal(m.tokensEndWords('Apple iPhone 16 (128 GB Storage)', ['iPhone', '16']), true)
  assert.equal(m.tokensEndWords('Sony WH-1000XM5 Headphones', ['xm5']), true, 'a model code inside a longer code still fits')
  assert.equal(m.comparisonProductLead('flipkart', 'iPhone 16', [
    { url: 'https://www.flipkart.com/apple-iphone-16e-white-128-gb/p/itm7971f594b0906', title: 'Apple iPhone 16e (White, 128 GB)' },
    { url: 'https://www.flipkart.com/apple-iphone-16-black-128-gb/p/itm3c9366c8c93cb', title: 'Apple iPhone 16 (Black, 128 GB)' }]),
    'https://www.flipkart.com/apple-iphone-16-black-128-gb/p/itm3c9366c8c93cb')
  assert.equal(m.comparisonProductLead('flipkart', 'iPhone 16', [{ url: 'https://www.flipkart.com/apple-iphone-16e-white-128-gb/p/itm7971f594b0906' }]), null, 'untitled 16e URL refused too')
  const e16: any = { provider: 'flipkart', status: 'observed', sourceUrl: 'https://www.flipkart.com/apple-iphone-16e-white-128-gb/p/itm7971f594b0906', evidence: 'Apple iPhone 16e (White, 128 GB)\n₹59,900' }
  assert.equal(m.comparisonQuote('iPhone 16', e16), null, 'a 16e price is never quoted as an iPhone 16 price')
  const obj = m.comparisonObjective({ metadata_json: { request: 'compare price of iPhone 16 on Flipkart and Croma', subject: 'iPhone 16', providers: [] } } as any, 'croma')
  assert.match(obj, /^Find the listed price of this product on Croma: "iPhone 16"\. This read is only about Croma; other stores are checked separately/)
  assert.doesNotMatch(obj, /Flipkart/, 'the store read never sees the other stores')
  assert.match(obj, /"16e", "16 Plus", "16 Pro" when "16" was asked\) is a different product/)
  console.log('verify-comparison-subject: whole model numbers and per-store question ok')
}

// 16 Oct live: "Flipkart and Croma and reliance digital" never considered Reliance Digital.
{
  const {parsePriceComparison, comparisonSearchUrl: searchUrl} = await import('../lib/commerce/comparison-model')
  const parsed: any = (parsePriceComparison as any)('compare price of iPhone 16 on Flipkart and Croma and reliance digital')
  const keys = (parsed?.providers || parsed?.metadata_json?.providers || []).map((x: any) => x.provider || x)
  assert.ok(keys.includes('reliance'), 'reliance digital is one of the stores: ' + JSON.stringify(parsed).slice(0, 300))
  assert.equal(searchUrl('reliance', 'iPhone 16'), 'https://www.reliancedigital.in/products?q=iPhone%2016')
  console.log('verify-comparison-subject: reliance digital is a store')
}

// 16 Oct live: the lead for "iPhone 16" on Croma was the discontinued 512GB page, which has no price.
{
  const {comparisonProductLead: lead} = await import('../lib/commerce/comparison-model')
  const pages = [
    {url: 'https://www.croma.com/apple-iphone-16-512gb-teal-/p/309706', title: 'Buy Apple iPhone 16 (512GB, Teal) Online - Croma'},
    {url: 'https://www.croma.com/apple-iphone-16-128gb-teal-/p/309695', title: 'Buy Apple iPhone 16 (128GB, Teal) Online - Croma'},
  ]
  assert.equal(lead('croma', 'iPhone 16', pages), pages[1].url)
  assert.equal(lead('croma', 'iPhone 16 512GB', pages), pages[0].url)
  console.log('verify-comparison-subject: base-size lead ok')
}

// 16 Oct live: the Reliance product page was read but its /product/<slug> address was refused as a source.
{
  const {comparisonSource: source} = await import('../lib/commerce/comparison-model')
  assert.equal(source('reliance', 'https://www.reliancedigital.in/product/apple-iphone-16-128-gb-black-m0xrrm-8590265'),
    'https://www.reliancedigital.in/product/apple-iphone-16-128-gb-black-m0xrrm-8590265')
  assert.equal(source('reliance', 'https://www.reliancedigital.in/products?q=iphone'), null)
  console.log('verify-comparison-subject: reliance product address ok')
}
