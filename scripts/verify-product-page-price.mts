import assert from 'node:assert/strict'
import { productPagePriceEvidence, } from '../lib/agent/secure-computer'
import { comparisonQuote, comparisonObjective } from '../lib/commerce/comparison-model'
// 16 Oct 8:02 pm live: Croma's iPhone 16 page showed ₹ but the model judged it incomplete with no reason, three times.
const obj = 'Find the listed price of this product on Croma: "iPhone 16". This read is only about Croma; other stores are checked separately.'
const text = 'Home Mobiles Apple iPhone 16 (512GB, Teal) Compare Connect to Store 4.5 (20 Ratings) ₹1,09,900.00 (Incl. all Taxes) MRP: ₹1,19,900.00 (Save ₹10,000) Delivery'
const ev = productPagePriceEvidence(obj, 'Buy Apple iPhone 16 (512GB, Teal) Online - Croma', text)
assert.deepEqual(ev, ['Apple iPhone 16 (512GB, Teal)', '₹1,09,900.00 (Incl. all Taxes) MRP:'])
assert.deepEqual(comparisonQuote('iPhone 16', { provider: 'croma', status: 'observed', sourceUrl: 'https://www.croma.com/apple-iphone-16-512gb-teal-/p/309706', evidence: ev!.join('\n') } as any), { price: '₹1,09,900', taxesIncluded: true })
assert.equal(productPagePriceEvidence(obj, 'Buy Apple iPhone 16e (128GB, White) Online - Croma', text.replace('16 (512GB, Teal)', '16e (128GB, White)')), null, 'a 16e page is not read as iPhone 16')
assert.equal(productPagePriceEvidence('Read only Croma for prices', 'Buy Apple iPhone 16 (512GB, Teal) Online - Croma', text), null, 'only store price reads use it')
assert.equal(productPagePriceEvidence(obj, 'Buy Apple iPhone 16 (512GB, Teal) Online - Croma', 'Apple iPhone 16 (512GB, Teal) Out of stock'), null, 'no price, no answer')
assert.match(comparisonObjective({ metadata_json: { request: 'x', subject: 'iPhone 16', providers: [] } } as any, 'croma'), /open the smallest storage size \(the base model\)/)
console.log('verify-product-page-price: direct product-page price ok')
