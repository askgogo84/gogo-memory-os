// 26 Oct live: "Compare chicken biryani at Meghana Foods on Swiggy and Zomato for 560086" ran as a product
import './verify-comparison-no-login-oct26.mts'
// comparison (home pages, Swiggy asked for a location, Zomato "browser busy", iPhone-style closing line).
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const m = await import('../lib/commerce/comparison-model')
const pc = await import('../lib/commerce/price-comparison')

const live = m.parsePriceComparison('Compare chicken biryani at Meghana Foods on Swiggy and Zomato for 560086')!
assert.deepEqual(live.providers, ['swiggy', 'zomato'])
assert.equal(live.subject, 'chicken biryani at Meghana Foods')
assert.deepEqual(m.parseFoodSubject(live.subject), {dish: 'chicken biryani', restaurant: 'Meghana Foods'})
assert.equal(m.pincodeInText(live.request), '560086')
assert.equal(m.isFoodComparison(live.providers), true)
// A dish at a restaurant with no app named still means Swiggy and Zomato, not electronics stores.
assert.deepEqual(m.parsePriceComparison('compare chicken biryani at Meghana Foods')?.providers, ['swiggy', 'zomato'])
assert.deepEqual(m.parsePriceComparison('compare iPhone 16 128GB')?.providers, ['amazon', 'flipkart', 'croma', 'reliance'])
assert.deepEqual(m.parsePriceComparison('Compare Amul butter 500 g')?.providers, ['zepto', 'blinkit', 'instamart'])

// Each food app has its own browser lane.
assert.ok(pc.PARALLEL_COMPARISON_PROVIDERS.has('swiggy') && pc.PARALLEL_COMPARISON_PROVIDERS.has('zomato'))

// The restaurant's own page is the start: Bangalore outlet first, never a listing, search or look-alike host.
const leads = [
  {url: 'https://www.zomato.com/bangalore/restaurants/biryani'},
  {url: 'https://zomato.com.evil.example/bangalore/meghana-foods-rajajinagar/order'},
  {url: 'https://www.zomato.com/chennai/meghana-foods-adyar'},
  {url: 'https://www.zomato.com/bangalore/meghana-foods-rajajinagar-bangalore/info'},
]
assert.equal(m.foodRestaurantLead('zomato', 'Meghana Foods', leads, '560086'), 'https://www.zomato.com/bangalore/meghana-foods-rajajinagar-bangalore/order')
assert.equal(m.foodRestaurantLead('swiggy', 'Meghana Foods', [{url: 'https://www.swiggy.com/restaurants/meghana-foods-rajajinagar-bangalore-48219'}, {url: 'https://www.swiggy.com/search?query=meghana'}], '560086'),
  'https://www.swiggy.com/restaurants/meghana-foods-rajajinagar-bangalore-48219')
assert.equal(m.foodRestaurantLead('swiggy', 'Meghana Foods', [{url: 'https://www.swiggy.com/restaurants/empire-restaurant-12345'}], '560086'), null)
assert.equal(m.comparisonSearchUrl('swiggy', live.subject), 'https://www.swiggy.com/search?query=Meghana%20Foods')

// The objective names the dish, the restaurant, the pincode and the exact first line to report.
const task: any = {id: 't', status: 'queued', title: live.subject, source: 'web', updated_at: '', metadata_json: {request: live.request, subject: live.subject, providers: []}}
const obj = m.comparisonObjective(task, 'swiggy')
assert.match(obj, /restaurant "Meghana Foods"/); assert.match(obj, /dish "chicken biryani"/); assert.match(obj, /enter 560086/)
assert.match(obj, /<dish name as listed> — ₹<menu price>/); assert.match(obj, /Never add to cart, order, pay or submit/)
assert.match(m.comparisonObjective(task, 'zomato'), /On Zomato/)

// Evidence: the dish line gives one price; another dish or an unrelated money figure does not.
const ev = 'Chicken Dum Biryani (Boneless) — ₹389\nMeghana Foods, Rajajinagar\nFree delivery above ₹199'
assert.deepEqual(m.foodQuote(live.subject, ev), {dish: 'Chicken Dum Biryani (Boneless)', price: '₹389', outlet: 'Meghana Foods, Rajajinagar'})
// Live Zomato evidence (26 Oct 23:45): price on the dish line, outlet on the next.
assert.deepEqual(m.foodQuote(live.subject, 'Chicken Biryani ₹365\nMeghana Foods, Kanakapura Road'), {dish: 'Chicken Biryani', price: '₹365', outlet: 'Meghana Foods, Kanakapura Road'})
assert.equal(m.foodQuote(live.subject, 'Mutton Biryani — ₹450\nMeghana Foods'), null)
assert.equal(m.foodQuote(live.subject, 'Chicken Biryani — ₹389 or ₹420 for family pack'), null)
const done = (summary: string) => m.providerObservation('zomato', {id: 'c', status: 'completed', updated_at: new Date().toISOString()},
  {status: 'completed', output_json: {sourceUrl: 'https://www.zomato.com/bangalore/meghana-foods-rajajinagar-bangalore/order', summary}}, live.subject)
assert.equal(done(ev).status, 'observed')
assert.equal(done('Mutton Biryani — ₹450').status, 'failed')

// Food reply: dish lines, cheapest app, and food wording instead of the iPhone hint.
const summary = m.comparisonWhatsAppSummary({...task, metadata_json: {...task.metadata_json, providers: [
  {provider: 'swiggy', status: 'observed', sourceUrl: 'https://www.swiggy.com/restaurants/meghana-foods-rajajinagar-bangalore-48219', evidence: 'Chicken Dum Biryani (Boneless) — ₹410\nMeghana Foods', checkedAt: new Date().toISOString()},
  {provider: 'zomato', status: 'observed', sourceUrl: 'https://www.zomato.com/bangalore/meghana-foods-rajajinagar-bangalore/order', evidence: ev, checkedAt: new Date().toISOString()},
]}})
assert.match(summary, /\*Swiggy\*: ₹410/); assert.match(summary, /\*Zomato\*: ₹389\n  Chicken Dum Biryani \(Boneless\) · Meghana Foods, Rajajinagar/)
assert.match(summary, /Lowest listed price: Zomato, ₹389\./)
assert.match(summary, /delivery fee, packaging, surge and coupons/)
assert.doesNotMatch(summary, /iPhone/)
console.log('Food menu comparison passed')
{
  const {browserPageAllowlist} = await import('../lib/agent/browser-page-network')
  const zomato = browserPageAllowlist('https://www.zomato.com/bangalore/meghana-foods-kanakapura-road-bangalore/order')
  assert.ok('api.zomato.com' in zomato && 'jumbo.zomato.com' in zomato, 'Zomato menu data hosts are reachable')
  assert.ok(!('accounts.google.com' in zomato), 'no extra sign-in hosts')
  console.log('Zomato menu hosts passed')
}
