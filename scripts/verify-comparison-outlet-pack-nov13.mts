// 13 Nov live comparison vs Instinct: (1) "compare chicken biryani at Meghana Foods for 560086" read the Residency Road
// and Hosur Road outlets because the map search's address gave "next to Old Galaxy Theatre" as the area; Instinct used
// the Rajajinagar outlet. (2) Zepto's "Amul Salted Butter - Buy at ₹325 Online | …" page was skipped (identity_mismatch)
// because the title omits the pack size that the page states just below.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {packFromPage, productIdentityMatches} from '../lib/commerce/product-identity.ts'
import {outletAreaFromAddress, foodRestaurantLead, comparisonQuote} from '../lib/commerce/comparison-model.ts'
import {productPagePriceEvidence} from '../lib/agent/secure-computer.ts'
import {outletInArea} from '../lib/commerce/price-comparison.ts'

let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }

// 1. Outlet area: a landmark is never the area; the person's saved home area is used for their own pincode.
eq(outletAreaFromAddress('Meghana Foods, 544, next to Old Galaxy Theatre, Koramangala, Bengaluru, Karnataka 560034'), 'Koramangala', 'landmark skipped, locality kept')
eq(outletAreaFromAddress('12, 1st Block, Rajajinagar, Bengaluru, Karnataka 560010'), 'Rajajinagar', 'existing behaviour kept')
ok(!/next to/i.test(String(outletAreaFromAddress('next to Old Galaxy Theatre, Bengaluru, Karnataka 560025'))), 'a lone landmark is never returned')
const swiggyLeads = ['/city/bangalore/meghana-foods-hosur-road-rest323187', '/city/bangalore/meghana-foods-dr-rajkumar-road-rajajinagar-rest288893'].map(p => ({url: 'https://www.swiggy.com' + p}))
eq(foodRestaurantLead('swiggy', 'Meghana Foods', swiggyLeads, '560086', 'Rajajinagar'), 'https://www.swiggy.com/city/bangalore/meghana-foods-dr-rajkumar-road-rajajinagar-rest288893', 'with the home area, the Rajajinagar outlet ranks first (the live lead list)')
eq(foodRestaurantLead('zomato', 'Meghana Foods', [{url: 'https://www.zomato.com/bangalore/meghana-foods-residency-road/order'}, {url: 'https://www.zomato.com/bangalore/meghana-foods-rajajinagar-bangalore/order'}], '560086', 'Rajajinagar'), 'https://www.zomato.com/bangalore/meghana-foods-rajajinagar-bangalore/order', 'Zomato: Rajajinagar outlet first')
const pc = readFileSync('lib/commerce/price-comparison.ts', 'utf8')
ok(/const homeArea = home\?\.pincode && home\.pincode === pin && home\.area \? String\(home\.area\) : null/.test(pc), 'saved home area used only when the pincode is the saved home pincode')

// 2. Pack size stated just under a heading that omits it.
const page = 'Home Dairy Butter Amul Salted Butter Net Qty: 500 g ₹325 MRP ₹330 Out of stock Product details Amul …'
eq(packFromPage('Amul butter 500 g', 'Amul Salted Butter', page), 'Net Qty: 500 g', 'asked size found right under the heading')
eq(packFromPage('Amul butter 500 g', 'Amul Salted Butter', page.replace('500 g', '100 g')), null, 'a different size never qualifies')
eq(packFromPage('Amul butter 500 g', 'Amul Salted Butter', 'Amul Salted Butter 100 g ₹60 500 g ₹325'), null, 'a variant list never qualifies')
eq(packFromPage('Amul butter', 'Amul Salted Butter', page), null, 'no asked size: nothing added')
eq(packFromPage('Amul butter 0.5 kg', 'Amul Salted Butter', page), 'Net Qty: 500 g', '0.5 kg equals 500 g')
eq(packFromPage('Amul butter 500 g', 'Amul Salted Butter 100 g', page), null, 'a heading with its own size is never overridden')
ok(!productIdentityMatches('Amul butter 500 g', 'Amul Salted Butter') && productIdentityMatches('Amul butter 500 g', 'Amul Salted Butter Net Qty: 500 g'), 'identity needs the pack, and passes with it')

// 3. Direct price read on the live Zepto title.
const title = 'Amul Salted Butter - Buy at ₹325 Online | Instant Delivery - Zepto'
const objective = 'Find the listed price of this product on Zepto: "Amul butter 500 g". This read is only about Zepto.'
const ev = productPagePriceEvidence(objective, title, page)
ok(ev && ev[0] === 'Amul Salted Butter' && ev[1] === 'Net Qty: 500 g' && /^₹325\b/.test(ev[2]), 'Zepto: heading, pack line and ₹325 as evidence')
eq(productPagePriceEvidence(objective, title, page.replace('500 g', '100 g')), null, 'Zepto 100 g page is not the 500 g product')

// 4. The comparison summary accepts that evidence (pack on its own line) and picks ₹325, not the MRP.
const row: any = {provider: 'zepto', status: 'observed', sourceUrl: 'https://www.zepto.com/pn/amul-salted-butter/pvid/fc2ffbca-a36b-4728-b6be-3168475f3b75', evidence: ev!.join('\n')}
eq(comparisonQuote('Amul butter 500 g', row)?.price, '₹325', 'quote: ₹325')
eq(comparisonQuote('Amul butter 500 g', {...row, evidence: 'Amul Salted Butter\n₹325'}), null, 'without the pack line the quote still refuses')
eq(comparisonQuote('Amul butter 500 g', {...row, evidence: 'Amul Salted Butter\n₹100 off today\n₹325'}), null, 'a price line is never used as the pack line')

// Review fixes (PR #1518): multipacks, a heading with its own "gm" size, fees and unit prices, outlet fallback.
const zt = (price: string) => `Amul Salted Butter - Buy at ${price} Online | Zepto`
for (const body of ['Net Qty: 2 x 500 g ₹650', '500 g (Pack of 2) ₹650', 'Net Qty: 500 g x 2 ₹650', '2 pcs 500 g ₹650', 'Combo 500 g ₹650', 'Net Qty: 500 g ₹650 Pack of 2']) {
  eq(productPagePriceEvidence(objective, zt('₹650'), 'Amul Salted Butter ' + body), null, `multipack refused: ${body}`)
}
eq(productPagePriceEvidence(objective, 'Amul Salted Butter 100gm - Buy at ₹60 Online | Zepto', 'Amul Salted Butter 100gm ₹60 Similar: Amul Butter 500 g ₹325'), null, '"100gm" heading is never overridden by a recommended tile')
eq(packFromPage('Amul butter 500 g', 'Amul Salted Butter', 'Amul Salted Butter ₹60 Similar: Amul Butter 500 g ₹325'), null, 'a size after the first price (another tile) is never borrowed')
eq(packFromPage('Amul butter 5 g', 'Amul Salted Butter', 'Amul Salted Butter Net Qty: 2.5 g ₹10'), null, '2.5 g is not 5 g')
const fee = productPagePriceEvidence(objective, zt('₹325'), 'Amul Salted Butter Net Qty: 500 g Handling fee ₹9 ₹325')
ok(!fee || !/^₹9\b/.test(fee[2]), 'a handling fee is never the item price')
const unitFirst = productPagePriceEvidence(objective, zt('₹325'), 'Amul Salted Butter Net Qty: 500 g ₹65/100 g ₹325')
ok(unitFirst && /^₹325\b/.test(unitFirst[2]), 'a per-100 g unit price is skipped; ₹325 is picked')
const pass = productPagePriceEvidence(objective, zt('₹325'), 'Amul Salted Butter Net Qty: 500 g ₹299 with Zepto Pass ₹325')
ok(pass && /^₹325\b/.test(pass[2]), 'a member-only price is skipped')
eq(outletInArea('https://www.swiggy.com/city/bangalore/meghana-foods-dr-rajkumar-road-rajajinagar-rest288893', 'Rajajinagar'), true, 'outlet in home area')
eq(outletInArea('https://www.zomato.com/bangalore/meghana-foods-residency-road/order', 'Rajajinagar'), false, 'outlet not in home area → map-search fallback')
eq(outletInArea('https://www.zomato.com/x', null), false, 'no area: fallback')
ok(/if \(!found\?\.url \|\| !outletInArea\(found\.url, homeArea\)\) \{\s*area = await nearestOutletArea/.test(pc), 'no home-area outlet: nearest-outlet map search is used')
ok(/const home = pin \?/.test(pc), 'no pincode: no saved-home read')

console.log(`PASS verify-comparison-outlet-pack-nov13: ${checks} checks`)
