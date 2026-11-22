// 22 Nov: Swiggy Food in chat (read-only) from the approved mock. Off until Swiggy's written consent: returns null so
// the existing food search keeps these messages. Every Swiggy result carries "Powered by Swiggy".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const f: any = await import('../lib/commerce/swiggy-food-chat')
const { CommerceMcpError } = await import('../lib/commerce/mcp')

// Parsing.
assert.deepEqual(f.parseSwiggyFoodAsk('Order chicken biryani from Meghana Foods on Swiggy'), { dish: 'chicken biryani', restaurant: 'Meghana Foods', vegetarian: false })
assert.deepEqual(f.parseSwiggyFoodAsk('find veg pizza on swiggy'), { dish: 'pizza', restaurant: null, vegetarian: true })
assert.deepEqual(f.parseSwiggyFoodAsk('search Swiggy for masala dosa'), { dish: 'masala dosa', restaurant: null, vegetarian: false })
assert.deepEqual(f.parseSwiggyFoodAsk('Can you get me non-veg thali from Nagarjuna on Swiggy?'), { dish: 'non-veg thali', restaurant: 'Nagarjuna', vegetarian: false })
assert.deepEqual(f.parseSwiggyFoodAsk('order biryani from Meghana on Swiggy. Do not order or pay.'), { dish: 'biryani', restaurant: 'Meghana', vegetarian: false })
for (const t of ['order milk on Instamart', 'book a table at Toit on Swiggy Dineout', 'where is my Swiggy order', 'track my order on swiggy', 'refund for my swiggy order',
  'order food on swiggy', 'compare biryani on Swiggy and Zomato please now ok', 'I love swiggy', 'swiggy', 'order biryani from Meghana Foods'])
  assert.equal(f.parseSwiggyFoodAsk(t), null, t)
console.log('✓ food asks are recognised; Instamart, Dineout, order status and vague asks are not')

// Matching and address choice.
const R = (id: string, name: string) => ({ id, name, distanceKm: 2.34, deliveryMinutes: 31.6 })
assert.equal(f.matchRestaurant([R('1', 'Meghana Foods Koramangala'), R('2', 'Meghana Biryani')], 'meghana foods')?.id, '1')
assert.equal(f.matchRestaurant([R('1', 'Truffles')], 'Meghana'), null, 'never a guess')
const A = (id: string, label: string) => ({ id, label, addressLine: 'x' })
assert.equal(f.pickAddress([A('a', 'Work'), A('b', 'Home')]).id, 'b'); assert.equal(f.pickAddress([A('a', 'Work')]).id, 'a'); assert.equal(f.pickAddress([]), null)

// Flow with a fake client: read-only tools only.
function fakeClient(calls: string[], over: Record<string, any> = {}) {
  return { readTool: async (name: string, args: any) => {
    calls.push(name)
    if (over[name] instanceof Error) throw over[name]
    if (name === 'get_addresses') return over.get_addresses ?? { addresses: [{ id: 'addr1', addressLine: '1 MG Road', addressTag: 'Home' }], pagination: { hasMore: false } }
    if (name === 'search_restaurants') return over.search_restaurants ?? { restaurants: [
      { id: 'r1', name: 'Meghana Foods', availabilityStatus: 'OPEN', distanceKm: 1.2, deliveryTimeMinutes: 28 },
      { id: 'r2', name: 'Closed Place', availabilityStatus: 'CLOSED' }] }
    if (name === 'search_menu') { assert.equal(args.restaurantIdOfAddedItem, 'r1'); return { items: [
      { menu_item_id: 'm1', name: 'Chicken Biryani', restaurant_id: 'r1', inStock: 1, hasVariants: true },
      { menu_item_id: 'm2', name: 'Out of stock', restaurant_id: 'r1', inStock: 0 }] } }
    throw new Error('unexpected tool ' + name)
  } }
}
const deps = (calls: string[], over = {}) => ({ enabled: () => true, token: async () => ({ accessToken: 't' }), client: () => fakeClient(calls, over) })
const OWNER = -3902574319362690
{
  assert.equal(await f.trySwiggyFoodChat({ telegramId: OWNER, text: 'order biryani from Meghana Foods on Swiggy' }, { enabled: () => false }), null, 'off: existing food search keeps it')
  const calls: string[] = []
  const r = await f.trySwiggyFoodChat({ telegramId: OWNER, text: 'order biryani from Meghana Foods on Swiggy' }, deps(calls))
  assert.match(r.text, /^Meghana Foods on Swiggy, delivering to your Home address:\nPowered by Swiggy\n1\. Chicken Biryani \(has choices to pick in the app\)/)
  assert.doesNotMatch(r.text, /Out of stock|₹/, 'no out-of-stock items and no invented prices')
  assert.match(r.text, /I can't add food to your cart or order it; open Swiggy to order: https:\/\/www\.swiggy\.com\//)
  assert.equal(r.mutated, false); assert.deepEqual(calls, ['get_addresses', 'search_restaurants', 'search_menu'])
}
{
  const calls: string[] = []
  const r = await f.trySwiggyFoodChat({ telegramId: OWNER, text: 'find biryani on swiggy' }, deps(calls))
  assert.match(r.text, /^Open now on Swiggy for "biryani", delivering to your Home address:\nPowered by Swiggy\n1\. Meghana Foods · about 28 min · 1\.2 km/)
  assert.doesNotMatch(r.text, /Closed Place/)
  const miss = await f.trySwiggyFoodChat({ telegramId: OWNER, text: 'order biryani from Truffles on Swiggy' }, deps([]))
  assert.match(miss.text, /I couldn't find Truffles open on Swiggy/); assert.match(miss.text, /Powered by Swiggy/)
}
{
  const r = await f.trySwiggyFoodChat({ telegramId: OWNER, text: 'find biryani on swiggy' }, { enabled: () => true, token: async () => null })
  assert.match(r.text, /^Connect your Swiggy account first/); assert.equal(r.status, 'blocked')
  const expired = await f.trySwiggyFoodChat({ telegramId: OWNER, text: 'find biryani on swiggy' }, deps([], { search_restaurants: new CommerceMcpError('reauth_required') }))
  assert.match(expired.text, /Your Swiggy sign-in has expired/)
  const down = await f.trySwiggyFoodChat({ telegramId: OWNER, text: 'find biryani on swiggy' }, deps([], { search_restaurants: new Error('boom') }))
  assert.match(down.text, /didn't return a result I could verify.*Nothing was ordered/)
  const noAddr = await f.trySwiggyFoodChat({ telegramId: OWNER, text: 'find biryani on swiggy' }, deps([], { get_addresses: { addresses: [], pagination: { hasMore: false } } }))
  assert.match(noAddr.text, /no saved delivery address/)
}
console.log('✓ read-only search and menu with attribution, hand-off to the Swiggy app, honest failures')

// The MCP client still refuses any food cart or order tool.
const mcp = readFileSync(new URL('../lib/commerce/mcp.ts', import.meta.url), 'utf8')
assert.match(mcp, /food: \['get_addresses', 'search_restaurants', 'search_menu', 'get_restaurant_menu', 'get_food_cart'\]/)
const mod = readFileSync(new URL('../lib/commerce/swiggy-food-chat.ts', import.meta.url), 'utf8')
assert.doesNotMatch(mod, /supabaseAdmin|update_food_cart|place_food_order|\.insert\(|\.update\(/, 'no writes, no cart or order tools')
// Both routes: after Instamart, gated on "swiggy" without Instamart/Dineout.
for (const p of ['../app/api/dashboard/chat/route.ts', '../app/api/webhooks/whatsapp/route.ts']) {
  const r = readFileSync(new URL(p, import.meta.url), 'utf8')
  const i = r.indexOf('trySwiggyFoodChat('), j = r.indexOf('tryInstamartChat(')
  assert.ok(i > j && j > 0, p + ': after Instamart')
  assert.match(r, /\\bswiggy\\b\/i\.test\(text\) ?&& ?!\/\\b\(\?:instamart\|dineout\)\\b\/i\.test\(text\)/, p + ': gate')
}
console.log('✓ no cart, order or database writes; both surfaces wired after Instamart')
