// 26 Oct production acceptance defects (read-only journeys on app.askgogo.in, SHA 2ce43f4d).
// T6: "Find hotels near Mumbai Airport for 12–16 November for 2 adults…" kept the dates/guests in the places query
//     (zero results) and answered with restaurant wording. URL read: a message carrying an explicit page URL was
//     claimed by the price comparison, which used the whole sentence (URL included) as the product name.
// Offline. Run: npx --yes tsx scripts/verify-browser-acceptance-oct26.mts
import assert from 'node:assert/strict'

const places = await import('../lib/agent/places-search')
const cmp = await import('../lib/commerce/comparison-model')

// ── T6 hotels ──────────────────────────────────────────────────────────────────
const HOTEL = 'Find hotels near Mumbai Airport for 12–16 November for 2 adults. Show source links and only property-matched verified room prices. Research only; do not book.'
const ask = places.placeAsk(HOTEL)
assert.ok(ask, 'a hotel discovery ask is still a places ask')
assert.equal(ask!.area, 'Mumbai Airport')
assert.equal(ask!.query, 'hotels near Mumbai Airport', 'dates and guests never go into the places query')
for (const [text, query] of [
  ['Find hotels near Mumbai Airport from 12 November to 16 November for 2 adults', 'hotels near Mumbai Airport'],
  ['Suggest 3 hotels in Indiranagar for 2 nights on 14 Nov', 'hotels in Indiranagar, Bengaluru'],
  ['Find hotels near Mumbai Airport for 1 room, 2 guests, check-in 12 Nov', 'hotels near Mumbai Airport'],
] as const) assert.equal(places.placeAsk(text)?.query, query, text)
// Restaurants are unchanged.
const REST = 'Find restaurants in Indiranagar, Bengaluru, for 2 people tomorrow at 8 PM. Show evidence, availability only if provider-verified, and source links. Research only; do not book.'
assert.equal(places.placeAsk(REST)?.query, 'restaurants in Indiranagar, Bengaluru')
assert.equal(places.placeAsk('Suggest 3 South Indian restaurants in Rajajinagar')?.count, 3)

// Wording follows the kind asked for, and a stay ask never claims room rates.
const fakeFetch = (rows: any[]) => (async () => new Response(JSON.stringify({ places: rows }), { status: 200 })) as any
process.env.SERPER_API_KEY = 'synthetic'
const none = await places.answerPlaces(HOTEL, fakeFetch([]))
assert.match(String(none), /hotels/i, 'hotel failure says hotels')
assert.doesNotMatch(String(none), /restaurants|table availability/i, 'no restaurant wording for a hotel ask')
assert.match(String(none), /No booking was made/)
const listed = await places.answerPlaces(HOTEL, fakeFetch([
  { title: 'Hotel Airport International', address: 'Andheri East, Mumbai', rating: 4.1, ratingCount: 900, category: 'Hotel', cid: '1234567890123' },
  { title: 'Roswyn Hotel', address: 'Sahar Rd, Andheri East, Mumbai Airport', rating: 4.3, ratingCount: 1200, category: 'Hotel', cid: '2234567890123' },
]))
assert.match(String(listed), /Roswyn Hotel/)
assert.match(String(listed), /maps\.google\.com\/\?cid=/, 'each hotel carries its Maps source')
assert.match(String(listed), /Room rates and availability for your dates are not verified here; no booking was made\./, 'stay asks disclose unverified rates')
assert.doesNotMatch(String(listed), /₹|book a table/i, 'no invented price, no table CTA for hotels')
// Restaurant failure wording unchanged.
assert.match(String(await places.answerPlaces(REST, fakeFetch([]))), /restaurants, source links or table availability/)

// ── URL read ───────────────────────────────────────────────────────────────────
const URLREAD = 'Open https://www.flipkart.com/apple-iphone-16-white-128-gb/p/itm09e9f0a0f5ca0 read-only and tell me the listed price and product name shown on that page.'
assert.equal(cmp.parsePriceComparison(URLREAD), null, 'a request with an explicit page URL is a page read, not a store comparison')
assert.equal(cmp.parsePriceComparison('What is the price on https://www.croma.com/apple-iphone-16-128gb-black-/p/324488 ?'), null)
// Comparisons without a URL are unchanged.
const four = cmp.parsePriceComparison('Compare iPhone 16 128GB across Amazon India, Flipkart, Croma and Reliance Digital. Show observed prices, timestamps and source links; research only, do not order.')
assert.ok(four && four.providers.length === 4, 'four-store comparison still parses')
assert.ok(cmp.parsePriceComparison('price of iPhone 16 on Flipkart'), 'single-store price read without a URL still parses')

console.log('Oct 26 acceptance: hotel asks search the place (not dates/guests) with honest rate wording; URL reads are not store comparisons')
