// 26 Oct live (00:07): Swiggy's menu said "Chicken Boneless Biryani. This item is a Bestseller, Costs: 375 rupees" and the
// read failed; Zomato and Swiggy outlets were Residency Road / Kanakapura Road while Instinct read Rajajinagar for 560086.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const sc = await import('../lib/agent/secure-computer')
const m = await import('../lib/commerce/comparison-model')
const pc = await import('../lib/commerce/price-comparison')

const subject = 'chicken biryani at Meghana Foods'
const task: any = {metadata_json: {request: 'Compare chicken biryani at Meghana Foods on Swiggy and Zomato for 560086', subject, providers: []}}
const swiggyObjective = m.comparisonObjective(task, 'swiggy'), zomatoObjective = m.comparisonObjective(task, 'zomato')
const swiggyPage = 'Meghana Foods\n4.5 (97K+ ratings) • ₹500 for two\nBiryani, Andhra\nNon-veg item. Lollipop Biryani. Costs: 370 rupees, Description: 3 pieces of lollypop\nNon-veg item. Meghana Special Boneless Biryani. This item is a Bestseller, Costs: 383 rupees, Description: The chicken is cooked\nNon-veg item. Chicken Boneless Biryani. This item is a Bestseller, Costs: 375 rupees, Description: We use long grain basmati rice\nChicken Boneless Biryani\n375\n4.7'
assert.deepEqual(sc.foodMenuEvidence(swiggyObjective, swiggyPage), ['Chicken Boneless Biryani. This item is a Bestseller, Costs: 375 rupees'])
const zomatoPage = 'Meghana Foods, Rajajinagar\nMutton Biryani\n₹450\nChicken Biryani\n₹365\nChicken Boneless Biryani ₹375'
assert.deepEqual(sc.foodMenuEvidence(zomatoObjective, zomatoPage), ['Chicken Biryani\n₹365'], 'the closest dish name wins')
assert.equal(sc.foodMenuEvidence(zomatoObjective, 'Mutton Biryani ₹450\nPaneer Biryani ₹300'), null, 'another dish is never taken')
assert.equal(sc.foodMenuEvidence('Find the listed price of this product on Croma: "iPhone 16"', swiggyPage), null, 'product reads are untouched')

// The Swiggy line becomes an observed price with a clean dish name.
const done = m.providerObservation('swiggy', {id: 'c', status: 'completed', updated_at: new Date().toISOString()},
  {status: 'completed', output_json: {sourceUrl: 'https://www.swiggy.com/city/bangalore/meghana-foods-rajajinagar-rest3242', summary: 'Chicken Boneless Biryani. This item is a Bestseller, Costs: 375 rupees'}}, subject)
assert.equal(done.status, 'observed')
assert.deepEqual(m.foodQuote(subject, 'Chicken Boneless Biryani. This item is a Bestseller, Costs: 375 rupees'), {dish: 'Chicken Boneless Biryani', price: '₹375'})
assert.doesNotMatch(swiggyObjective, /₹<menu price>/, 'no fixed ₹ format the page cannot match')

// Nearest outlet: the map listing's area picks the matching outlet page.
assert.equal(m.outletAreaFromAddress('No 12, 1st Block, Rajajinagar, Bengaluru, Karnataka 560010'), 'Rajajinagar')
assert.equal(m.outletAreaFromAddress('124, Residency Rd, Shanthala Nagar, Ashok Nagar, Bengaluru, Karnataka 560025'), 'Ashok Nagar')
const leads = [{url: 'https://www.zomato.com/bangalore/meghana-foods-kanakapura-road-bangalore/order'}, {url: 'https://www.zomato.com/bangalore/meghana-foods-rajajinagar-bangalore/order'}]
assert.equal(m.foodRestaurantLead('zomato', 'Meghana Foods', leads, '560086', 'Rajajinagar'), 'https://www.zomato.com/bangalore/meghana-foods-rajajinagar-bangalore/order')
assert.equal(m.foodRestaurantLead('zomato', 'Meghana Foods', leads, '560086', null), 'https://www.zomato.com/bangalore/meghana-foods-kanakapura-road-bangalore/order', 'no area: unchanged order')
process.env.SERPER_API_KEY = 'fixture'
const fakePlaces: typeof fetch = async () => new Response(JSON.stringify({places: [
  {title: 'Empire Restaurant', address: 'Rajajinagar, Bengaluru'},
  {title: 'Meghana Foods', address: '52, 1st Block, Rajajinagar, Bengaluru, Karnataka 560010', cid: '123'}]}), {status: 200})
assert.equal(await pc.nearestOutletArea('Meghana Foods', '560086', fakePlaces), 'Rajajinagar')
assert.equal(await pc.nearestOutletArea('Meghana Foods', null, fakePlaces), null)
assert.equal(await pc.nearestOutletArea('Meghana Foods', '560086', async () => new Response('', {status: 500})), null, 'a map failure never blocks the comparison')
// The real assessment path returns the exact menu line without a model call.
const answer = await sc.assessReadOutcome(swiggyObjective, {url: 'https://www.swiggy.com/city/bangalore/meghana-foods-rajajinagar-rest3242', title: 'Order from Meghana Foods online in Bangalore | Swiggy', text: swiggyPage})
assert.ok(answer && /Chicken Boneless Biryani\. This item is a Bestseller, Costs: 375 rupees/.test(String(answer)), String(answer))
console.log('Food menu direct read and nearest outlet passed')
await import('./verify-booking-edge-blocked-oct27.mts')
await import('./verify-flight-rows-direct-oct27.mts')
await import('./verify-booking-row-pick-oct27.mts')
await import('./verify-flight-result-card-oct27.mts')
await import('./verify-booking-details-oct27.mts')
await import('./verify-book-latest-search-oct27.mts')
