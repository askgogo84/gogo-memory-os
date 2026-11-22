import {commerceEnabled, commerceOrigin} from './providers'
import {readCommerceConnection} from './connection-store'
import {CommerceMcpClient, CommerceMcpError} from './mcp'
import {swiggyAddressPage, type CommerceAddress} from './addresses'
import {readFoodMenu, readFoodRestaurants, type FoodChoice, type RestaurantChoice} from './swiggy-read'
import {commerceHandoffUrl} from './evidence'
import {withSwiggyAttribution} from './swiggy-attribution'

// 22 Nov (owner: "continue with Swiggy MCP"): Swiggy Food in chat through the user's own Swiggy MCP connection,
// from the approved mock. Read-only: restaurant search and menu items, then a hand-off to the Swiggy app. The MCP
// client allows no food cart or order tool (lib/commerce/mcp.ts), and this module writes nothing.
// While COMMERCE_SWIGGY_ENABLED is off (until Swiggy's written consent under clause 2.1), it returns null so the
// existing food search keeps handling these messages exactly as before.

export type SwiggyFoodChatResult = {text: string; handledBy: 'swiggy-food-chat'; status: 'completed' | 'blocked'; runId: null; capability: 'commerce'; risk: 'low'; mutated: false}
export type FoodAsk = {dish: string | null; restaurant: string | null; vegetarian: boolean}

const SWIGGY_APP = 'https://www.swiggy.com'
const NOT_FOOD = /\b(?:instamart|dineout|genie|minis|status|refund|refunds|invoice|bill|receipt|account|offers?|coupons?|track|tracking|delivered|cancel|order\s+history|my\s+orders?)\b/i
const cleanPart = (v: string | undefined) => {
  const s = String(v || '').replace(/^(?:(?:some|a|an|the|me|us)\s+)+/i, '').replace(/\s+(?:please|pls)$/i, '').replace(/\s+/g, ' ').trim()
  return s && s.length <= 80 && /[a-z]/i.test(s) ? s : null
}

/** Pure. "order biryani from Meghana Foods on Swiggy", "find pizza on Swiggy", "search Swiggy for dosa". */
export function parseSwiggyFoodAsk(text: string): FoodAsk | null {
  const value = String(text || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim()
    // Same trailer as the Instamart parser: a closing "do not order / pay" note only restates the rule here.
    .replace(/(?:[.!,;]\s*|\s+)(?:(?:and\s+)?(?:please\s+)?(?:do\s+not|don'?t|never)\s+(?:order|pay|check\s*out|checkout|buy|purchase|place\s+(?:the\s+|an?\s+)?order)(?:\s+(?:or|and|,)?\s*(?:order|pay|check\s*out|checkout|buy|purchase|place\s+(?:the\s+|an?\s+)?order))*(?:\s+(?:anything|it))?\s*[.!]*\s*)+$/i, '').trim()
  if (value.length < 8 || value.length > 200 || NOT_FOOD.test(value)) return null
  const lead = String.raw`^(?:(?:hey\s+)?gogo[,\s]+)?(?:please\s+|pls\s+)?(?:(?:can|could|will)\s+you\s+)?(?:please\s+)?`
  const on = String.raw`\s+(?:on|from|via|through|using|in)\s+swiggy(?:\s+food)?(?:\s+(?:please|pls))?\s*[.!?]*$`
  const m = value.match(new RegExp(lead + String.raw`(?:order|get|find|search(?:\s+for)?|show\s+me|look\s+(?:for|up))\s+(.{2,80}?)(?:\s+from\s+(.{2,60}?))?` + on, 'i'))
    || value.match(new RegExp(lead + String.raw`search\s+swiggy(?:\s+food)?\s+for\s+(.{2,80}?)(?:\s+from\s+(.{2,60}?))?\s*[.!?]*$`, 'i'))
  if (!m) return null
  const vegetarian = /\b(?:veg|vegetarian|pure\s+veg)\b/i.test(value) && !/\bnon[\s-]?veg\b/i.test(value)
  const dish = cleanPart(vegetarian ? m[1]?.replace(/\b(?:pure\s+)?(?:veg|vegetarian)\b/ig, '').replace(/\s+/g, ' ').trim() : m[1]), restaurant = cleanPart(m[2])
  if (!dish && !restaurant) return null
  if (dish && /^(?:food|something|anything|dinner|lunch|breakfast)$/i.test(dish) && !restaurant) return null
  return {dish, restaurant, vegetarian}
}

const result = (text: string, status: SwiggyFoodChatResult['status']): SwiggyFoodChatResult =>
  ({text, handledBy: 'swiggy-food-chat', status, runId: null, capability: 'commerce', risk: 'low', mutated: false})
const connectLink = () => commerceOrigin() + '/dashboard/commerce'
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 1)

/** Pure. The restaurant whose name contains every typed word, else none (never a guess). */
export function matchRestaurant(choices: RestaurantChoice[], typed: string): RestaurantChoice | null {
  const want = words(typed)
  if (!want.length) return null
  return choices.find(c => { const have = new Set(words(c.name)); return want.every(w => have.has(w)) }) || null
}

/** Pure. The address used: the only one, else the one tagged Home, else the first; always named in the reply. */
export function pickAddress(addresses: CommerceAddress[]): CommerceAddress | null {
  if (!addresses.length) return null
  return addresses.length === 1 ? addresses[0] : addresses.find(a => /^home$/i.test(a.label.trim())) || addresses[0]
}

const restaurantLine = (r: RestaurantChoice, i: number) =>
  `${i + 1}. ${r.name}${r.deliveryMinutes !== null ? ` · about ${Math.round(r.deliveryMinutes)} min` : ''}${r.distanceKm !== null ? ` · ${r.distanceKm.toFixed(1)} km` : ''}`
const itemLine = (f: FoodChoice, i: number) => `${i + 1}. ${f.name}${f.needsCustomization ? ' (has choices to pick in the app)' : ''}`

export function foodHandoff(): string {
  const url = commerceHandoffUrl('swiggy', SWIGGY_APP)
  return `Prices, delivery fees and the total are shown in the Swiggy app. I can't add food to your cart or order it; open Swiggy to order${url ? ': ' + url : '.'}`
}

export async function trySwiggyFoodChat(params: {telegramId: number | string; text: string}, deps: {
  enabled?: () => boolean; token?: (owner: string) => Promise<{accessToken: string} | null>; client?: (accessToken: string) => Pick<CommerceMcpClient, 'readTool'>
} = {}): Promise<SwiggyFoodChatResult | null> {
  const ask = parseSwiggyFoodAsk(params.text)
  if (!ask) return null
  if (!(deps.enabled || (() => commerceEnabled('swiggy')))()) return null
  const owner = String(params.telegramId || '')
  if (!/^-?\d{1,16}$/.test(owner)) return null
  const subject = ask.dish || ask.restaurant || 'that'
  const token = await (deps.token || ((o: string) => readCommerceConnection(o, 'swiggy')))(owner).catch(() => null)
  if (!token) return result('Connect your Swiggy account first, then ask me again: ' + connectLink(), 'blocked')
  try {
    const client = (deps.client || ((t: string) => new CommerceMcpClient('swiggy', 'food', t)))(token.accessToken)
    const page = swiggyAddressPage(await client.readTool('get_addresses', {page: 1, pageSize: 10}))
    const address = pickAddress(page.addresses)
    if (!address) return result('Your Swiggy account has no saved delivery address. Add one in the Swiggy app, then ask me again. Nothing was ordered.', 'blocked')
    const where = `delivering to your ${address.label} address`
    if (ask.restaurant) {
      const restaurants = await readFoodRestaurants(client, address.id, ask.restaurant)
      const hit = matchRestaurant(restaurants, ask.restaurant)
      if (!hit) {
        const near = restaurants.slice(0, 3)
        return result(withSwiggyAttribution(`I couldn't find ${ask.restaurant} open on Swiggy ${where} right now.` + (near.length ? `\nOpen places that matched:\n${near.map(restaurantLine).join('\n')}` : '') + `\n\n${foodHandoff()}`, 'food'), 'completed')
      }
      if (!ask.dish) return result(withSwiggyAttribution(`${hit.name} is open on Swiggy, ${where}.\n\n${foodHandoff()}`, 'food'), 'completed')
      const items = (await readFoodMenu(client, address.id, ask.dish, hit.id, ask.vegetarian)).slice(0, 5)
      if (!items.length) return result(withSwiggyAttribution(`${hit.name} has no ${ask.vegetarian ? 'vegetarian ' : ''}match for "${ask.dish}" in stock right now (${where}).\n\n${foodHandoff()}`, 'food'), 'completed')
      return result(withSwiggyAttribution(`${hit.name} on Swiggy, ${where}:\n${items.map(itemLine).join('\n')}\n\n${foodHandoff()}`, 'food'), 'completed')
    }
    const restaurants = (await readFoodRestaurants(client, address.id, subject)).slice(0, 5)
    if (!restaurants.length) return result(withSwiggyAttribution(`No open restaurant on Swiggy has "${subject}" ${where} right now. Try another dish or name.`, 'food'), 'completed')
    return result(withSwiggyAttribution(`Open now on Swiggy for "${subject}", ${where}:\n${restaurants.map(restaurantLine).join('\n')}\n\nSay "order ${subject} from <restaurant> on Swiggy" to see its menu items.\n${foodHandoff()}`, 'food'), 'completed')
  } catch (error) {
    if (error instanceof CommerceMcpError && error.reason === 'reauth_required') return result('Your Swiggy sign-in has expired. Reconnect here, then ask me again: ' + connectLink(), 'blocked')
    return result(`Swiggy didn't return a result I could verify for "${subject}" (the service may be busy, or your address may be outside its area). Nothing was ordered. Try again in a minute.`, 'blocked')
  }
}
