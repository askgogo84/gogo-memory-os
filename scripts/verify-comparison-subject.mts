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
assert.equal(comparisonSearchUrl('croma', 'iPhone 16'), 'https://www.croma.com/searchB?q=iPhone%2016%3Arelevance&text=iPhone%2016')
assert.equal(comparisonSearchUrl('flipkart', 'iPhone 16'), 'https://www.flipkart.com/search?q=iPhone%2016')
assert.equal(comparisonSearchUrl('amazon', 'iPhone 16'), 'https://www.amazon.in/s?k=iPhone%2016')
assert.equal(comparisonSearchUrl('blinkit', 'milk'), null)
const pc = readFileSync(new URL('../lib/commerce/price-comparison.ts', import.meta.url), 'utf8')
assert.match(pc, /else startUrl = comparisonSearchUrl\(next\.provider, task\.metadata_json\.subject\) \|\| startUrl/)
assert.match(comparisonObjective({ metadata_json: { request: 'x', subject: 'iPhone 16', providers: [] } } as any, 'flipkart'), /goto to its own product link rather than clicking the tile/)
assert.match(pc, /row\.startUrl === comparisonSearchUrl\(row\.provider, task\.metadata_json\.subject\)/)
assert.match(pc, /row\.startUrl === comparisonSearchUrl\(row\.provider, task\.metadata_json\.subject\)/, 'a search-page start passes the saved-task check')
console.log('verify-comparison-subject: subject, search start and product goto ok')
