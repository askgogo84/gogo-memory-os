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
console.log(`PASS verify-flipkart-extra-off-nov13: ${checks} checks`)
