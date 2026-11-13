// Review finding (PR #1518, pre-existing): Flipkart "Extra ₹3000 off ₹26,990 ₹34,990 22% off" picked ₹34,990 (the MRP):
// the word "off" BEFORE ₹26,990 (end of the offer text) skipped the real price.
import assert from 'node:assert/strict'
import {productPagePriceEvidence} from '../lib/agent/secure-computer.ts'
import {comparisonQuote} from '../lib/commerce/comparison-model.ts'
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const objective = 'Find the listed price of this product on Flipkart: "Sony WH-1000XM5". Only Flipkart.'
const title = 'Sony WH-1000XM5 Wireless Headphones Online at Best Price | Flipkart'
const pick = (body: string) => { const e = productPagePriceEvidence(objective, title, 'Sony WH-1000XM5 Wireless Headphones ' + body); return e ? e[e.length - 1] : null }
ok(/^₹26,990\b/.test(String(pick('Extra ₹3000 off ₹26,990 ₹34,990 22% off'))), 'Flipkart: selling price after "Extra ₹… off", never the MRP')
ok(/^₹26,990\b/.test(String(pick('₹26,990 ₹34,990 22% off'))), 'plain Flipkart layout unchanged')
ok(!/^₹3000\b/.test(String(pick('Extra ₹3000 off ₹26,990 ₹34,990'))), 'the offer amount itself is never the price')
ok(/^₹26,990\b/.test(String(pick('Save ₹8,000 ₹26,990 M.R.P.: ₹34,990'))), 'a "Save ₹…" amount is still skipped')
const row: any = {provider: 'flipkart', status: 'observed', sourceUrl: 'https://www.flipkart.com/sony-wh-1000xm5/p/itm123', evidence: 'Sony WH-1000XM5 Wireless Headphones\nExtra ₹3000 off ₹26,990 ₹34,990 22% off'}
const q = comparisonQuote('Sony WH-1000XM5', row)
ok(!q || q.price === '₹26,990', `summary quote is the selling price or refused, never the MRP (got ${q?.price})`)
// Re-review: offer amounts are never the price (these were skipped on main and must stay skipped).
for (const body of ['Bank Offer 10% off up to ₹1,500 on HDFC cards ₹26,990', 'Get 10% off upto ₹1,250 ₹26,990', 'Instant 10% off: ₹2,000 ₹26,990', 'Get extra off ₹1,000 with bank ₹26,990', 'Flat off ₹500 ₹26,990', 'Up to 20% off ₹26,990 ₹34,990', '₹500 off on HDFC ₹26,990', 'Flat ₹500 off ₹26,990', 'with 22% off ₹26,990 M.R.P.: ₹34,990', 'Get extra off on HDFC ₹1,000 ₹26,990', 'Extra off on bank cards ₹750 ₹26,990', 'Flat ₹500 off on HDFC ₹26,990', 'Extra 10% off on SBI ₹26,990', 'Over 1k bought ₹26,990'])
  ok(/^₹26,990\b/.test(String(pick(body))), `selling price picked: ${body} (got ${pick(body)})`)
for (const body of ['Get extra off ₹1,000 ₹26,990', 'Flat off ₹500 ₹26,990']) {
  const qq = comparisonQuote('Sony WH-1000XM5', {...row, evidence: 'Sony WH-1000XM5 Wireless Headphones\n' + body})
  ok(!qq || qq.price === '₹26,990', `summary never quotes the offer amount: ${body} (got ${qq?.price})`)
}
const zobj = 'Find the listed price of this product on Zepto: "Amul butter 500 g". Only Zepto.'
const zpick = (body: string) => { const e = productPagePriceEvidence(zobj, 'Amul Salted Butter 500 g - Buy at ₹325 Online | Zepto', 'Amul Salted Butter 500 g ' + body); return e ? e[e.length - 1] : null }
for (const body of ['Flat off ₹20 ₹325', 'Extra off ₹50 on orders above ₹499 ₹325', '5% off ₹325 ₹342', 'Get ₹20 off ₹325 MRP ₹345'])
  ok(/^₹325\b/.test(String(zpick(body))), `grocery: ₹325 picked: ${body} (got ${zpick(body)})`)

console.log(`PASS verify-flipkart-extra-off-nov13: ${checks} checks`)
